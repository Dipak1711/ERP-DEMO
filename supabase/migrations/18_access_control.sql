-- 18 · Configurable access (Settings → Access Control)
--
-- Until now one hard-coded rule decided who sees confidential data. This migration makes it configurable by the
-- Director / Plant Head, per role:
--
--   PAGES   every page of the app has a level per role:  hidden  |  read  |  write
--             hidden → the page is removed from the menu and cannot be opened
--             read   → the page opens, but nothing can be changed there
--             write  → full use. Enforced by the database: every action function checks it (_require_write).
--   FIELDS  five kinds of sensitive information can each be shown or hidden per role:
--             party_names, invoices, purchase_rates, sales_rates, die_cost
--             The database withholds the values (the masking views read can_see_field()), so a hidden field never reaches the browser.
--
-- Director and Plant Head always have full access and cannot be edited (no one can lock the admins out).
-- Editable roles: accounts, qc, operator, viewer. Defaults reproduce the old behaviour (accounts see everything,
-- qc / operator / viewer see no sensitive data); viewer is read-only on every page, product master is read-only for everyone but the admins.
--
-- Safe to run on a database that already has 01–17.

-- ---------------------------------------------------------------- catalogs ---
create table app_resources (
  key      text primary key,
  label    text not null,
  section  text not null,
  sort     int  not null,
  writable boolean not null default true      -- false = a view-only page (nothing to "write")
);
insert into app_resources (key, label, section, sort, writable) values
  ('dashboard',      'Dashboard',              'Main Menu',          10, false),
  ('raw_inventory',  'Raw Inventory',          'Workflow',           20, true),
  ('cutting',        'Cutting',                'Workflow',           21, true),
  ('forging',        'Forging / Manufacturing','Workflow',           22, true),
  ('trimming',       'Trimming',               'Workflow',           23, true),
  ('heat_treatment', 'Heat Treatment',         'Workflow',           24, true),
  ('qc',             'Quality Control',        'Workflow',           25, true),
  ('finished_goods', 'Finished Goods',         'Workflow',           26, false),
  ('dispatch',       'Dispatch',               'Workflow',           27, true),
  ('die_master',     'Die Master',             'Die Management',     30, true),
  ('forging_dies',   'Forging Die Master',     'Die Management',     31, true),
  ('trimming_dies',  'Trimming Die Master',    'Die Management',     32, true),
  ('die_details',    'Die Details / History',  'Die Management',     33, false),
  ('traceability',   'Job Traceability',       'Reports & Masters',  40, false),
  ('ledger',         'Quantity Ledger',        'Reports & Masters',  41, false),
  ('products',       'Product Master',         'Reports & Masters',  42, true);

create table field_groups (
  key         text primary key,
  label       text not null,
  description text not null,
  sort        int  not null
);
insert into field_groups (key, label, description, sort) values
  ('party_names',    'Party names',                 'Customer, supplier and die-maker names, and the customer / supplier lists', 1),
  ('invoices',       'Invoice numbers',             'Supplier invoice numbers and dispatch invoice numbers',                      2),
  ('purchase_rates', 'Purchase rates & stock value','Rate per kg on raw material and the value of stock',                         3),
  ('sales_rates',    'Sales rates & amounts',       'Product sales rate, dispatch amount and finished-goods value',               4),
  ('die_cost',       'Die cost',                    'What each forging / trimming die cost',                                      5);

-- --------------------------------------------------------------- settings ---
create table role_page_access (
  role       app_role not null,
  resource   text not null references app_resources (key) on delete cascade,
  level      text not null check (level in ('hidden', 'read', 'write')),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (role, resource)
);
create table role_field_access (
  role        app_role not null,
  field_group text not null references field_groups (key) on delete cascade,
  visible     boolean not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid(),
  primary key (role, field_group)
);

-- ---------------------------------------------------------------- helpers ---
-- the roles the Director / Plant Head can configure
create function _editable_role(p_role app_role) returns boolean
language sql immutable as $$ select p_role in ('accounts', 'qc', 'operator', 'viewer') $$;

create function _is_full_access() returns boolean
language sql stable security definer set search_path = public as $$
  select _is_system() or coalesce(current_app_role() in ('director', 'plant_head'), false);
$$;

create function _default_level(p_role app_role, p_res text) returns text
language sql stable set search_path = public as $$
  select case
    when p_role in ('director', 'plant_head') then 'write'
    when not coalesce((select writable from app_resources where key = p_res), true) then 'read'
    when p_role = 'viewer' then 'read'
    when p_res = 'products' then 'read'
    else 'write' end;
$$;

create function _default_field(p_role app_role, p_group text) returns boolean
language sql immutable as $$ select p_role in ('director', 'plant_head', 'accounts') $$;

insert into role_page_access (role, resource, level)
  select r, a.key, _default_level(r, a.key)
    from unnest(array['accounts', 'qc', 'operator', 'viewer']::app_role[]) r cross join app_resources a;
insert into role_field_access (role, field_group, visible)
  select r, g.key, _default_field(r, g.key)
    from unnest(array['accounts', 'qc', 'operator', 'viewer']::app_role[]) r cross join field_groups g;

-- the signed-in user's level on a page: 'hidden' | 'read' | 'write'
create function page_level(p_res text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when _is_full_access() then 'write'
    else coalesce((select level from role_page_access where role = current_app_role() and resource = p_res), 'hidden')
  end;
$$;

-- may the signed-in user see this kind of sensitive information?
create function can_see_field(p_group text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when _is_full_access() then true
    else coalesce((select visible from role_field_access where role = current_app_role() and field_group = p_group), false)
  end;
$$;

create function mask_text(p text, p_group text) returns text
language sql stable as $$ select case when can_see_field(p_group) then p end $$;
create function mask_num(p numeric, p_group text) returns numeric
language sql stable as $$ select case when can_see_field(p_group) then p end $$;

-- every action function starts with this
create function _require_write(p_res text) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_label text;
begin
  if page_level(p_res) <> 'write' then
    select label into v_label from app_resources where key = p_res;
    raise exception 'You do not have permission to change %. Ask the Director or Plant Head for Write access.', coalesce(v_label, p_res)
      using errcode = '42501';
  end if;
end $$;

create function _die_resource(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select case kind when 'forging' then 'forging_dies' else 'trimming_dies' end from dies where code = p_code), 'die_master');
$$;

-- --------------------------------------------------------- what the app reads ---
create view v_my_access as
select current_app_role()   as role,
       _is_full_access()    as full_access,
       can_manage_masters() as can_manage_access,           -- Director / Plant Head: may open Settings → Access Control
       (select jsonb_object_agg(a.key, page_level(a.key)) from app_resources a) as pages,
       (select jsonb_object_agg(g.key, can_see_field(g.key)) from field_groups g) as fields
 where is_active_user();

-- ------------------------------------------------------- saving the settings ---
-- p_pages  = {"raw_inventory":"write","dispatch":"read",…}     p_fields = {"party_names":false,…}      (either may be partial)
create function save_role_access(p_role app_role, p_pages jsonb, p_fields jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  e record;
begin
  perform _require_user();
  if not can_manage_masters() then
    raise exception 'Only the Director or Plant Head can change access settings.' using errcode = '42501';
  end if;
  if not _editable_role(p_role) then
    raise exception 'Director and Plant Head always have full access and cannot be changed.';
  end if;

  for e in select key, value from jsonb_each_text(coalesce(p_pages, '{}'::jsonb)) loop
    if e.value not in ('hidden', 'read', 'write') then raise exception 'Unknown access level "%".', e.value; end if;
    if not exists (select 1 from app_resources where key = e.key) then raise exception 'Unknown page "%".', e.key; end if;
    if e.value = 'write' and not (select writable from app_resources where key = e.key) then
      raise exception '% has nothing to change, so it can only be Hidden or Read.', (select label from app_resources where key = e.key);
    end if;
    insert into role_page_access (role, resource, level) values (p_role, e.key, e.value)
    on conflict (role, resource) do update set level = excluded.level, updated_at = now(), updated_by = auth.uid();
  end loop;

  for e in select key, value from jsonb_each_text(coalesce(p_fields, '{}'::jsonb)) loop
    if not exists (select 1 from field_groups where key = e.key) then raise exception 'Unknown information type "%".', e.key; end if;
    insert into role_field_access (role, field_group, visible) values (p_role, e.key, e.value::boolean)
    on conflict (role, field_group) do update set visible = excluded.visible, updated_at = now(), updated_by = auth.uid();
  end loop;
end $$;

create function reset_role_access(p_role app_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  if not can_manage_masters() then
    raise exception 'Only the Director or Plant Head can change access settings.' using errcode = '42501';
  end if;
  if not _editable_role(p_role) then raise exception 'Director and Plant Head always have full access and cannot be changed.'; end if;
  update role_page_access  set level = _default_level(p_role, resource), updated_at = now(), updated_by = auth.uid() where role = p_role;
  update role_field_access set visible = _default_field(p_role, field_group), updated_at = now(), updated_by = auth.uid() where role = p_role;
end $$;

-- ------------------------------------------------ the product master action ---
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
        ht_process = excluded.ht_process, ht_quench = excluded.ht_quench, die_no = excluded.die_no,
        -- a role that cannot see these fields cannot change them either
        default_customer = case when can_see_field('party_names') then excluded.default_customer else products.default_customer end,
        sales_rate       = case when can_see_field('sales_rates') then excluded.sales_rate else products.sales_rate end,
        active = excluded.active;
  return v_id;
end $$;

-- ----------------------------------------------------- privileges and RLS ---
alter table app_resources      enable row level security;
alter table field_groups       enable row level security;
alter table role_page_access   enable row level security;
alter table role_field_access  enable row level security;
revoke all on app_resources, field_groups, role_page_access, role_field_access from anon, authenticated;
grant select on app_resources, field_groups to authenticated;
create policy app_resources_read on app_resources for select to authenticated using (is_active_user());
create policy field_groups_read  on field_groups  for select to authenticated using (is_active_user());
-- the full matrix is for the admins only (everyone else reads just their own row set through v_my_access)
grant select on role_page_access, role_field_access to authenticated;
create policy role_page_access_read  on role_page_access  for select to authenticated using (can_manage_masters());
create policy role_field_access_read on role_field_access for select to authenticated using (can_manage_masters());

-- customers / suppliers lists follow the "Party names" setting
drop policy if exists customers_read on customers;
drop policy if exists suppliers_read on suppliers;
create policy customers_read on customers for select to authenticated using (can_see_field('party_names'));
create policy suppliers_read on suppliers for select to authenticated using (can_see_field('party_names'));

-- new functions get EXECUTE for everyone by default on Supabase: take it back, then grant only what the app calls
revoke all on function _editable_role(app_role), _default_level(app_role, text), _default_field(app_role, text),
                       _require_write(text), _die_resource(text) from public, anon, authenticated;
revoke all on function _is_full_access() from public, anon;
grant execute on function _is_full_access() to authenticated;
revoke all on function page_level(text), can_see_field(text), mask_text(text, text), mask_num(numeric, text),
                       save_role_access(app_role, jsonb, jsonb), reset_role_access(app_role) from public, anon;
grant execute on function page_level(text), can_see_field(text), mask_text(text, text), mask_num(numeric, text),
                          save_role_access(app_role, jsonb, jsonb), reset_role_access(app_role) to authenticated;
grant select on v_my_access to authenticated;
revoke all on v_my_access from anon;

-- ============================================================================================================
-- Action functions: same behaviour as 10–12, plus  _require_write(<page>)  and per-field-group checks.
-- ============================================================================================================

create or replace function add_inward(
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
  perform _require_write('raw_inventory');
  if coalesce(btrim(p_material), '') = '' then raise exception 'Material is required.'; end if;
  if coalesce(btrim(p_supplier), '') = '' then raise exception 'Supplier is required.'; end if;
  if not (coalesce(p_od, 0) > 0) then raise exception 'OD / Size must be greater than zero.'; end if;
  v_qty := _assert_qty(p_qty, 'Quantity');
  if not (coalesce(p_weight, 0) > 0) then raise exception 'Weight must be greater than zero.'; end if;
  if p_inward_date is null then raise exception 'Inward date is required.'; end if;
  if p_purchase_rate is not null and not can_see_field('purchase_rates') then
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

create or replace function create_job(
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
  perform _require_write('cutting');
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

create or replace function complete_qc(
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
  perform _require_write('qc');
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

create or replace function mark_dispatched(p_dispatch_no text, p_vehicle_no text, p_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ts      timestamptz := coalesce(p_ts, now());
  d         dispatches;
  v_vehicle text := upper(btrim(coalesce(p_vehicle_no, '')));
begin
  perform _require_user();
  perform _require_write('dispatch');
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
           cycle_no = btrim(coalesce(p_payload ->> 'cycle_no', '')), drawing_no = btrim(coalesce(p_payload ->> 'drawing_no', '')),
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

create or replace function save_main_die(p_payload jsonb, p_code text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name  text := btrim(coalesce(p_payload ->> 'name', ''));
  v_part  text := btrim(coalesce(p_payload ->> 'part_code', ''));
  v_on    date := nullif(p_payload ->> 'created_on', '')::date;
  v_dup   text;
  v_code  text;
begin
  perform _require_user();
  perform _require_write('die_master');
  if v_name = '' then raise exception 'Enter the die / component name.'; end if;
  if v_part = '' then raise exception 'Enter the part code.'; end if;
  if v_on is null then raise exception 'Enter the creation date.'; end if;
  select code into v_dup from main_dies where lower(btrim(part_code)) = lower(v_part) and code is distinct from p_code;
  if v_dup is not null then raise exception 'Part code % already belongs to %.', v_part, v_dup; end if;

  if p_code is not null then
    update main_dies
       set name = v_name, part_code = v_part,
           description = btrim(coalesce(p_payload ->> 'description', '')),
           customer    = case when can_see_field('party_names') then unmask_keep(btrim(coalesce(p_payload ->> 'customer', '')), customer) else customer end,
           metal       = coalesce(nullif(p_payload ->> 'metal', ''), 'Brass')::metal_type,
           created_on  = v_on,
           status      = coalesce(nullif(p_payload ->> 'status', ''), 'Active')::main_die_status,
           remarks     = btrim(coalesce(p_payload ->> 'remarks', ''))
     where code = p_code
    returning code into v_code;
    if v_code is null then raise exception 'Main die % not found.', p_code; end if;
  else
    insert into main_dies (code, name, part_code, description, customer, metal, created_on, status, remarks)
    values (null, v_name, v_part, btrim(coalesce(p_payload ->> 'description', '')), unmask_keep(btrim(coalesce(p_payload ->> 'customer', '')), ''),
            coalesce(nullif(p_payload ->> 'metal', ''), 'Brass')::metal_type, v_on,
            coalesce(nullif(p_payload ->> 'status', ''), 'Active')::main_die_status, btrim(coalesce(p_payload ->> 'remarks', '')))
    returning code into v_code;
  end if;
  return v_code;
end $$;

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
           drawing_no = r.drawing_no, revision = r.revision,
           top_img_path = r.top_img_path, bottom_img_path = r.bottom_img_path,
           status = r.status, remarks = r.remarks, location = r.location, cost = case when can_see_field('die_cost') then r.cost else cost end, pieces = r.pieces
     where code = p_code and kind = p_kind          -- main_code is never changed on edit
    returning code into v_code;
    if v_code is null then raise exception '% die % not found.', p_kind, p_code; end if;
  end if;
  return v_code;
end $$;

create or replace function replace_die(p_kind die_kind, p_old_code text, p_payload jsonb, p_old_status die_status, p_reason text default '') returns text
language plpgsql security definer set search_path = public as $$
declare
  r      dies;
  old    dies;
  v_new  text;
  v_why  text := btrim(coalesce(p_reason, ''));
begin
  perform _require_user();
  perform _require_write(case p_kind when 'forging' then 'forging_dies' else 'trimming_dies' end);
  perform _validate_die_payload(p_kind, p_payload);
  if p_old_status not in ('Retired', 'Damaged') then raise exception 'The old die must be kept as Retired or Damaged.'; end if;
  select * into old from dies where code = p_old_code and kind = p_kind for update;
  if not found then raise exception '% die % not found.', p_kind, p_old_code; end if;

  r := _die_row(p_kind, p_payload);
  if not can_see_field('die_cost') then r.cost := null; end if;   -- cost is only entered by roles that may see it
  r.replaces_code := p_old_code;
  insert into dies select (r).* returning code into v_new;      -- trigger logs “Die created”

  perform _die_ctx(null, case when v_why <> '' then 'Reason: ' || v_why end, true);
  update dies set status = p_old_status, replaced_by_code = v_new where code = p_old_code;   -- trigger logs “Status changed”
  select * into old from dies where code = p_old_code;
  if p_old_status = 'Damaged' then
    perform _die_event(old, 'Die marked damaged', coalesce(nullif(v_why, ''), 'Marked damaged on replacement.'));
  end if;
  perform _die_event(old, 'Replacement die created', format('Replaced by %s. This record is kept for traceability.', v_new));
  perform _die_event((select d from dies d where d.code = v_new), 'Replacement die created', format('Replacement for %s.', p_old_code));
  perform _die_ctx();
  return v_new;
end $$;

create or replace function record_maintenance(p_code text, p_date date, p_remarks text, p_status die_status) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d    dies;
  v_id bigint;
begin
  perform _require_user();
  perform _require_write(_die_resource(p_code));
  if p_date is null then raise exception 'Enter the maintenance date.'; end if;
  if btrim(coalesce(p_remarks, '')) = '' then raise exception 'Enter the maintenance remarks.'; end if;
  select * into d from dies where code = p_code for update;
  if not found then raise exception 'Die % not found.', p_code; end if;

  insert into die_maintenance (die_code, date, remarks) values (p_code, p_date, btrim(p_remarks)) returning id into v_id;
  perform _die_ctx(p_date, null, true);
  perform _die_event(d, 'Maintenance recorded', btrim(p_remarks));
  update dies set last_maint_date = p_date, maint_remarks = btrim(p_remarks), status = p_status where code = p_code;  -- logs status change if any
  perform _die_ctx();
  return v_id;
end $$;

create or replace function issue_die(p_code text, p_date date, p_issued_to text, p_remarks text default '') returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d    dies;
  v_id bigint;
begin
  perform _require_user();
  perform _require_write(_die_resource(p_code));
  if p_date is null then raise exception 'Enter the issue date.'; end if;
  if btrim(coalesce(p_issued_to, '')) = '' then raise exception 'Enter who / which press the die is issued to.'; end if;
  select * into d from dies where code = p_code for update;
  if not found then raise exception 'Die % not found.', p_code; end if;
  if d.status <> 'Available' then raise exception 'Die % is % — only an Available die can be issued.', p_code, d.status; end if;

  insert into die_issues (die_code, issued_on, issued_to, remarks) values (p_code, p_date, btrim(p_issued_to), btrim(coalesce(p_remarks, '')))
  returning id into v_id;
  perform _die_ctx(p_date, 'Issued to ' || btrim(p_issued_to) || '.', true);
  update dies set status = 'In Production' where code = p_code;
  perform _die_ctx();
  return v_id;
end $$;

create or replace function return_die(p_code text, p_date date, p_pieces int, p_remarks text default '', p_status die_status default 'Available') returns void
language plpgsql security definer set search_path = public as $$
declare
  d dies;
begin
  perform _require_user();
  perform _require_write(_die_resource(p_code));
  if p_date is null then raise exception 'Enter the return date.'; end if;
  if p_pieces is null or p_pieces < 0 then raise exception 'Pieces produced cannot be negative.'; end if;
  select * into d from dies where code = p_code for update;
  if not found then raise exception 'Die % not found.', p_code; end if;
  if d.status <> 'In Production' then raise exception 'Die % is % — only a die In Production can be returned.', p_code, d.status; end if;

  update die_issues set returned_on = p_date, pieces = p_pieces, return_remarks = btrim(coalesce(p_remarks, ''))
   where die_code = p_code and returned_on is null;
  perform _die_ctx(p_date,
    format('Returned with %s pieces produced.%s', p_pieces, case when btrim(coalesce(p_remarks, '')) <> '' then ' ' || btrim(p_remarks) else '' end),
    true);
  update dies set status = p_status, pieces = pieces + p_pieces where code = p_code;
  perform _die_ctx();
end $$;

-- ============================================================================================================
-- Masking views: same columns as 13, but each sensitive column now follows its own setting (party names, invoices, …).
-- ============================================================================================================

create or replace view v_products as
select p.id, p.code, p.name, p.material, p.od, p.cutting_length, p.finished_weight,
       p.ht_temperature, p.ht_soak_minutes, p.ht_process, p.ht_quench, p.die_no, p.active,
       mask_text(p.default_customer, 'party_names') as default_customer,     -- confidential
       mask_num(p.sales_rate, 'sales_rates')        as sales_rate            -- confidential
  from products p
 where is_active_user();

create or replace view v_lots as
select l.id, l.material, l.material_type, l.od, l.inward_date, l.heat_no, l.inward_qty, l.inward_weight, l.available_qty,
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

create or replace view v_raw_inwards as
select l.id as lot_id, l.inward_date as date, l.material, l.material_type, l.od,
       l.inward_qty as qty, l.inward_weight as weight, l.created_at,
       mask_text(l.supplier, 'party_names')     as supplier,
       mask_text(l.invoice_no, 'invoices')   as invoice_no,
       mask_num(l.purchase_rate, 'purchase_rates') as purchase_rate
  from raw_material_lots l
 where is_active_user();

create or replace view v_jobs as
select j.job_no, j.product_id, j.planned_qty, j.material, j.od, j.due_date, j.priority, j.current_stage,
       j.piece_weight_g, j.die_no, j.machine_no, j.created_at,
       mask_text(j.customer, 'party_names') as customer                   -- confidential
  from jobs j
 where is_active_user();

create or replace view v_finished_goods as
select f.id, f.job_no, f.product_id, f.qty, f.reserved_qty, f.dispatched_qty, f.received_at, f.location,
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

create or replace view v_dispatches as
select d.dispatch_no, d.fg_id, d.job_no, d.product_id, d.qty, d.vehicle_no, d.driver, d.date, d.weight, d.status,
       d.created_at, d.dispatched_at,
       mask_text(d.customer, 'party_names')                 as customer,        -- confidential
       mask_text(d.invoice_no, 'invoices')               as invoice_no,      -- confidential
       mask_num(d.sales_rate, 'sales_rates')                as sales_rate,      -- confidential, ₹/pc
       mask_num(round(d.qty * d.sales_rate, 2), 'sales_rates') as amount        -- confidential, qty × rate
  from dispatches d
 where is_active_user();

create or replace view v_hardness_reports as
select h.id, h.job_no, h.date, h.component, h.material, h.grade, h.inward_qty, h.inspected_qty, h.cycle_no, h.drawing_no,
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

create or replace view v_job_summary as
select j.job_no, j.product_id, p.code as product_code, p.name as product_name,
       mask_text(j.customer, 'party_names') as customer,                     -- confidential
       j.priority, j.due_date,
       j.current_stage, j.planned_qty, j.created_at,
       coalesce(iss.qty, 0)::int                                         as issued_qty,
       coalesce(iss.weight, 0)                                           as issued_weight,
       coalesce(pl.loss, 0)::int                                         as process_loss,
       coalesce(case when q.status <> 'QC Pending' then q.rejected_qty end, 0) as qc_rejected,
       coalesce(pl.loss, 0)::int + coalesce(case when q.status <> 'QC Pending' then q.rejected_qty end, 0) as total_loss,
       coalesce(fg.dispatched, 0)::int                                   as dispatched_qty,
       coalesce(fg.available, 0)::int                                    as fg_available_qty,
       case j.current_stage
         when 'cutting' then cs.input_qty when 'forging' then cs.input_qty
         when 'trimming' then cs.input_qty when 'heatTreatment' then cs.input_qty
         when 'qc' then q.input_qty
         when 'finishedGoods' then coalesce(fg.remaining, 0)
         when 'dispatched' then coalesce(fg.dispatched, 0)
         else 0 end                                                      as current_qty,
       case j.current_stage
         when 'cutting' then case cs.status when 'In Progress' then 'In Progress' else 'Pending' end
         when 'forging' then case cs.status when 'In Progress' then 'In Progress' else 'Pending' end
         when 'trimming' then case cs.status when 'In Progress' then 'In Progress' else 'Pending' end
         when 'heatTreatment' then case cs.status when 'In Progress' then 'In Progress' else 'Pending' end
         when 'qc' then 'QC Pending'
         when 'finishedGoods' then 'Ready for Dispatch'
         when 'dispatched' then 'Dispatched'
         else 'Rejected' end                                             as status,
       case j.current_stage
         when 'cutting' then 1 when 'forging' then 2 when 'trimming' then 3 when 'heatTreatment' then 4
         when 'qc' then 5 when 'finishedGoods' then 6 when 'dispatched' then 7 else -1 end as flow_index,
       case when q.id is not null and q.status <> 'QC Pending' and coalesce(iss.qty, 0) > 0
            then round(coalesce(fg.total, 0)::numeric / iss.qty * 100, 1) end             as yield_pct
  from jobs j
  join products p on p.id = j.product_id
  left join qc_records q on q.job_no = j.job_no
  left join lateral (select sum(i.qty) as qty, sum(i.weight) as weight
                       from job_material_issues i where i.job_no = j.job_no) iss on true
  left join lateral (select sum(s.loss_qty) as loss
                       from stage_records s where s.job_no = j.job_no and s.status = 'Completed') pl on true
  left join lateral (select sum(f.qty) as total, sum(f.dispatched_qty) as dispatched,
                            sum(f.qty - f.reserved_qty - f.dispatched_qty) as available,
                            sum(f.qty - f.dispatched_qty) as remaining
                       from finished_goods f where f.job_no = j.job_no) fg on true
  left join lateral (select s.input_qty, s.status
                       from stage_records s
                      where s.job_no = j.job_no and s.stage::text = j.current_stage::text
                      order by s.id desc limit 1) cs on true
 where is_active_user();

create or replace view v_main_dies as
select m.code, m.name, m.part_code, m.description, m.metal, m.created_on, m.status, m.remarks, m.is_demo, m.created_at, m.updated_at,
       mask_text(m.customer, 'party_names') as customer                     -- confidential
  from main_dies m
 where is_active_user();

create or replace view v_dies as
select d.code, d.kind, d.main_code, d.material,
       d.top_l, d.top_w, d.top_h, d.bottom_l, d.bottom_w, d.bottom_h, d.top_weight, d.bottom_weight,
       d.making_date, d.drawing_no, d.revision, d.top_img_path, d.bottom_img_path, d.status, d.remarks, d.location,
       d.pieces, d.last_maint_date, d.maint_remarks, d.replaces_code, d.replaced_by_code, d.is_demo, d.created_at, d.updated_at,
       mask_text(d.maker, 'party_names') as maker,                          -- confidential (vendor)
       mask_num(d.cost, 'die_cost')   as cost                            -- confidential
  from dies d
 where is_active_user();

create or replace view v_die_summary as
select m.code as main_code, m.name, m.part_code, mask_text(m.customer, 'party_names') as customer, m.metal, m.status, m.created_on,
       count(d.*) filter (where d.kind = 'forging')::int  as forging_dies,
       count(d.*) filter (where d.kind = 'trimming')::int as trimming_dies,
       count(d.*) filter (where d.status = 'Available')::int          as available,
       count(d.*) filter (where d.status = 'Under Maintenance')::int  as under_maintenance,
       count(d.*) filter (where d.status in ('Damaged', 'Retired'))::int as damaged_or_retired
  from main_dies m
  left join dies d on d.main_code = m.code
 where is_active_user()
 group by m.code;

create or replace view v_sales_by_customer as
select d.customer, count(*)::int as dispatches, sum(d.qty)::int as qty,
       sum(d.qty * d.sales_rate) as amount
  from dispatches d
 where d.status = 'Dispatched' and can_see_field('party_names') and can_see_field('sales_rates')
 group by d.customer;

