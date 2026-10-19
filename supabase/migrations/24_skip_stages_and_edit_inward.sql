-- ============================================================
-- 24 · Skip Trimming / Skip Heat Treatment (chosen at Forging), and editable raw-material inwards
-- ============================================================
-- 1. The Forging form asks whether the batch should skip Trimming and / or Heat Treatment. The choice is kept with the forging record
--    (params.skipTrimming / params.skipHeatTreatment). When a stage is completed, complete_stage() writes each skipped stage down as
--    "not required" (so the route card still shows it) and sends the batch straight to the next stage that applies — a skipped stage
--    never appears in the Trimming / Heat Treatment pages. Nothing changes for batches that are not ticked.
-- 2. update_inward(): every inward lot can be corrected afterwards. Quantity cannot go below what is already issued to production;
--    material and size are locked once any of the lot has been issued; confidential fields (supplier, invoice, purchase rate) are
--    only changed by roles that may see them. The inward line in the quantity ledger follows the correction.
-- Needs 18, 19. Safe to run twice (and on a database that already ran the earlier product-level version of 24).

-- ---------------------------------------------------------------- stage routing
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
  loop
    if v_next = 'trimming' and v_skip_t then
      insert into stage_records (job_no, stage, input_qty, loss_qty, output_qty, status, received_at, started_at, completed_at, remarks, params)
      values (p_job_no, 'trimming', rec.output_qty, 0, rec.output_qty, 'Completed', v_ts, v_ts, v_ts, 'Not required — skipped',
              jsonb_build_object('skipped', 1, 'auto', 1));
      v_next := 'heatTreatment';
    elsif v_next = 'heatTreatment' and v_skip_ht then
      insert into stage_records (job_no, stage, input_qty, loss_qty, output_qty, status, received_at, started_at, completed_at, remarks, params)
      values (p_job_no, 'heatTreatment', rec.output_qty, 0, rec.output_qty, 'Completed', v_ts, v_ts, v_ts, 'Not required — skipped',
              jsonb_build_object('skipped', 1, 'auto', 1));
      v_next := 'qc';
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

-- ---------------------------------------------------------------- editable inward
create or replace function update_inward(
  p_lot_id        text,
  p_material      text,
  p_material_type text,
  p_od            numeric,
  p_supplier      text,
  p_inward_date   date,
  p_qty           int,
  p_weight        numeric,
  p_heat_no       text default null,
  p_invoice_no    text default null,
  p_purchase_rate numeric default null,
  p_ts            timestamptz default now()
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ts     timestamptz := coalesce(p_ts, now());
  lot      raw_material_lots;
  v_issued int;
  v_qty    int;
begin
  perform _require_user();
  perform _require_write('raw_inventory');
  select * into lot from raw_material_lots where id = p_lot_id for update;
  if not found then raise exception 'Lot % does not exist.', p_lot_id; end if;
  v_issued := lot.inward_qty - lot.available_qty;       -- already taken by production

  if coalesce(btrim(p_material), '') = '' then raise exception 'Material is required.'; end if;
  if can_see_field('party_names') and coalesce(btrim(p_supplier), '') = '' then raise exception 'Supplier is required.'; end if;
  if not (coalesce(p_od, 0) > 0) then raise exception 'OD / Size must be greater than zero.'; end if;
  v_qty := _assert_qty(p_qty, 'Quantity');
  if not (coalesce(p_weight, 0) > 0) then raise exception 'Weight must be greater than zero.'; end if;
  if p_inward_date is null then raise exception 'Inward date is required.'; end if;
  if p_purchase_rate < 0 then raise exception 'Purchase rate cannot be negative.'; end if;
  if not exists (select 1 from material_master where material = btrim(p_material)) then raise exception 'Unknown material %.', p_material; end if;
  if v_qty < v_issued then
    raise exception 'Quantity cannot be below % PCS — that much of this lot is already issued to production.', v_issued;
  end if;
  if v_issued > 0 and (btrim(p_material) <> lot.material or p_od <> lot.od) then
    raise exception 'Material and size cannot be changed — % PCS of this lot are already issued to production.', v_issued;
  end if;

  update raw_material_lots set
      material      = btrim(p_material),
      material_type = coalesce(btrim(p_material_type), ''),
      od            = p_od,
      -- a role that cannot see these fields cannot change them either
      supplier      = case when can_see_field('party_names')    then btrim(p_supplier)                    else supplier end,
      inward_date   = p_inward_date,
      heat_no       = case when column_visible('raw.heat_no')   then nullif(btrim(p_heat_no), '')         else heat_no end,
      invoice_no    = case when can_see_field('invoices')       then nullif(btrim(p_invoice_no), '')      else invoice_no end,
      purchase_rate = case when can_see_field('purchase_rates') then round(p_purchase_rate, 2)            else purchase_rate end,
      inward_qty    = v_qty,
      inward_weight = round(p_weight, 3),
      available_qty = v_qty - v_issued
    where id = p_lot_id;

  -- the quantity ledger keeps one line for this inward: bring it in step
  update movements
     set qty = v_qty, note = format('%s OD %smm · lot %s', btrim(p_material), trim_scale(p_od), p_lot_id)
   where from_loc = 'Supplier' and to_loc = 'Raw Inventory' and note like '%lot ' || p_lot_id;

  perform _log(v_ts, 'inward', format('Inward lot %s corrected — %s PCS %s (OD %smm)', p_lot_id, v_qty, btrim(p_material), trim_scale(p_od)));
  return p_lot_id;
end $$;

revoke all on function update_inward(text, text, text, numeric, text, date, int, numeric, text, text, numeric, timestamptz) from public, anon;
grant execute on function update_inward(text, text, text, numeric, text, date, int, numeric, text, text, numeric, timestamptz) to authenticated;
