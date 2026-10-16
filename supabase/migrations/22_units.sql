-- ============================================================
-- 22 · Units of measure (Settings → Units)
-- ============================================================
-- One list of measuring units for the whole software, in four kinds:
--     quantity  (reference PCS)   weight (reference KG)   length (reference mm)   time (reference min)
-- Every unit says how many reference units it holds ("1 BOX = 50 PCS", "1 m = 1000 mm"). Any number box in the app that is
-- measured in one of these (PCS, KG, g, mm, min) gets a unit picker when the Director / Plant Head has switched on more than
-- one unit of that kind; the app converts to the box's own unit before saving, so stock, weights and sizes are always stored
-- the same way and the business rules never change.
-- Everyone signed in can READ the list (it is not confidential); only the Director / Plant Head can change it.
-- Needs 02 (can_manage_masters) and 14. Safe to run twice (and on a database that already ran the first version of 22).

-- an earlier version of this file had pcs_per_unit and no kind — upgrade it in place
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'units' and column_name = 'pcs_per_unit') then
    alter table units rename column pcs_per_unit to factor;
    alter table units add column if not exists kind text not null default 'quantity';
    alter table units drop constraint if exists units_code_check;
  end if;
end $$;

create table if not exists units (
  code       text primary key check (code ~ '^[A-Za-z0-9°][A-Za-z0-9°  ./-]{0,11}$'),
  name       text not null,
  kind       text not null default 'quantity' check (kind in ('quantity', 'weight', 'length', 'time')),
  factor     numeric not null default 1 check (factor > 0),     -- how many reference units (PCS / KG / mm / min) one of these holds
  active     boolean not null default true,
  sort       int not null default 100,
  created_at timestamptz not null default now()
);
alter table units drop constraint if exists units_kind_check;
alter table units add constraint units_kind_check check (kind in ('quantity', 'weight', 'length', 'time'));
create unique index if not exists units_code_ci on units (lower(code));

-- the reference unit of each kind (PCS, KG, mm, min) is always there, always active; the others start switched off
insert into units (code, name, kind, factor, active, sort) values
  ('PCS',   'Pieces',     'quantity', 1,           true,  1),
  ('PAIR',  'Pair',       'quantity', 2,           false, 2),
  ('DOZEN', 'Dozen',      'quantity', 12,          false, 3),
  ('KG',    'Kilogram',   'weight',   1,           true,  10),
  ('g',     'Gram',       'weight',   0.001,       false, 11),
  ('TON',   'Tonne',      'weight',   1000,        false, 12),
  ('LB',    'Pound',      'weight',   0.45359237,  false, 13),
  ('mm',    'Millimetre', 'length',   1,           true,  20),
  ('cm',    'Centimetre', 'length',   10,          false, 21),
  ('m',     'Metre',      'length',   1000,        false, 22),
  ('INCH',  'Inch',       'length',   25.4,        false, 23),
  ('min',   'Minute',     'time',     1,           true,  30),
  ('hr',    'Hour',       'time',     60,          false, 31)
on conflict (code) do nothing;

alter table units enable row level security;
revoke all on units from anon, authenticated;
grant select on units to authenticated;
drop policy if exists units_read on units;
create policy units_read on units for select to authenticated using (is_active_user());

-- add a unit or change one. The code is the key (it cannot be renamed). The four reference units keep factor 1, stay
-- active and keep their kind — only their name can change.
create or replace function save_unit(p_code text, p_name text, p_kind text, p_factor numeric, p_active boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_hit  text;
begin
  perform _require_user();
  if not can_manage_masters() then
    raise exception 'Only the Director or Plant Head can change units.' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Za-z0-9°][A-Za-z0-9°  ./-]{0,11}$' then raise exception 'Unit code: 1 to 12 letters or numbers, for example BOX.'; end if;
  if v_name = '' then raise exception 'Enter the unit name.'; end if;
  if v_code in ('PCS', 'KG', 'mm', 'min') then
    update units set name = v_name where code = v_code;
    return v_code;
  end if;
  if p_kind is null or p_kind not in ('quantity', 'weight', 'length', 'time') then raise exception 'Choose what this unit measures.'; end if;
  if coalesce(p_factor, 0) <= 0 then raise exception 'Enter how much one % holds.', v_code; end if;
  -- "box" and "BOX" are the same unit
  select code into v_hit from units where lower(code) = lower(v_code);
  if v_hit is not null then v_code := v_hit; end if;
  insert into units (code, name, kind, factor, active, sort)
  values (v_code, v_name, p_kind, p_factor, coalesce(p_active, true), coalesce((select max(sort) from units where kind = p_kind), 0) + 1)
  on conflict (code) do update set name = excluded.name, kind = excluded.kind, factor = excluded.factor, active = excluded.active;
  return v_code;
end $$;

create or replace function delete_unit(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  if not can_manage_masters() then
    raise exception 'Only the Director or Plant Head can change units.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_code, '')) in ('PCS', 'KG', 'mm', 'min') then raise exception '% is the base unit and cannot be deleted.', btrim(p_code); end if;
  delete from units where code = btrim(coalesce(p_code, ''));
  if not found then raise exception 'That unit no longer exists.'; end if;
end $$;

drop function if exists save_unit(text, text, numeric, boolean);   -- the first version's signature
revoke all on function save_unit(text, text, text, numeric, boolean), delete_unit(text) from public, anon;
grant execute on function save_unit(text, text, text, numeric, boolean), delete_unit(text) to authenticated;
