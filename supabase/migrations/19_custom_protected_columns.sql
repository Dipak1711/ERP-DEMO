-- 19 · Add your own columns to "Sensitive information" (Settings → Access Control)
--
-- Besides the five built-in kinds of sensitive data, the Director / Plant Head can now pick further data columns from a
-- catalog and protect them per role, exactly like the built-in ones (Hidden / Visible per role).
--
--   column_catalog        the columns of the app that can be added (label + the page they appear on)
--   add_protected_columns / remove_protected_column     manage the list (admins only)
--   column_visible(key)   used by the masking views: a column that is not in the list is always visible
--
-- A protected column is withheld by the database for roles that may not see it, the screens drop it (column, line, field,
-- print, export), and editing a record as such a role never overwrites the hidden stored value.
-- New items start Visible for Accounts and Hidden for QC / Production / Viewer (like the other sensitive information).
--
-- Safe to run on a database that already has 01–18.

create table column_catalog (
  key        text primary key,
  label      text not null,
  page_label text not null,
  sort       int  not null
);
insert into column_catalog (key, label, page_label, sort) values
  ('raw.heat_no',           'Heat number',                     'Raw Inventory',        10),
  ('stage.operator',        'Operator / checked by (stages)',  'Production stages',    20),
  ('stage.machine',         'Machine (stages)',                'Production stages',    21),
  ('qc.inspector',          'QC inspector (checked by)',       'Quality Control',      30),
  ('hardness.cycle_drawing','Hardness cycle & drawing no.',    'Hardness reports',     31),
  ('dispatch.vehicle',      'Vehicle number',                  'Dispatch',             40),
  ('fg.location',           'Finished-goods location',         'Finished Goods',       50),
  ('product.die_no',        'Product die number',              'Product Master',       60),
  ('die.location',          'Die location / rack',             'Die Management',       70),
  ('die.drawing',           'Die drawing number',              'Die Management',       71),
  ('die.pieces',            'Pieces produced (dies)',          'Die Management',       72);

alter table field_groups
  add column is_custom   boolean not null default false,
  add column catalog_key text references column_catalog (key) on delete cascade;

-- may the signed-in user see this catalog column?  Not in the protected list → yes, for everyone.
create function column_visible(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when _is_full_access() then true
    else coalesce((select visible from role_field_access where role = current_app_role() and field_group = 'col:' || p_key), true)
  end;
$$;

create function add_protected_columns(p_keys text[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  k text;
  c column_catalog;
  n int := 0;
begin
  perform _require_user();
  if not can_manage_masters() then raise exception 'Only the Director or Plant Head can change access settings.' using errcode = '42501'; end if;
  foreach k in array coalesce(p_keys, '{}') loop
    select * into c from column_catalog where key = k;
    if not found then raise exception 'Unknown column "%".', k; end if;
    insert into field_groups (key, label, description, sort, is_custom, catalog_key)
    values ('col:' || c.key, c.label, c.page_label, 100 + c.sort, true, c.key)
    on conflict (key) do nothing;
    if found then
      insert into role_field_access (role, field_group, visible)
        select r, 'col:' || c.key, (r = 'accounts') from unnest(array['accounts', 'qc', 'operator', 'viewer']::app_role[]) r
      on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create function remove_protected_column(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  if not can_manage_masters() then raise exception 'Only the Director or Plant Head can change access settings.' using errcode = '42501'; end if;
  delete from field_groups where key = 'col:' || p_key and is_custom;   -- role rows go with it (cascade): the column is visible again
end $$;

-- catalog is readable by every active user (it only names columns)
alter table column_catalog enable row level security;
revoke all on column_catalog from anon, authenticated;
grant select on column_catalog to authenticated;
create policy column_catalog_read on column_catalog for select to authenticated using (is_active_user());

revoke all on function column_visible(text), add_protected_columns(text[]), remove_protected_column(text) from public, anon;
grant execute on function column_visible(text), add_protected_columns(text[]), remove_protected_column(text) to authenticated;

-- ------------------------------------------------ stage / QC records get masking views
-- (they were read straight from the tables; the machine / operator / inspector columns can now be protected)
create view v_stage_records as
select s.id, s.job_no, s.stage, s.input_qty, s.loss_qty, s.output_qty, s.status, s.received_at, s.started_at, s.completed_at,
       case when (select column_visible('stage.machine'))  then s.machine  end as machine,
       case when (select column_visible('stage.operator')) then s.operator end as operator,
       s.remarks, s.params, s.created_at, s.updated_at
  from stage_records s
 where is_active_user();

create view v_qc_records as
select q.id, q.job_no, q.input_qty, q.accepted_qty, q.rejected_qty, q.status, q.received_at, q.inspected_at,
       case when (select column_visible('qc.inspector')) then q.inspector end as inspector,
       q.rejection_reason, q.remarks, q.check_dimensional, q.check_visual, q.check_hardness, q.created_at, q.updated_at
  from qc_records q
 where is_active_user();

grant select on v_stage_records, v_qc_records to authenticated;
revoke all on v_stage_records, v_qc_records from anon;
revoke select on stage_records, qc_records from authenticated;     -- read them through the views (so the protection cannot be bypassed)

-- ============================================================================================================
-- Masking views: same columns as before; the protectable columns now follow the Settings → Access Control list.
-- ============================================================================================================

create or replace view v_lots as
select l.id, l.material, l.material_type, l.od, l.inward_date, case when (select column_visible('raw.heat_no')) then l.heat_no end as heat_no, l.inward_qty, l.inward_weight, l.available_qty,
       l.unit, l.created_at,
       l.material || '|' || trim_scale(l.od)::text                          as material_key,
       round(l.available_qty * (l.inward_weight / l.inward_qty), 3)         as available_weight,
       case when l.available_qty = 0                 then 'Consumed'
            when l.available_qty < l.inward_qty * 0.2 then 'Low Stock'
            else 'Available' end                                              as status,
       mask_text(l.supplier, 'party_names')      as supplier,                -- confidential
       mask_text(l.invoice_no, 'invoices')    as invoice_no,              -- confidential
       mask_num(l.purchase_rate, 'purchase_rates')  as purchase_rate,           -- confidential, ₹/KG
       mask_num(round(l.available_qty * (l.inward_weight / l.inward_qty) * l.purchase_rate, 2), 'purchase_rates') as stock_value  -- confidential
  from raw_material_lots l
 where is_active_user();

create or replace view v_dispatches as
select d.dispatch_no, d.fg_id, d.job_no, d.product_id, d.qty, case when (select column_visible('dispatch.vehicle')) then d.vehicle_no end as vehicle_no, d.driver, d.date, d.weight, d.status,
       d.created_at, d.dispatched_at,
       mask_text(d.customer, 'party_names')                 as customer,        -- confidential
       mask_text(d.invoice_no, 'invoices')               as invoice_no,      -- confidential
       mask_num(d.sales_rate, 'sales_rates')                as sales_rate,      -- confidential, ₹/pc
       mask_num(round(d.qty * d.sales_rate, 2), 'sales_rates') as amount        -- confidential, qty × rate
  from dispatches d
 where is_active_user();

create or replace view v_finished_goods as
select f.id, f.job_no, f.product_id, f.qty, f.reserved_qty, f.dispatched_qty, f.received_at, case when (select column_visible('fg.location')) then f.location end as location,
       p.name  as product_name,
       mask_text(j.customer, 'party_names')                                              as customer,    -- confidential
       f.qty - f.reserved_qty - f.dispatched_qty                         as available_qty,
       round(f.qty * p.finished_weight, 3)                               as weight,
       case when f.dispatched_qty = f.qty                                 then 'Dispatched'
            when f.dispatched_qty > 0                                     then 'Partially Dispatched'
            when f.qty - f.reserved_qty - f.dispatched_qty = 0            then 'Reserved'
            else 'Available' end                                          as status,
       mask_num(round((f.qty - f.reserved_qty - f.dispatched_qty) * p.sales_rate, 2), 'sales_rates') as available_value  -- confidential
  from finished_goods f
  join products p on p.id = f.product_id
  join jobs j     on j.job_no = f.job_no
 where is_active_user();

create or replace view v_products as
select p.id, p.code, p.name, p.material, p.od, p.cutting_length, p.finished_weight,
       p.ht_temperature, p.ht_soak_minutes, p.ht_process, p.ht_quench, case when (select column_visible('product.die_no')) then p.die_no end as die_no, p.active,
       mask_text(p.default_customer, 'party_names') as default_customer,     -- confidential
       mask_num(p.sales_rate, 'sales_rates')        as sales_rate            -- confidential
  from products p
 where is_active_user();

create or replace view v_hardness_reports as
select h.id, h.job_no, h.date, h.component, h.material, h.grade, h.inward_qty, h.inspected_qty, case when (select column_visible('hardness.cycle_drawing')) then h.cycle_no end as cycle_no, case when (select column_visible('hardness.cycle_drawing')) then h.drawing_no end as drawing_no,
       h.checked_by, h.scale, h.min_hardness, h.max_hardness, h.remarks, h.created_at, h.updated_at,
       mask_text(h.supplier, 'party_names') as supplier,                       -- confidential
       coalesce((select jsonb_agg(r.value order by r.sr_no) from hardness_readings r where r.report_id = h.id), '[]'::jsonb) as readings,
       case
         when exists (select 1 from hardness_readings r
                       where r.report_id = h.id and r.value is not null and (r.value < h.min_hardness or r.value > h.max_hardness))
              then 'Fail'
         when not exists (select 1 from hardness_readings r where r.report_id = h.id)
              or exists (select 1 from hardness_readings r where r.report_id = h.id and r.value is null)
              then 'Incomplete'
         else 'Pass'
       end as verdict
  from hardness_reports h
 where is_active_user();

create or replace view v_dies as
select d.code, d.kind, d.main_code, d.material,
       d.top_l, d.top_w, d.top_h, d.bottom_l, d.bottom_w, d.bottom_h, d.top_weight, d.bottom_weight,
       d.making_date, case when (select column_visible('die.drawing')) then d.drawing_no end as drawing_no, d.revision, d.top_img_path, d.bottom_img_path, d.status, d.remarks, case when (select column_visible('die.location')) then d.location end as location,
       case when (select column_visible('die.pieces')) then d.pieces end as pieces, d.last_maint_date, d.maint_remarks, d.replaces_code, d.replaced_by_code, d.is_demo, d.created_at, d.updated_at,
       mask_text(d.maker, 'party_names') as maker,                          -- confidential (vendor)
       mask_num(d.cost, 'die_cost')   as cost                            -- confidential
  from dies d
 where is_active_user();

-- ============================================================================================================
-- Action functions: a role that cannot see a protected column leaves its stored value untouched when it edits a record.
-- ============================================================================================================

create or replace function save_die(p_kind die_kind, p_payload jsonb, p_code text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  r         dies;
  v_code    text;
  v_payload jsonb := p_payload;
begin
  perform _require_user();
  perform _require_write(case p_kind when 'forging' then 'forging_dies' else 'trimming_dies' end);
  -- A role that may not see the maker cannot send it when editing (the app never loads it): keep the stored one,
  -- so the "maker is required" rule applies to NEW dies only for that role.
  if p_code is not null and not can_see_field('party_names') then
    v_payload := jsonb_set(v_payload, '{maker}', to_jsonb(coalesce((select maker from dies where code = p_code), '')));
  end if;
  perform _validate_die_payload(p_kind, v_payload);
  r := _die_row(p_kind, v_payload);
  if not can_see_field('die_cost') then r.cost := null; end if;   -- only privileged roles may enter a die cost

  if p_code is null then
    insert into dies select (r).* returning code into v_code;
  else
    perform _die_ctx();
    update dies
       set material = r.material, top_l = r.top_l, top_w = r.top_w, top_h = r.top_h,
           bottom_l = r.bottom_l, bottom_w = r.bottom_w, bottom_h = r.bottom_h,
           top_weight = r.top_weight, bottom_weight = r.bottom_weight,
           making_date = r.making_date,
           maker = case when can_see_field('party_names') then unmask_keep(r.maker, maker) else maker end,   -- confidential: unchanged unless caller has access
           drawing_no = case when column_visible('die.drawing') then r.drawing_no else drawing_no end, revision = r.revision,
           top_img_path = r.top_img_path, bottom_img_path = r.bottom_img_path,
           status = r.status, remarks = r.remarks, location = case when column_visible('die.location') then r.location else location end, cost = case when can_see_field('die_cost') then r.cost else cost end, pieces = case when column_visible('die.pieces') then r.pieces else pieces end
     where code = p_code and kind = p_kind          -- main_code is never changed on edit
    returning code into v_code;
    if v_code is null then raise exception '% die % not found.', p_kind, p_code; end if;
  end if;
  return v_code;
end $$;

create or replace function save_hardness_report(p_payload jsonb, p_id text default null, p_ts timestamptz default now()) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ts        timestamptz := coalesce(p_ts, now());
  v_component text    := btrim(coalesce(p_payload ->> 'component', ''));
  v_material  text    := btrim(coalesce(p_payload ->> 'material', ''));
  v_grade     text    := btrim(coalesce(p_payload ->> 'grade', ''));
  v_checked   text    := btrim(coalesce(p_payload ->> 'checked_by', ''));
  v_job       text    := nullif(btrim(coalesce(p_payload ->> 'job_no', '')), '');
  v_date      date    := nullif(p_payload ->> 'date', '')::date;
  v_min       numeric := nullif(p_payload ->> 'min_hardness', '')::numeric;
  v_max       numeric := nullif(p_payload ->> 'max_hardness', '')::numeric;
  v_scale     hardness_scale := coalesce(nullif(p_payload ->> 'scale', ''), 'HRB')::hardness_scale;
  v_inspected int;
  v_inward    int;
  v_readings  jsonb   := coalesce(p_payload -> 'readings', '[]'::jsonb);
  v_count     int;
  v_id        text;
  v_verdict   text;
begin
  perform _require_user();
  perform _require_write('qc');
  if v_component = '' then raise exception 'Enter the component name.'; end if;
  if v_date is null then raise exception 'Enter the inspection date.'; end if;
  if v_material not in ('Aluminium', 'Brass', 'Copper') then raise exception 'Select the material: Aluminium, Brass or Copper.'; end if;
  if v_grade <> '' and not exists (
       select 1 from material_master m join hardness_specs h using (material)
        where m.family = v_material and m.grade = v_grade) then
    raise exception 'Grade % does not belong to %.', v_grade, v_material;
  end if;
  if v_checked = '' then raise exception 'Enter who checked the hardness.'; end if;
  if coalesce(v_min, 0) <= 0 or coalesce(v_max, 0) <= 0 then raise exception 'Enter the required hardness range (both limits).'; end if;
  if v_min > v_max then raise exception 'Required hardness: the lower limit cannot be above the upper limit.'; end if;

  v_inspected := _assert_qty(nullif(p_payload ->> 'inspected_qty', '')::numeric, 'Inspected quantity');
  v_inward    := _assert_qty(coalesce(nullif(p_payload ->> 'inward_qty', '')::numeric, 0), 'Inward quantity', true);
  if v_inward > 0 and v_inspected > v_inward then
    raise exception 'Inspected quantity (%) cannot exceed inward quantity (%).', v_inspected, v_inward;
  end if;

  v_count := jsonb_array_length(v_readings);
  if v_count = 0 then raise exception 'Add at least one hardness reading.'; end if;
  if v_count > v_inspected then
    raise exception '% readings cannot be taken from % inspected piece%.', v_count, v_inspected, case when v_inspected = 1 then '' else 's' end;
  end if;
  if v_count > 50 then raise exception 'A report holds at most 50 readings.'; end if;
  if exists (select 1 from jsonb_array_elements(v_readings) r
              where jsonb_typeof(r) <> 'null' and (jsonb_typeof(r) <> 'number' or (r #>> '{}')::numeric <= 0)) then
    raise exception 'Hardness readings must be positive numbers.';
  end if;
  if v_job is not null and not exists (select 1 from jobs where job_no = v_job) then
    raise exception 'Job % does not exist.', v_job;
  end if;

  if p_id is not null then
    v_id := p_id;
    update hardness_reports
       set job_no = v_job, date = v_date, component = v_component, material = v_material, grade = v_grade,
           supplier = case when can_see_field('party_names') then unmask_keep(btrim(coalesce(p_payload ->> 'supplier', '')), supplier) else supplier end,  -- masked users cannot overwrite it
           inward_qty = v_inward, inspected_qty = v_inspected,
           cycle_no = case when column_visible('hardness.cycle_drawing') then btrim(coalesce(p_payload ->> 'cycle_no', '')) else cycle_no end,
           drawing_no = case when column_visible('hardness.cycle_drawing') then btrim(coalesce(p_payload ->> 'drawing_no', '')) else drawing_no end,
           checked_by = v_checked, scale = v_scale, min_hardness = v_min, max_hardness = v_max,
           remarks = btrim(coalesce(p_payload ->> 'remarks', '')), updated_at = v_ts
     where id = p_id;
    if not found then raise exception 'Report % not found.', p_id; end if;
    delete from hardness_readings where report_id = p_id;
  else
    v_id := format('HIR-%s-%s', _year(v_ts), lpad(next_doc_no('hardness', _year(v_ts))::text, 4, '0'));
    insert into hardness_reports (id, job_no, date, component, material, grade, supplier, inward_qty, inspected_qty, cycle_no,
                                  drawing_no, checked_by, scale, min_hardness, max_hardness, remarks, created_at, updated_at)
    values (v_id, v_job, v_date, v_component, v_material, v_grade, unmask_keep(btrim(coalesce(p_payload ->> 'supplier', '')), ''), v_inward,
            v_inspected, btrim(coalesce(p_payload ->> 'cycle_no', '')), btrim(coalesce(p_payload ->> 'drawing_no', '')),
            v_checked, v_scale, v_min, v_max, btrim(coalesce(p_payload ->> 'remarks', '')), v_ts, v_ts);
  end if;

  insert into hardness_readings (report_id, sr_no, value)
  select v_id, ord::int, case when jsonb_typeof(r) = 'number' then (r #>> '{}')::numeric end
    from jsonb_array_elements(v_readings) with ordinality as t(r, ord);

  select verdict into v_verdict from v_hardness_reports where id = v_id;
  perform _log(v_ts, 'qc',
    case when p_id is null then format('Hardness report %s recorded for %s — %s', v_id, v_component, lower(v_verdict))
         else format('Hardness report %s updated — %s', v_id, lower(v_verdict)) end,
    v_job);
  return v_id;
end $$;

create or replace function save_product(p_payload jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id text := btrim(coalesce(p_payload ->> 'id', ''));
begin
  perform _require_user();
  perform _require_write('products');
  if v_id = '' then raise exception 'Product id is required.'; end if;
  insert into products (id, code, name, material, od, cutting_length, finished_weight, ht_temperature, ht_soak_minutes,
                        ht_process, ht_quench, die_no, default_customer, sales_rate, active)
  values (v_id, p_payload ->> 'code', p_payload ->> 'name', p_payload ->> 'material', (p_payload ->> 'od')::numeric,
          (p_payload ->> 'cutting_length')::numeric, (p_payload ->> 'finished_weight')::numeric,
          (p_payload ->> 'ht_temperature')::int, (p_payload ->> 'ht_soak_minutes')::int,
          coalesce(p_payload ->> 'ht_process', ''), coalesce(p_payload ->> 'ht_quench', ''), coalesce(p_payload ->> 'die_no', ''),
          case when can_see_field('party_names') then coalesce(p_payload ->> 'default_customer', '') else '' end,
          case when can_see_field('sales_rates') then nullif(p_payload ->> 'sales_rate', '')::numeric end,
          coalesce((p_payload ->> 'active')::boolean, true))
  on conflict (id) do update
    set code = excluded.code, name = excluded.name, material = excluded.material, od = excluded.od,
        cutting_length = excluded.cutting_length, finished_weight = excluded.finished_weight,
        ht_temperature = excluded.ht_temperature, ht_soak_minutes = excluded.ht_soak_minutes,
        ht_process = excluded.ht_process, ht_quench = excluded.ht_quench,
        die_no = case when column_visible('product.die_no') then excluded.die_no else products.die_no end,
        -- a role that cannot see these fields cannot change them either
        default_customer = case when can_see_field('party_names') then excluded.default_customer else products.default_customer end,
        sales_rate       = case when can_see_field('sales_rates') then excluded.sales_rate else products.sales_rate end,
        active = excluded.active;
  return v_id;
end $$;
