-- 10 · Production engine in SQL (port of src/store/engine.ts).
-- Each function is one transaction: any `raise exception` rolls back everything, like the
-- clone-then-commit pattern in StoreContext.run(). Error messages match the ERPError texts.
-- Functions are SECURITY DEFINER because clients get no write access to the tables (see 14).
-- Party names (supplier / customer) are NEVER written into movements.note or activity.text: those feeds are readable
-- by every role, so they carry only job / lot / dispatch numbers. The names live in the masked columns.

-- ----------------------------------------------------------- helpers ---
create function _require_user() returns void
language plpgsql stable as $$
begin
  if not is_active_user() then
    raise exception 'Not signed in, or your account is inactive.' using errcode = '42501';
  end if;
end $$;

create function _assert_qty(p numeric, p_label text, p_allow_zero boolean default false) returns int
language plpgsql immutable as $$
begin
  if p is null or p <> trunc(p) then
    raise exception '% must be a whole number of pieces.', p_label;
  end if;
  if p < 0 or (not p_allow_zero and p = 0) then
    raise exception '% must be %.', p_label, case when p_allow_zero then 'zero or more' else 'greater than zero' end;
  end if;
  return p::int;
end $$;

create function stage_label(p text) returns text
language sql immutable as $$
  select case p
    when 'raw'           then 'Raw Inventory'
    when 'cutting'       then 'Cutting'
    when 'forging'       then 'Forging'
    when 'trimming'      then 'Trimming'
    when 'heatTreatment' then 'Heat Treatment'
    when 'qc'            then 'QC'
    when 'finishedGoods' then 'Finished Goods'
    when 'dispatched'    then 'Dispatch'
    when 'scrapped'      then 'Rejected'
    else p end;
$$;

create function _log(p_ts timestamptz, p_kind activity_kind, p_text text, p_job text default null) returns void
language sql as $$
  insert into activity (ts, kind, text, job_no) values (p_ts, p_kind, p_text, p_job);
$$;

create function _move(p_ts timestamptz, p_job text, p_from text, p_to text, p_qty int, p_loss int, p_note text default '') returns void
language sql as $$
  insert into movements (ts, job_no, from_loc, to_loc, qty, loss, note) values (p_ts, p_job, p_from, p_to, p_qty, p_loss, coalesce(p_note, ''));
$$;

create function _year(p_ts timestamptz) returns int
language sql immutable as $$ select extract(year from p_ts)::int $$;

-- ------------------------------------------------------ raw inventory ---
create function add_inward(
  p_material      text,
  p_material_type text,
  p_od            numeric,
  p_supplier      text,
  p_inward_date   date,
  p_qty           int,
  p_weight        numeric,
  p_heat_no       text default null,
  p_invoice_no    text default null,
  p_purchase_rate numeric default null,      -- ₹ per KG — confidential, director / plant head / accounts only
  p_ts            timestamptz default now()
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ts  timestamptz := coalesce(p_ts, now());
  v_qty int;
  v_n   int;
  v_id  text;
  v_wt  numeric(12, 3);
begin
  perform _require_user();
  if coalesce(btrim(p_material), '') = '' then raise exception 'Material is required.'; end if;
  if coalesce(btrim(p_supplier), '') = '' then raise exception 'Supplier is required.'; end if;
  if not (coalesce(p_od, 0) > 0) then raise exception 'OD / Size must be greater than zero.'; end if;
  v_qty := _assert_qty(p_qty, 'Quantity');
  if not (coalesce(p_weight, 0) > 0) then raise exception 'Weight must be greater than zero.'; end if;
  if p_inward_date is null then raise exception 'Inward date is required.'; end if;
  if p_purchase_rate is not null and not can_see_confidential() then
    raise exception 'You are not allowed to enter purchase rates.' using errcode = '42501';
  end if;
  if p_purchase_rate < 0 then raise exception 'Purchase rate cannot be negative.'; end if;
  if not exists (select 1 from material_master where material = btrim(p_material)) then
    raise exception 'Unknown material %.', p_material;
  end if;

  v_n  := next_doc_no('lot', _year(v_ts));
  v_id := format('RM-%s-%s', _year(v_ts), lpad(v_n::text, 3, '0'));
  v_wt := round(p_weight, 3);

  insert into raw_material_lots (id, material, material_type, od, supplier, inward_date, heat_no, invoice_no,
                                 inward_qty, inward_weight, available_qty, purchase_rate)
  values (v_id, btrim(p_material), coalesce(btrim(p_material_type), ''), p_od, btrim(p_supplier), p_inward_date,
          nullif(btrim(p_heat_no), ''), nullif(btrim(p_invoice_no), ''), v_qty, v_wt, v_qty, round(p_purchase_rate, 2));

  perform _move(v_ts, null, 'Supplier', 'Raw Inventory', v_qty, 0,
                format('%s OD %smm · lot %s', btrim(p_material), trim_scale(p_od), v_id));
  perform _log(v_ts, 'inward', format('%s PCS %s (OD %smm) received — lot %s',
                v_qty, btrim(p_material), trim_scale(p_od), v_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------- jobs ---
-- Creates the job (auto Job No.) and its Cutting order in "Pending". Stock is NOT consumed yet.
create function create_job(
  p_product_id     text,
  p_planned_qty    int,
  p_material       text,
  p_od             numeric,
  p_cutting_length numeric default null,
  p_customer       text default null,
  p_due_date       date default null,
  p_priority       job_priority default 'Normal',
  p_piece_weight_g numeric default null,
  p_die_no         text default null,
  p_machine_no     text default null,
  p_ts             timestamptz default now()
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ts      timestamptz := coalesce(p_ts, now());
  prod      products;
  v_planned int;
  v_avail   bigint;
  v_job     text;
  v_cust    text;
begin
  perform _require_user();
  select * into prod from products where id = p_product_id;
  if not found then raise exception 'Unknown product %', p_product_id; end if;
  v_planned := _assert_qty(p_planned_qty, 'Planned quantity');
  if coalesce(btrim(p_material), '') = '' or not (coalesce(p_od, 0) > 0) then raise exception 'Select a raw material.'; end if;

  select coalesce(sum(available_qty), 0) into v_avail
    from raw_material_lots where material = p_material and od = p_od and available_qty > 0;
  if v_planned > v_avail then
    raise exception 'Insufficient raw material: % PCS planned but only % PCS available for % OD %mm.',
      v_planned, v_avail, p_material, trim_scale(p_od);
  end if;

  v_job  := format('JOB-%s-%s', _year(v_ts), lpad(next_doc_no('job', _year(v_ts))::text, 4, '0'));
  v_cust := coalesce(nullif(btrim(p_customer), ''), prod.default_customer);

  insert into jobs (job_no, product_id, customer, planned_qty, material, od, due_date, priority, current_stage,
                    piece_weight_g, die_no, machine_no, created_at)
  values (v_job, prod.id, v_cust, v_planned, p_material, p_od, p_due_date, coalesce(p_priority, 'Normal'), 'cutting',
          case when p_piece_weight_g > 0 then p_piece_weight_g end,
          nullif(btrim(p_die_no), ''), nullif(btrim(p_machine_no), ''), v_ts);

  insert into stage_records (job_no, stage, input_qty, status, received_at, params)
  values (v_job, 'cutting', v_planned, 'Pending', v_ts,
          jsonb_build_object('cuttingLength', case when coalesce(p_cutting_length, 0) > 0 then p_cutting_length else prod.cutting_length end));

  perform _log(v_ts, 'job', format('%s created — %s PCS %s', v_job, v_planned, prod.name), v_job);
  return v_job;
end $$;

-- FIFO issue of raw material to a job, across lots of the same material / OD.
create function _issue_material(p_job jobs, p_qty int, p_ts timestamptz) returns void
language plpgsql as $$
declare
  lot       raw_material_lots;
  v_avail   bigint;
  v_left    int := p_qty;
  v_take    int;
  v_weight  numeric(12, 3);
begin
  select coalesce(sum(available_qty), 0) into v_avail
    from raw_material_lots where material = p_job.material and od = p_job.od and available_qty > 0;
  if p_qty > v_avail then
    raise exception 'Only % PCS of % OD %mm available in Raw Inventory.', v_avail, p_job.material, trim_scale(p_job.od);
  end if;

  for lot in
    select * from raw_material_lots
     where material = p_job.material and od = p_job.od and available_qty > 0
     order by inward_date, id
     for update                                  -- two users cannot issue the same pieces
  loop
    exit when v_left = 0;
    v_take   := least(lot.available_qty, v_left);
    v_weight := round(v_take * (lot.inward_weight / lot.inward_qty), 3);
    update raw_material_lots set available_qty = available_qty - v_take where id = lot.id;
    v_left := v_left - v_take;
    insert into job_material_issues (job_no, lot_id, qty, weight, issued_at) values (p_job.job_no, lot.id, v_take, v_weight, p_ts);
    perform _move(p_ts, p_job.job_no, 'Raw Inventory', 'Cutting', v_take, 0, format('FIFO issue from lot %s (%s KG)', lot.id, v_weight));
  end loop;
end $$;

-- --------------------------------------------------------------- stages ---
create function start_stage(
  p_stage     process_stage,
  p_job_no    text,
  p_input_qty int default null,        -- Cutting only: actual input issued from raw stock
  p_machine   text default null,
  p_operator  text default null,
  p_params    jsonb default '{}'::jsonb,
  p_ts        timestamptz default now()
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ts  timestamptz := coalesce(p_ts, now());
  rec   stage_records;
  j     jobs;
  v_qty int;
begin
  perform _require_user();
  select * into rec from stage_records where job_no = p_job_no and stage = p_stage and status <> 'Completed' for update;
  if not found then raise exception '% has no open % order.', p_job_no, stage_label(p_stage::text); end if;
  if rec.status <> 'Pending' then raise exception '% is already in progress at %.', p_job_no, stage_label(p_stage::text); end if;
  select * into j from jobs where job_no = p_job_no for update;

  v_qty := rec.input_qty;
  if p_stage = 'cutting' then
    v_qty := _assert_qty(coalesce(p_input_qty, rec.input_qty), 'Actual input quantity');
    perform _issue_material(j, v_qty, v_ts);
  end if;

  update stage_records
     set input_qty  = v_qty,
         status     = 'In Progress',
         started_at = v_ts,
         machine    = coalesce(p_machine, machine),
         operator   = coalesce(p_operator, operator),
         params     = params || coalesce(p_params, '{}'::jsonb)
   where id = rec.id;

  perform _log(v_ts, 'start', format('%s %s started — %s PCS', p_job_no, stage_label(p_stage::text), v_qty), p_job_no);
end $$;

create function complete_stage(
  p_stage     process_stage,
  p_job_no    text,
  p_loss      int,
  p_input_qty int default null,        -- Cutting only, when completing straight from Pending
  p_machine   text default null,
  p_operator  text default null,
  p_remarks   text default null,
  p_params    jsonb default '{}'::jsonb,
  p_ts        timestamptz default now()
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ts     timestamptz := coalesce(p_ts, now());
  rec      stage_records;
  j        jobs;
  prod     products;
  v_loss   int;
  v_input  int;
  v_next   job_stage;
  v_params jsonb;
  v_label  text := stage_label(p_stage::text);
begin
  perform _require_user();
  select * into rec from stage_records where job_no = p_job_no and stage = p_stage and status <> 'Completed' for update;
  if not found then raise exception '% has no open % order.', p_job_no, v_label; end if;

  -- validate before anything is issued or moved
  v_loss  := _assert_qty(p_loss, 'Loss / rejection', true);
  v_input := case when rec.status = 'Pending' and p_stage = 'cutting' then coalesce(p_input_qty, rec.input_qty) else rec.input_qty end;
  if v_loss > v_input then raise exception 'Loss (%) cannot exceed input quantity (%).', v_loss, v_input; end if;

  if rec.status = 'Pending' then
    perform start_stage(p_stage, p_job_no, p_input_qty, p_machine, p_operator, p_params, v_ts);
  end if;

  update stage_records
     set loss_qty     = v_loss,
         output_qty   = input_qty - v_loss,
         status       = 'Completed',
         completed_at = v_ts,
         machine      = coalesce(p_machine, machine),
         operator     = coalesce(p_operator, operator),
         remarks      = coalesce(p_remarks, remarks),
         params       = params || coalesce(p_params, '{}'::jsonb)
   where id = rec.id
  returning * into rec;

  select * into j from jobs where job_no = p_job_no for update;
  select * into prod from products where id = j.product_id;
  v_next := (case p_stage when 'cutting' then 'forging' when 'forging' then 'trimming'
                          when 'trimming' then 'heatTreatment' else 'qc' end)::job_stage;

  -- whole batch lost ⇒ job is scrapped
  if rec.output_qty = 0 then
    update jobs set current_stage = 'scrapped' where job_no = p_job_no;
    perform _move(v_ts, p_job_no, v_label, 'Rejection', 0, v_loss, 'Entire batch rejected');
    perform _log(v_ts, 'reject', format('%s fully rejected at %s (%s PCS)', p_job_no, v_label, v_loss), p_job_no);
    return;
  end if;

  perform _move(v_ts, p_job_no, v_label, stage_label(v_next::text), rec.output_qty, v_loss);
  perform _log(v_ts, 'complete',
    format('%s %s completed — %s in, %s loss, %s PCS moved to %s', p_job_no, v_label, rec.input_qty, v_loss, rec.output_qty, stage_label(v_next::text)),
    p_job_no);
  update jobs set current_stage = v_next where job_no = p_job_no;

  if v_next = 'qc' then
    insert into qc_records (job_no, input_qty, status, received_at) values (p_job_no, rec.output_qty, 'QC Pending', v_ts);
    return;
  end if;

  v_params := case v_next
    when 'forging'       then jsonb_build_object('dieNo', coalesce(nullif(j.die_no, ''), prod.die_no))
    when 'trimming'      then jsonb_build_object('trimDie', replace(prod.die_no, 'D-', 'T-'))
    when 'heatTreatment' then jsonb_build_object('temperature', prod.ht_temperature, 'soakMinutes', prod.ht_soak_minutes,
                                                 'process', prod.ht_process, 'quench', prod.ht_quench)
    else '{}'::jsonb end;

  -- next stage receives exactly what this stage produced
  insert into stage_records (job_no, stage, input_qty, status, received_at, params)
  values (p_job_no, v_next::text::process_stage, rec.output_qty, 'Pending', v_ts, v_params);
end $$;

-- ------------------------------------------------------------------ QC ---
create function complete_qc(
  p_job_no           text,
  p_accepted         int,
  p_rejected         int,
  p_inspector        text,
  p_rejection_reason text default null,
  p_remarks          text default null,
  p_dimensional      boolean default true,
  p_visual           boolean default true,
  p_hardness         boolean default true,
  p_ts               timestamptz default now()
) returns text                      -- FG id, or null when the whole lot was rejected
language plpgsql security definer set search_path = public as $$
declare
  v_ts   timestamptz := coalesce(p_ts, now());
  rec    qc_records;
  j      jobs;
  prod   products;
  v_acc  int;
  v_rej  int;
  v_stat qc_status;
  v_n    int;
  v_fg   text;
begin
  perform _require_user();
  select * into rec from qc_records where job_no = p_job_no and status = 'QC Pending' for update;
  if not found then raise exception '% is not awaiting QC.', p_job_no; end if;
  v_acc := _assert_qty(p_accepted, 'Accepted quantity', true);
  v_rej := _assert_qty(p_rejected, 'Rejected quantity', true);
  if v_acc + v_rej <> rec.input_qty then
    raise exception 'Accepted (%) + Rejected (%) must equal QC input (%).', v_acc, v_rej, rec.input_qty;
  end if;
  v_stat := case when v_acc = rec.input_qty then 'Approved' when v_acc = 0 then 'Rejected' else 'Partially Approved' end;

  update qc_records
     set accepted_qty = v_acc, rejected_qty = v_rej, status = v_stat, inspected_at = v_ts,
         inspector = coalesce(p_inspector, ''), rejection_reason = coalesce(p_rejection_reason, ''), remarks = coalesce(p_remarks, ''),
         check_dimensional = coalesce(p_dimensional, false), check_visual = coalesce(p_visual, false), check_hardness = coalesce(p_hardness, false)
   where id = rec.id;

  select * into j from jobs where job_no = p_job_no for update;
  select * into prod from products where id = j.product_id;
  perform _log(v_ts, 'qc', format('%s QC %s — %s PCS passed, %s rejected', p_job_no, lower(v_stat::text), v_acc, v_rej), p_job_no);

  if v_acc = 0 then
    update jobs set current_stage = 'scrapped' where job_no = p_job_no;
    perform _move(v_ts, p_job_no, 'QC', 'Rejection', 0, v_rej, coalesce(p_rejection_reason, ''));
    return null;
  end if;

  v_n  := next_doc_no('fg', _year(v_ts));
  v_fg := format('FG-%s-%s', _year(v_ts), lpad(v_n::text, 4, '0'));
  insert into finished_goods (id, job_no, product_id, qty, received_at, location)
  values (v_fg, p_job_no, prod.id, v_acc, v_ts,
          format('FG Store · Rack %s-%s', chr(64 + ((v_n - 1) % 6) + 1), (v_n % 4) + 1));
  update jobs set current_stage = 'finishedGoods' where job_no = p_job_no;
  perform _move(v_ts, p_job_no, 'QC', 'Finished Goods', v_acc, v_rej,
                case when v_rej > 0 then 'Rejected: ' || coalesce(p_rejection_reason, '') else '' end);
  perform _log(v_ts, 'fg', format('%s PCS %s added to Finished Goods (%s)', v_acc, prod.name, v_fg), p_job_no);
  return v_fg;
end $$;

-- ------------------------------------------------------------- dispatch ---
create function _sync_job_after_dispatch(p_job_no text) returns void
language sql as $$
  update jobs set current_stage = 'dispatched'
   where job_no = p_job_no
     and exists (select 1 from finished_goods where job_no = p_job_no)
     and not exists (select 1 from finished_goods where job_no = p_job_no and dispatched_qty <> qty);
$$;

-- Either pass p_bags = [{"qty":10,"weight":2.5}, …]  (bag-wise packing from the route card),
-- or p_qty + p_bag_count + p_weight (even split, e.g. 94 pcs in 10 bags → 9×10 + 1×4).
create function create_dispatch(
  p_fg_id      text,
  p_vehicle_no text,
  p_date       date,
  p_status     dispatch_status,
  p_bags       jsonb default null,
  p_qty        int default null,
  p_bag_count  int default null,
  p_weight     numeric default null,
  p_customer   text default null,
  p_driver     text default null,
  p_invoice_no text default null,
  p_ts         timestamptz default now()
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ts      timestamptz := coalesce(p_ts, now());
  fg        finished_goods;
  prod      products;
  v_unit_kg numeric;
  v_bags    jsonb := '[]'::jsonb;
  b         jsonb;
  i         int;
  q         int;
  w         numeric;
  v_tot_q   int := 0;
  v_tot_w   numeric := 0;
  v_per_bag int;
  v_left    int;
  v_n       int;
  v_no      text;
  v_avail   int;
  v_cust    text;
  v_vehicle text := upper(btrim(coalesce(p_vehicle_no, '')));
begin
  perform _require_user();
  select * into fg from finished_goods where id = p_fg_id for update;
  if not found then raise exception 'Select a finished goods lot.'; end if;
  select * into prod from products where id = fg.product_id;
  v_unit_kg := prod.finished_weight;

  if p_bags is not null then
    if jsonb_array_length(p_bags) = 0 then raise exception 'Add at least one bag.'; end if;
    i := 0;
    for b in select * from jsonb_array_elements(p_bags) loop
      i := i + 1;
      q := _assert_qty((b ->> 'qty')::numeric, format('Bag %s quantity', i));
      w := case when coalesce((b ->> 'weight')::numeric, 0) > 0 then round((b ->> 'weight')::numeric, 3) else round(q * v_unit_kg, 3) end;
      v_bags := v_bags || jsonb_build_object('no', i, 'qty', q, 'weight', w);
    end loop;
  else
    q := _assert_qty(p_qty, 'Dispatch quantity');
    i := _assert_qty(p_bag_count, 'Number of bags');
    if i > q then raise exception 'Number of bags cannot exceed dispatch quantity.'; end if;
    if not (coalesce(p_weight, 0) > 0) then raise exception 'Total weight must be greater than zero.'; end if;
    v_per_bag := ceil(q::numeric / i)::int;
    v_left := q;
    for n in 1..i loop
      exit when v_left <= 0;
      v_bags := v_bags || jsonb_build_object('no', n, 'qty', least(v_per_bag, v_left),
                                             'weight', round(least(v_per_bag, v_left) * (p_weight / q), 3));
      v_left := v_left - v_per_bag;
    end loop;
  end if;

  select coalesce(sum((x ->> 'qty')::int), 0), round(coalesce(sum((x ->> 'weight')::numeric), 0), 3)
    into v_tot_q, v_tot_w from jsonb_array_elements(v_bags) x;

  v_avail := fg.qty - fg.reserved_qty - fg.dispatched_qty;
  if v_tot_q > v_avail then
    raise exception 'Dispatch quantity (%) exceeds available finished goods (% PCS).', v_tot_q, v_avail;
  end if;
  if p_status = 'Dispatched' and v_vehicle = '' then raise exception 'Vehicle number is required to dispatch.'; end if;
  if p_date is null then raise exception 'Dispatch date is required.'; end if;

  v_cust := coalesce(nullif(btrim(p_customer), ''), (select customer from jobs where job_no = fg.job_no));
  v_n    := next_doc_no('dispatch', _year(v_ts));
  v_no   := format('DSP-%s-%s', _year(v_ts), lpad(v_n::text, 4, '0'));

  insert into dispatches (dispatch_no, fg_id, job_no, product_id, customer, qty, vehicle_no, driver, invoice_no, date, weight,
                          status, created_at, dispatched_at, sales_rate)
  values (v_no, fg.id, fg.job_no, fg.product_id, v_cust, v_tot_q, v_vehicle, coalesce(btrim(p_driver), ''),
          coalesce(nullif(btrim(p_invoice_no), ''), format('INV-%s-%s', _year(v_ts), lpad((v_n + 410)::text, 4, '0'))),
          p_date, v_tot_w, p_status, v_ts, case when p_status = 'Dispatched' then v_ts end,
          prod.sales_rate);                                  -- rate frozen at dispatch time

  insert into dispatch_bags (dispatch_no, bag_no, qty, weight)
  select v_no, (x ->> 'no')::int, (x ->> 'qty')::int, (x ->> 'weight')::numeric from jsonb_array_elements(v_bags) x;

  if p_status = 'Dispatched' then
    update finished_goods set dispatched_qty = dispatched_qty + v_tot_q where id = fg.id;
    perform _move(v_ts, fg.job_no, 'Finished Goods', 'Customer', v_tot_q, 0, format('%s · %s', v_no, v_vehicle));
    perform _log(v_ts, 'dispatch', format('%s PCS %s dispatched — %s (%s)', v_tot_q, prod.name, v_no, v_vehicle), fg.job_no);
    perform _sync_job_after_dispatch(fg.job_no);
  else
    update finished_goods set reserved_qty = reserved_qty + v_tot_q where id = fg.id;
    perform _log(v_ts, 'dispatch', format('%s PCS %s packed in %s bags, ready for dispatch — %s', v_tot_q, prod.name, jsonb_array_length(v_bags), v_no), fg.job_no);
  end if;
  return v_no;
end $$;

create function mark_dispatched(p_dispatch_no text, p_vehicle_no text, p_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ts      timestamptz := coalesce(p_ts, now());
  d         dispatches;
  v_vehicle text := upper(btrim(coalesce(p_vehicle_no, '')));
begin
  perform _require_user();
  select * into d from dispatches where dispatch_no = p_dispatch_no for update;
  if not found then raise exception '% not found.', p_dispatch_no; end if;
  if d.status = 'Dispatched' then raise exception '% is already dispatched.', p_dispatch_no; end if;
  if v_vehicle = '' then raise exception 'Vehicle number is required to dispatch.'; end if;

  perform 1 from finished_goods where id = d.fg_id for update;
  if not found then raise exception 'Finished goods lot missing.'; end if;
  update finished_goods set reserved_qty = reserved_qty - d.qty, dispatched_qty = dispatched_qty + d.qty where id = d.fg_id;
  update dispatches set status = 'Dispatched', vehicle_no = v_vehicle, dispatched_at = v_ts where dispatch_no = p_dispatch_no;

  perform _move(v_ts, d.job_no, 'Finished Goods', 'Customer', d.qty, 0, format('%s · %s', p_dispatch_no, v_vehicle));
  perform _log(v_ts, 'dispatch', format('%s PCS dispatched — %s (%s)', d.qty, p_dispatch_no, v_vehicle), d.job_no);
  perform _sync_job_after_dispatch(d.job_no);
end $$;

-- ------------------------------------------------------------- products ---
-- Product master. Writes go through here (not the table) because default_customer / sales_rate are confidential.
-- Director / plant head only. Payload keys: id, code, name, material, od, cutting_length, finished_weight,
-- ht_temperature, ht_soak_minutes, ht_process, ht_quench, die_no, default_customer, sales_rate, active
create function save_product(p_payload jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id text := btrim(coalesce(p_payload ->> 'id', ''));
begin
  perform _require_user();
  if not can_manage_masters() then
    raise exception 'Only the Director or Plant Head can change the product master.' using errcode = '42501';
  end if;
  if v_id = '' then raise exception 'Product id is required.'; end if;
  insert into products (id, code, name, material, od, cutting_length, finished_weight, ht_temperature, ht_soak_minutes,
                        ht_process, ht_quench, die_no, default_customer, sales_rate, active)
  values (v_id, p_payload ->> 'code', p_payload ->> 'name', p_payload ->> 'material', (p_payload ->> 'od')::numeric,
          (p_payload ->> 'cutting_length')::numeric, (p_payload ->> 'finished_weight')::numeric,
          (p_payload ->> 'ht_temperature')::int, (p_payload ->> 'ht_soak_minutes')::int,
          coalesce(p_payload ->> 'ht_process', ''), coalesce(p_payload ->> 'ht_quench', ''), coalesce(p_payload ->> 'die_no', ''),
          coalesce(p_payload ->> 'default_customer', ''), nullif(p_payload ->> 'sales_rate', '')::numeric,
          coalesce((p_payload ->> 'active')::boolean, true))
  on conflict (id) do update
    set code = excluded.code, name = excluded.name, material = excluded.material, od = excluded.od,
        cutting_length = excluded.cutting_length, finished_weight = excluded.finished_weight,
        ht_temperature = excluded.ht_temperature, ht_soak_minutes = excluded.ht_soak_minutes,
        ht_process = excluded.ht_process, ht_quench = excluded.ht_quench, die_no = excluded.die_no,
        default_customer = excluded.default_customer, sales_rate = excluded.sales_rate, active = excluded.active;
  return v_id;
end $$;

-- ---------------------------------------------------------------- reset ---
-- Replacement for “Clear all data”: empties stock and jobs, keeps masters, dies and users.
-- Not callable by app users (see 14); run it from the SQL editor or with the service role.
create function reset_transactional_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate dispatch_bags, dispatches, finished_goods, hardness_readings, hardness_reports, qc_records,
           stage_records, job_material_issues, jobs, raw_material_lots, movements, activity
           restart identity cascade;
  delete from doc_counters where kind in ('lot', 'job', 'fg', 'dispatch', 'hardness');
end $$;
