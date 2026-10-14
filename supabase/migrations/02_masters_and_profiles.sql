-- 02 · Users/roles and master data (seed.ts, materials.ts, hardnessSpecs.ts).

-- ------------------------------------------------------------ profiles ---
create table profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  role       app_role not null default 'viewer',   -- least privilege until a director assigns a role
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on profiles for each row execute function set_updated_at();

-- every new auth user gets a profile (promote the first admin by hand, see PLAN.md)
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------- access control helpers ---
-- Who may see what (see PLAN.md §10):
--   director, plant_head  → all confidential data + management dashboards + master data
--   accounts              → confidential data (party names, rates, invoices, financial values)
--   qc, operator, viewer  → confidential fields come back masked ('••••••' / NULL); cannot enter rates
-- The SQL editor / service role counts as "system" (full access).
create function _is_system() returns boolean
language sql stable as $$
  select session_user in ('postgres', 'supabase_admin') or coalesce(auth.role(), '') = 'service_role';
$$;

create function current_app_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active;
$$;

create function is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select _is_system() or exists (select 1 from profiles where id = auth.uid() and active);
$$;

create function can_see_confidential() returns boolean
language sql stable security definer set search_path = public as $$
  select _is_system() or coalesce(current_app_role() in ('director', 'plant_head', 'accounts'), false);
$$;

create function can_see_management() returns boolean
language sql stable security definer set search_path = public as $$
  select _is_system() or coalesce(current_app_role() in ('director', 'plant_head'), false);
$$;

-- master data (products, customers, suppliers, material/hardness master …)
create function can_manage_masters() returns boolean
language sql stable security definer set search_path = public as $$
  select can_see_management();
$$;

-- fixed-width mask: the length of the real value is not leaked
create function mask_text(p text) returns text
language sql stable as $$
  select case when p is null then null when can_see_confidential() then p else '••••••' end;
$$;

-- Guard for every write path: a client that echoes a masked value back must not overwrite the real one.
create function unmask_keep(p_new text, p_old text) returns text
language sql immutable as $$
  select case when p_new = '••••••' then p_old else p_new end;
$$;

create function mask_num(p numeric) returns numeric
language sql stable as $$
  select case when can_see_confidential() then p end;
$$;

-- ----------------------------------------------------- simple name lists ---
-- customers / suppliers: the whole list is confidential (RLS in 14)
create table customers (
  id         bigint generated always as identity primary key,
  name       text not null unique check (btrim(name) <> ''),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table suppliers (
  id         bigint generated always as identity primary key,
  name       text not null unique check (btrim(name) <> ''),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table machines (
  id     bigint generated always as identity primary key,
  name   text not null unique check (btrim(name) <> ''),
  stage  process_stage not null,
  active boolean not null default true
);

create table operators (
  id     bigint generated always as identity primary key,
  name   text not null unique check (btrim(name) <> ''),
  active boolean not null default true
);

create table inspectors (
  id     bigint generated always as identity primary key,
  name   text not null unique check (btrim(name) <> ''),
  active boolean not null default true
);

-- ------------------------------------------------------ material master ---
-- Round bars used in forging. `material` is the name stock is tracked under (with OD).
create table material_master (
  material   text primary key,
  family     text not null,
  grade      text not null,
  density    numeric(5, 2) not null check (density > 0),  -- g/cm³, nominal
  default_od numeric(8, 2) not null check (default_od > 0)
);

-- Required hardness per material (client's sheet F QC 03). Only Al / Brass / Cu are reported.
create table hardness_specs (
  material     text primary key references material_master (material) on update cascade,
  min_hardness numeric(6, 1) not null check (min_hardness > 0),
  max_hardness numeric(6, 1) not null check (max_hardness > 0),
  scale        hardness_scale not null default 'HRB',
  check (min_hardness <= max_hardness)
);

-- --------------------------------------------------------------- products ---
create table products (
  id               text primary key,                  -- 'P-9084'
  code             text not null unique,              -- '9084'
  name             text not null,
  material         text not null references material_master (material) on update cascade,
  od               numeric(8, 2) not null check (od > 0),            -- mm
  cutting_length   numeric(8, 2) not null check (cutting_length > 0), -- mm
  finished_weight  numeric(10, 4) not null check (finished_weight > 0), -- kg / pc
  ht_temperature   int not null check (ht_temperature > 0),            -- °C
  ht_soak_minutes  int not null check (ht_soak_minutes > 0),
  ht_process       text not null default '',
  ht_quench        text not null default '',
  die_no           text not null default '',
  default_customer text not null default '',                       -- CONFIDENTIAL (party name)
  sales_rate       numeric(12, 2) check (sales_rate is null or sales_rate >= 0), -- CONFIDENTIAL, ₹ per piece
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger products_updated before update on products for each row execute function set_updated_at();
