-- ============================================================
-- 26 · Job work — customers who bring their own parts for only some of the processes
-- ============================================================
-- A JOB-WORK batch is an ordinary job card with a job_work row beside it:
--   · the customer's challan (number, date), the item, the quantity (and weight) received
--   · which processes to do (Cutting, Forging, Trimming, Heat Treatment) — the others are written down as "not required" and skipped
--   · whose material: "customer" (nothing is taken from our raw inventory) or "own" (Cutting issues our stock, oldest lot first)
--   · whether QC is needed (if not, the output goes straight to the customer's parts store)
--   · how it is charged: none / per piece / per kg / per process — recorded here; the rates and the amount follow the
--     "Sales rates" setting, so roles that may not see rates never see them
-- It is entered on its own page (Workflow → Job Work), tagged "Job work" everywhere, kept out of our finished-goods stock and sales
-- values, and returned with a return challan (dispatch without a sales rate).
-- Run AFTER 24 (re-running 24 later would replace complete_stage with its older version; re-run this file after it if that happens).
-- Needs 18, 19, 24. Safe to run twice.

create table if not exists job_work (
  job_no           text primary key references jobs (job_no) on delete cascade,
  challan_no       text not null default '',
  challan_date     date,
  item_description text not null default '',
  received_qty     int not null check (received_qty > 0),
  received_weight  numeric(12, 3) check (received_weight is null or received_weight >= 0),   -- KG
  material_source  text not null default 'customer' check (material_source in ('customer', 'own')),
  do_cutting       boolean not null default false,
  do_forging       boolean not null default false,
  do_trimming      boolean not null default false,
  do_heat_treatment boolean not null default false,
  qc_required      boolean not null default true,
  charge_basis     text not null default 'none' check (charge_basis in ('none', 'piece', 'kg', 'process')),
  rate             numeric(12, 2) check (rate is null or rate >= 0),        -- ₹ per piece or per kg   (confidential)
  process_rates    jsonb not null default '{}'::jsonb,                      -- ₹ per piece per process (confidential)
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint job_work_has_a_process check (do_cutting or do_forging or do_trimming or do_heat_treatment)
);
alter table job_work enable row level security;
revoke all on job_work from anon, authenticated;       -- clients read v_job_work, write through the functions below

-- the page in Access Control
insert into app_resources (key, label, section, sort, writable) values ('job_work', 'Job Work', 'Workflow', 28, true)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;
insert into role_page_access (role, resource, level)
  select r, 'job_work', _default_level(r, 'job_work')
    from unnest(array['accounts', 'qc', 'operator', 'viewer']::app_role[]) r
on conflict (role, resource) do nothing;

-- the masked read model (billable quantity and the amount are worked out here, never stored)
create or replace view v_job_work as
select w.job_no, w.challan_no, w.challan_date, w.item_description, w.received_qty, w.received_weight, w.material_source,
       w.do_cutting, w.do_forging, w.do_trimming, w.do_heat_treatment, w.qc_required, w.charge_basis, w.created_at,
       coalesce((select sum(f.qty) from finished_goods f where f.job_no = w.job_no), w.received_qty) as billable_qty,
       mask_num(w.rate, 'sales_rates')                                                              as rate,
       case when can_see_field('sales_rates') then w.process_rates end                              as process_rates,
       mask_num(case w.charge_basis
         when 'piece'   then round(coalesce((select sum(f.qty) from finished_goods f where f.job_no = w.job_no), w.received_qty) * coalesce(w.rate, 0), 2)
         when 'kg'      then round(coalesce(w.received_weight, 0) * coalesce(w.rate, 0), 2)
         when 'process' then round(coalesce((select sum(f.qty) from finished_goods f where f.job_no = w.job_no), w.received_qty) * (
                (case when w.do_cutting        then coalesce((w.process_rates ->> 'cutting')::numeric, 0)       else 0 end) +
                (case when w.do_forging        then coalesce((w.process_rates ->> 'forging')::numeric, 0)       else 0 end) +
                (case when w.do_trimming       then coalesce((w.process_rates ->> 'trimming')::numeric, 0)      else 0 end) +
                (case when w.do_heat_treatment then coalesce((w.process_rates ->> 'heatTreatment')::numeric, 0) else 0 end)), 2)
         end, 'sales_rates')                                                                        as amount
  from job_work w
 where is_active_user();
grant select on v_job_work to authenticated;
revoke all on v_job_work from anon;

-- ---------------------------------------------------------------- receive the parts: creates the job at its first process
create or replace function create_job_work(p_payload jsonb, p_ts timestamptz default now()) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ts    timestamptz := coalesce(p_ts, now());
  prod    products;
  v_qty   int;
  v_job   text;
  v_party boolean := can_see_field('party_names');
  v_rates boolean := can_see_field('sales_rates');
  v_pc    boolean := coalesce((p_payload #>> '{processes,cutting}')::boolean, false);
  v_pf    boolean := coalesce((p_payload #>> '{processes,forging}')::boolean, false);
  v_pt    boolean := coalesce((p_payload #>> '{processes,trimming}')::boolean, false);
  v_ph    boolean := coalesce((p_payload #>> '{processes,heatTreatment}')::boolean, false);
  v_src   text    := coalesce(nullif(p_payload ->> 'material_source', ''), 'customer');
  v_basis text    := coalesce(nullif(p_payload ->> 'charge_basis', ''), 'none');
  v_wt    numeric := nullif(p_payload ->> 'received_weight', '')::numeric;
  v_rate  numeric := nullif(p_payload ->> 'rate', '')::numeric;
  v_first text;
  v_avail bigint;
  s       text;
  v_flag  boolean;
  v_seen  boolean := false;
  v_params jsonb;
begin
  perform _require_user();
  perform _require_write('job_work');
  select * into prod from products where id = p_payload ->> 'product_id';
  if not found then raise exception 'Select the item.'; end if;
  v_qty := _assert_qty((p_payload ->> 'received_qty')::numeric, 'Received quantity');
  if not (v_pc or v_pf or v_pt or v_ph) then raise exception 'Tick at least one process to be done.'; end if;
  if v_src not in ('customer', 'own') then raise exception 'Choose whose material it is.'; end if;
  if v_src = 'own' and not v_pc then raise exception 'Our own material is only used by Cutting — tick Cutting, or choose the customer''s material.'; end if;
  if v_basis not in ('none', 'piece', 'kg', 'process') then raise exception 'Choose how this job is charged.'; end if;
  if v_wt is not null and v_wt < 0 then raise exception 'Weight cannot be negative.'; end if;
  if v_party and btrim(coalesce(p_payload ->> 'customer', '')) = '' then raise exception 'Enter the customer.'; end if;
  if v_src = 'own' then
    select coalesce(sum(available_qty), 0) into v_avail from raw_material_lots where material = prod.material and od = prod.od and available_qty > 0;
    if v_qty > v_avail then
      raise exception 'Insufficient raw material: % PCS needed but only % PCS available for % OD %mm.', v_qty, v_avail, prod.material, trim_scale(prod.od);
    end if;
  end if;

  v_first := case when v_pc then 'cutting' when v_pf then 'forging' when v_pt then 'trimming' else 'heatTreatment' end;
  v_job   := format('JOB-%s-%s', _year(v_ts), lpad(next_doc_no('job', _year(v_ts))::text, 4, '0'));

  insert into jobs (job_no, product_id, customer, planned_qty, material, od, due_date, priority, current_stage, die_no, machine_no, created_at)
  values (v_job, prod.id, case when v_party then btrim(coalesce(p_payload ->> 'customer', '')) else '' end, v_qty, prod.material, prod.od,
          nullif(p_payload ->> 'due_date', '')::date, coalesce(nullif(p_payload ->> 'priority', '')::job_priority, 'Normal'), v_first::job_stage,
          nullif(btrim(coalesce(p_payload ->> 'die_no', prod.die_no)), ''), null, v_ts);

  insert into job_work (job_no, challan_no, challan_date, item_description, received_qty, received_weight, material_source,
                        do_cutting, do_forging, do_trimming, do_heat_treatment, qc_required, charge_basis, rate, process_rates)
  values (v_job, btrim(coalesce(p_payload ->> 'challan_no', '')), nullif(p_payload ->> 'challan_date', '')::date,
          btrim(coalesce(p_payload ->> 'item_description', '')), v_qty, v_wt, v_src, v_pc, v_pf, v_pt, v_ph,
          coalesce((p_payload ->> 'qc_required')::boolean, true), v_basis,
          case when v_rates then v_rate end, case when v_rates then coalesce(p_payload -> 'process_rates', '{}'::jsonb) else '{}'::jsonb end);

  -- the stages before the first process are written down as "not required"; the first process waits for work
  foreach s in array array['cutting', 'forging', 'trimming', 'heatTreatment'] loop
    v_flag := case s when 'cutting' then v_pc when 'forging' then v_pf when 'trimming' then v_pt else v_ph end;
    if s = v_first then
      v_seen := true;
      v_params := case s
        when 'cutting'       then jsonb_build_object('cuttingLength', prod.cutting_length)
        when 'forging'       then jsonb_build_object('dieNo', coalesce(nullif(p_payload ->> 'die_no', ''), prod.die_no))
        when 'trimming'      then jsonb_build_object('trimDie', replace(prod.die_no, 'D-', 'T-'))
        else jsonb_build_object('temperature', prod.ht_temperature, 'soakMinutes', prod.ht_soak_minutes, 'process', prod.ht_process, 'quench', prod.ht_quench) end;
      insert into stage_records (job_no, stage, input_qty, status, received_at, params)
      values (v_job, s::process_stage, v_qty, 'Pending', v_ts, v_params);
    elsif not v_seen then
      insert into stage_records (job_no, stage, input_qty, loss_qty, output_qty, status, received_at, started_at, completed_at, remarks, params)
      values (v_job, s::process_stage, v_qty, 0, v_qty, 'Completed', v_ts, v_ts, v_ts, 'Not required — skipped', jsonb_build_object('skipped', 1, 'auto', 1));
    end if;
  end loop;

  perform _move(v_ts, v_job, 'Customer', stage_label(v_first), v_qty, 0,
                format('Challan %s · %s material', coalesce(nullif(btrim(p_payload ->> 'challan_no'), ''), '—'), case v_src when 'own' then 'our' else 'customer''s' end));
  perform _log(v_ts, 'job', format('%s job work received — %s PCS %s', v_job, v_qty, prod.name), v_job);
  return v_job;
end $$;

-- ---------------------------------------------------------------- delete a batch that has not been worked on yet
create or replace function delete_job_work(p_job_no text, p_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('job_work');
  if not exists (select 1 from job_work where job_no = p_job_no) then raise exception 'Job-work batch % does not exist.', p_job_no; end if;
  if exists (select 1 from job_material_issues where job_no = p_job_no)
     or exists (select 1 from stage_records where job_no = p_job_no and status <> 'Pending' and coalesce(params ->> 'auto', '') <> '1')
     or exists (select 1 from qc_records where job_no = p_job_no)
     or exists (select 1 from finished_goods where job_no = p_job_no)
     or exists (select 1 from hardness_reports where job_no = p_job_no) then
    raise exception 'Job-work batch % cannot be deleted — work on it has already started.', p_job_no;
  end if;
  delete from movements where job_no = p_job_no;
  delete from activity where job_no = p_job_no;
  delete from stage_records where job_no = p_job_no;
  delete from job_work where job_no = p_job_no;
  delete from jobs where job_no = p_job_no;
  perform _log(coalesce(p_ts, now()), 'job', format('Job-work batch %s deleted before work started', p_job_no));
end $$;

revoke all on function create_job_work(jsonb, timestamptz), delete_job_work(text, timestamptz) from public, anon;
grant execute on function create_job_work(jsonb, timestamptz), delete_job_work(text, timestamptz) to authenticated;

-- ---------------------------------------------------------------- the existing functions that now know about job work
create or replace function start_stage(
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
  perform _require_write(case p_stage when 'cutting' then 'cutting' when 'forging' then 'forging' when 'trimming' then 'trimming' else 'heat_treatment' end);
  select * into rec from stage_records where job_no = p_job_no and stage = p_stage and status <> 'Completed' for update;
  if not found then raise exception '% has no open % order.', p_job_no, stage_label(p_stage::text); end if;
  if rec.status <> 'Pending' then raise exception '% is already in progress at %.', p_job_no, stage_label(p_stage::text); end if;
  select * into j from jobs where job_no = p_job_no for update;

  v_qty := rec.input_qty;
  if p_stage = 'cutting' then
    v_qty := _assert_qty(coalesce(p_input_qty, rec.input_qty), 'Actual input quantity');
    -- job work on the CUSTOMER's material does not touch our raw inventory
    if not exists (select 1 from job_work where job_no = p_job_no and material_source = 'customer') then
      perform _issue_material(j, v_qty, v_ts);
    end if;
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

create or replace function complete_stage(
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
  v_fp     jsonb;
  v_skip_t  boolean;
  v_skip_ht boolean;
  jw       job_work;
  v_pl_f   boolean;
  v_pl_t   boolean;
  v_pl_h   boolean;
  v_n      int;
  v_fg     text;
begin
  perform _require_user();
  perform _require_write(case p_stage when 'cutting' then 'cutting' when 'forging' then 'forging' when 'trimming' then 'trimming' else 'heat_treatment' end);
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

  -- Skip Trimming / Skip Heat Treatment are chosen in the FORGING form (stored with the forging record). A skipped stage is written
  -- down as "not required" and passed over: the batch goes straight to the next stage that applies.
  select params into v_fp from stage_records where job_no = p_job_no and stage = 'forging';
  v_skip_t  := coalesce((v_fp ->> 'skipTrimming')::boolean, false);
  v_skip_ht := coalesce((v_fp ->> 'skipHeatTreatment')::boolean, false);
  -- a JOB-WORK batch only does the processes that were ticked when the parts were received
  select * into jw from job_work where job_no = p_job_no;
  v_pl_f := coalesce(jw.do_forging, true);
  v_pl_t := coalesce(jw.do_trimming, true) and not v_skip_t;
  v_pl_h := coalesce(jw.do_heat_treatment, true) and not v_skip_ht;
  loop
    if (v_next = 'forging' and not v_pl_f) or (v_next = 'trimming' and not v_pl_t) or (v_next = 'heatTreatment' and not v_pl_h) then
      insert into stage_records (job_no, stage, input_qty, loss_qty, output_qty, status, received_at, started_at, completed_at, remarks, params)
      values (p_job_no, v_next::text::process_stage, rec.output_qty, 0, rec.output_qty, 'Completed', v_ts, v_ts, v_ts, 'Not required — skipped',
              jsonb_build_object('skipped', 1, 'auto', 1));
      v_next := (case v_next when 'forging' then 'trimming' when 'trimming' then 'heatTreatment' else 'qc' end)::job_stage;
    else
      exit;
    end if;
  end loop;

  perform _move(v_ts, p_job_no, v_label, stage_label(v_next::text), rec.output_qty, v_loss);
  perform _log(v_ts, 'complete',
    format('%s %s completed — %s in, %s loss, %s PCS moved to %s', p_job_no, v_label, rec.input_qty, v_loss, rec.output_qty, stage_label(v_next::text)),
    p_job_no);
  update jobs set current_stage = v_next where job_no = p_job_no;

  if v_next = 'qc' then
    if coalesce(jw.qc_required, true) then
      insert into qc_records (job_no, input_qty, status, received_at) values (p_job_no, rec.output_qty, 'QC Pending', v_ts);
      return;
    end if;
    -- QC switched off for this job-work batch: everything that came out goes straight to the customer's parts store
    insert into qc_records (job_no, input_qty, accepted_qty, rejected_qty, status, received_at, inspected_at, remarks)
    values (p_job_no, rec.output_qty, rec.output_qty, 0, 'Approved', v_ts, v_ts, 'QC not required for this job-work batch');
    v_n  := next_doc_no('fg', _year(v_ts));
    v_fg := format('FG-%s-%s', _year(v_ts), lpad(v_n::text, 4, '0'));
    insert into finished_goods (id, job_no, product_id, qty, received_at, location)
    values (v_fg, p_job_no, prod.id, rec.output_qty, v_ts, 'Customer parts · job work');
    update jobs set current_stage = 'finishedGoods' where job_no = p_job_no;
    perform _move(v_ts, p_job_no, 'QC', 'Finished Goods', rec.output_qty, 0, 'QC not required');
    perform _log(v_ts, 'fg', format('%s PCS %s ready to return to the customer (job work) — %s', rec.output_qty, prod.name, v_fg), p_job_no);
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

create or replace function create_dispatch(
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
  perform _require_write('dispatch');
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
          case when exists (select 1 from job_work where job_no = fg.job_no) then null else prod.sales_rate end);   -- rate frozen at dispatch time (none for job work)

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
