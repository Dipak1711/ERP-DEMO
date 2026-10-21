-- ============================================================
-- 29 · Make Plant Head configurable in Access Control
-- ============================================================
-- Director remains the sole immutable super-admin with permanent full access.
-- Plant Head can now be configured per-page (Hidden / Read / Write) and per-field in Settings → Access Control.

-- 1. Allow plant_head to be edited
create or replace function _editable_role(p_role app_role) returns boolean
language sql immutable as $$
  select p_role in ('plant_head', 'accounts', 'qc', 'operator', 'viewer');
$$;

-- 2. Only Director has hardcoded full access; Plant Head checks role_page_access and role_field_access
create or replace function _is_full_access() returns boolean
language sql stable security definer set search_path = public as $$
  select _is_system() or coalesce(current_app_role() = 'director', false);
$$;

-- 3. Default levels for plant_head when resetting or initialising
create or replace function _default_level(p_role app_role, p_res text) returns text
language sql stable set search_path = public as $$
  select case
    when p_role = 'director' then 'write'
    when not coalesce((select writable from app_resources where key = p_res), true) then 'read'
    when p_role = 'viewer' then 'read'
    when p_res = 'products' and p_role not in ('plant_head', 'director') then 'read'
    else 'write' end;
$$;

create or replace function _default_field(p_role app_role, p_group text) returns boolean
language sql immutable as $$
  select p_role in ('director', 'plant_head', 'accounts');
$$;

-- 4. Seed initial permissions for plant_head (defaults to write on all pages and visible on all sensitive fields)
insert into role_page_access (role, resource, level)
  select 'plant_head'::app_role, a.key, case when a.writable then 'write' else 'read' end
  from app_resources a
on conflict (role, resource) do nothing;

insert into role_field_access (role, field_group, visible)
  select 'plant_head'::app_role, g.key, true
  from field_groups g
on conflict (role, field_group) do nothing;

-- 5. Update save_role_access and reset_role_access error checks
create or replace function save_role_access(p_role app_role, p_pages jsonb, p_fields jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  e record;
begin
  perform _require_user();
  if not can_manage_masters() then
    raise exception 'Only the Director or Plant Head can change access settings.' using errcode = '42501';
  end if;
  if not _editable_role(p_role) then
    raise exception 'Director always has full access and cannot be changed.';
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

create or replace function reset_role_access(p_role app_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  if not can_manage_masters() then
    raise exception 'Only the Director or Plant Head can change access settings.' using errcode = '42501';
  end if;
  if not _editable_role(p_role) then raise exception 'Director always has full access and cannot be changed.'; end if;
  update role_page_access  set level = _default_level(p_role, resource), updated_at = now(), updated_by = auth.uid() where role = p_role;
  update role_field_access set visible = _default_field(p_role, field_group), updated_at = now(), updated_by = auth.uid() where role = p_role;
end $$;
