-- 12 · Die management: history triggers + RPCs (port of src/dies/DieContext.tsx).
--
-- History is written by triggers so every path (form edit, replace, maintenance, issue, return) logs the same events.
-- RPCs pass context to the triggers through transaction-local settings:
--   erp.event_date        back-dated date shown on the history line (default today)
--   erp.note              text appended to “Status changed”, e.g. “Issued to Press 2.”
--   erp.skip_detail_log   'on' = do not log “details updated / remarks updated / marked damaged”
-- Payload keys for the save_* functions are snake_case column names.

-- ------------------------------------------------------------ helpers ---
create function _die_setting(p_key text) returns text
language sql stable as $$ select nullif(current_setting(p_key, true), '') $$;

create function _die_event(p_die dies, p_event text, p_remarks text) returns void
language sql as $$
  insert into die_history (at, date, kind, die_code, main_code, event, remarks)
  values (clock_timestamp(), coalesce(_die_setting('erp.event_date')::date, current_date),
          p_die.kind, p_die.code, p_die.main_code, p_event, coalesce(p_remarks, ''));
$$;

create function _die_ctx(p_date date default null, p_note text default null, p_skip boolean default false) returns void
language plpgsql as $$
begin
  perform set_config('erp.event_date', coalesce(p_date::text, ''), true);
  perform set_config('erp.note', coalesce(p_note, ''), true);
  perform set_config('erp.skip_detail_log', case when p_skip then 'on' else '' end, true);
end $$;

-- ----------------------------------------------------------- triggers ---
create function main_dies_before_insert() returns trigger
language plpgsql as $$
declare v_max int;
begin
  if new.code is null or btrim(new.code) = '' then
    perform pg_advisory_xact_lock(hashtext('main_die_code'));
    select coalesce(max(substr(code, 5)::int), 0) + 1 into v_max from main_dies;
    new.code := 'DIE-' || lpad(v_max::text, 4, '0');
  end if;
  return new;
end $$;
create trigger main_dies_code before insert on main_dies for each row execute function main_dies_before_insert();

create function dies_before_insert() returns trigger
language plpgsql as $$
declare v_max int;
begin
  if new.code is null or btrim(new.code) = '' then
    perform pg_advisory_xact_lock(hashtext('die_code'));
    select coalesce(max(substr(code, 5)::int), 0) + 1 into v_max from dies where kind = new.kind;
    new.code := (case new.kind when 'forging' then 'FGD' else 'TRD' end) || '-' || lpad(v_max::text, 4, '0');
  end if;
  if exists (select 1 from main_dies where code = new.main_code and status = 'Inactive') then
    raise exception 'This main die is Inactive. Make it Active before adding dies.';
  end if;
  return new;
end $$;
create trigger dies_code before insert on dies for each row execute function dies_before_insert();

create function dies_after_insert() returns trigger
language plpgsql as $$
begin
  -- the maker is confidential, so it is kept out of the history feed
  perform _die_event(new, 'Die created', format('Made on %s, material %s.', new.making_date, new.material));
  return new;
end $$;
create trigger dies_history_insert after insert on dies for each row execute function dies_after_insert();

create function dies_after_update() returns trigger
language plpgsql as $$
declare
  v_changed text[] := '{}';
  v_skip    boolean := coalesce(_die_setting('erp.skip_detail_log'), '') = 'on';
begin
  if not v_skip then
    if old.material is distinct from new.material then v_changed := array_append(v_changed, 'material'); end if;
    if (old.top_l, old.top_w, old.top_h) is distinct from (new.top_l, new.top_w, new.top_h) then v_changed := array_append(v_changed, 'top die size'); end if;
    if (old.bottom_l, old.bottom_w, old.bottom_h) is distinct from (new.bottom_l, new.bottom_w, new.bottom_h) then v_changed := array_append(v_changed, 'bottom die size'); end if;
    if old.top_weight is distinct from new.top_weight then v_changed := array_append(v_changed, 'top weight'); end if;
    if old.bottom_weight is distinct from new.bottom_weight then v_changed := array_append(v_changed, 'bottom weight'); end if;
    if old.making_date is distinct from new.making_date then v_changed := array_append(v_changed, 'making date'); end if;
    if old.maker is distinct from new.maker then v_changed := array_append(v_changed, 'die maker'); end if;
    if old.drawing_no is distinct from new.drawing_no then v_changed := array_append(v_changed, 'drawing no.'); end if;
    if old.revision is distinct from new.revision then v_changed := array_append(v_changed, 'revision'); end if;
    if old.location is distinct from new.location then v_changed := array_append(v_changed, 'location'); end if;
    if old.cost is distinct from new.cost then v_changed := array_append(v_changed, 'cost'); end if;
    if old.pieces is distinct from new.pieces then v_changed := array_append(v_changed, 'pieces produced'); end if;
    if (old.top_img_path, old.bottom_img_path) is distinct from (new.top_img_path, new.bottom_img_path) then v_changed := array_append(v_changed, 'images'); end if;
    if array_length(v_changed, 1) > 0 then
      perform _die_event(new, 'Die details updated', 'Changed: ' || array_to_string(v_changed, ', ') || '.');
    end if;
  end if;

  if old.status is distinct from new.status then
    perform _die_event(new, 'Status changed',
      format('%s → %s.%s', old.status, new.status, coalesce(' ' || _die_setting('erp.note'), '')));
    if new.status = 'Damaged' and not v_skip then
      perform _die_event(new, 'Die marked damaged', coalesce(nullif(new.remarks, ''), 'Marked damaged from the die form.'));
    end if;
  end if;

  if not v_skip and old.remarks is distinct from new.remarks then
    perform _die_event(new, 'Remarks updated', coalesce(nullif(new.remarks, ''), '(cleared)'));
  end if;
  return new;
end $$;
create trigger dies_history_update after update on dies for each row execute function dies_after_update();

-- Nothing is ever deleted (matches the app: dies are retired, main dies deactivated).
create function forbid_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Records in % cannot be deleted. Retire the die or deactivate the main die instead.', tg_table_name;
end $$;
create trigger main_dies_no_delete  before delete on main_dies  for each row execute function forbid_delete();
create trigger dies_no_delete       before delete on dies       for each row execute function forbid_delete();
create trigger die_history_no_delete before delete on die_history for each row execute function forbid_delete();

-- --------------------------------------------------------------- RPCs ---
create function save_main_die(p_payload jsonb, p_code text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name  text := btrim(coalesce(p_payload ->> 'name', ''));
  v_part  text := btrim(coalesce(p_payload ->> 'part_code', ''));
  v_on    date := nullif(p_payload ->> 'created_on', '')::date;
  v_dup   text;
  v_code  text;
begin
  perform _require_user();
  if v_name = '' then raise exception 'Enter the die / component name.'; end if;
  if v_part = '' then raise exception 'Enter the part code.'; end if;
  if v_on is null then raise exception 'Enter the creation date.'; end if;
  select code into v_dup from main_dies where lower(btrim(part_code)) = lower(v_part) and code is distinct from p_code;
  if v_dup is not null then raise exception 'Part code % already belongs to %.', v_part, v_dup; end if;

  if p_code is not null then
    update main_dies
       set name = v_name, part_code = v_part,
           description = btrim(coalesce(p_payload ->> 'description', '')),
           customer    = case when can_see_confidential() then unmask_keep(btrim(coalesce(p_payload ->> 'customer', '')), customer) else customer end,
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

-- shared validation for save_die / replace_die
create function _validate_die_payload(p_kind die_kind, p_payload jsonb) returns void
language plpgsql stable as $$
declare k text;
begin
  if coalesce(p_payload ->> 'main_code', '') = '' or not exists (select 1 from main_dies where code = p_payload ->> 'main_code') then
    raise exception 'Select the main die this die belongs to.';
  end if;
  if btrim(coalesce(p_payload ->> 'material', '')) = '' then
    raise exception 'Enter the % die material / grade.', lower(p_kind::text);
  end if;
  if coalesce(p_payload ->> 'making_date', '') = '' then raise exception 'Enter the die making date.'; end if;
  if btrim(coalesce(p_payload ->> 'maker', '')) in ('', '••••••') then raise exception 'Enter the die maker name.'; end if;
  foreach k in array array['top_l','top_w','top_h','bottom_l','bottom_w','bottom_h','top_weight','bottom_weight','cost','pieces'] loop
    if coalesce(nullif(p_payload ->> k, '')::numeric, 0) < 0 then
      raise exception 'Dimensions, weights, cost and pieces cannot be negative.';
    end if;
  end loop;
end $$;

-- builds a full row from the payload (jsonb_populate_record leaves absent keys NULL, so defaults are applied by hand)
create function _die_row(p_kind die_kind, p_payload jsonb) returns dies
language plpgsql stable as $$
declare r dies;
begin
  r := jsonb_populate_record(null::dies, p_payload);
  r.code            := null;
  r.kind            := p_kind;
  r.material        := btrim(r.material);
  r.maker           := btrim(r.maker);
  r.drawing_no      := btrim(coalesce(r.drawing_no, ''));
  r.revision        := btrim(coalesce(nullif(r.revision, ''), 'R0'));
  r.status          := coalesce(r.status, 'Available');
  r.remarks         := btrim(coalesce(r.remarks, ''));
  r.location        := btrim(coalesce(r.location, ''));
  r.pieces          := coalesce(r.pieces, 0);
  r.replaces_code   := null;
  r.replaced_by_code := null;
  r.is_demo         := false;
  r.created_by      := auth.uid();
  r.created_at      := now();
  r.updated_at      := now();
  return r;
end $$;

-- Create (p_code null) or edit one die. Only that one record is touched — the sibling die type never is.
create function save_die(p_kind die_kind, p_payload jsonb, p_code text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  r      dies;
  v_code text;
begin
  perform _require_user();
  perform _validate_die_payload(p_kind, p_payload);
  r := _die_row(p_kind, p_payload);
  if not can_see_confidential() then r.cost := null; end if;   -- only privileged roles may enter a die cost

  if p_code is null then
    insert into dies select (r).* returning code into v_code;
  else
    perform _die_ctx();
    update dies
       set material = r.material, top_l = r.top_l, top_w = r.top_w, top_h = r.top_h,
           bottom_l = r.bottom_l, bottom_w = r.bottom_w, bottom_h = r.bottom_h,
           top_weight = r.top_weight, bottom_weight = r.bottom_weight,
           making_date = r.making_date,
           maker = case when can_see_confidential() then unmask_keep(r.maker, maker) else maker end,   -- confidential: unchanged unless caller has access
           drawing_no = r.drawing_no, revision = r.revision,
           top_img_path = r.top_img_path, bottom_img_path = r.bottom_img_path,
           status = r.status, remarks = r.remarks, location = r.location, cost = case when can_see_confidential() then r.cost else cost end, pieces = r.pieces
     where code = p_code and kind = p_kind          -- main_code is never changed on edit
    returning code into v_code;
    if v_code is null then raise exception '% die % not found.', p_kind, p_code; end if;
  end if;
  return v_code;
end $$;

-- Replacement: new die is created, the old one is kept as Retired / Damaged and linked both ways.
create function replace_die(p_kind die_kind, p_old_code text, p_payload jsonb, p_old_status die_status, p_reason text default '') returns text
language plpgsql security definer set search_path = public as $$
declare
  r      dies;
  old    dies;
  v_new  text;
  v_why  text := btrim(coalesce(p_reason, ''));
begin
  perform _require_user();
  perform _validate_die_payload(p_kind, p_payload);
  if p_old_status not in ('Retired', 'Damaged') then raise exception 'The old die must be kept as Retired or Damaged.'; end if;
  select * into old from dies where code = p_old_code and kind = p_kind for update;
  if not found then raise exception '% die % not found.', p_kind, p_old_code; end if;

  r := _die_row(p_kind, p_payload);
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

create function record_maintenance(p_code text, p_date date, p_remarks text, p_status die_status) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d    dies;
  v_id bigint;
begin
  perform _require_user();
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

create function issue_die(p_code text, p_date date, p_issued_to text, p_remarks text default '') returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d    dies;
  v_id bigint;
begin
  perform _require_user();
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

create function return_die(p_code text, p_date date, p_pieces int, p_remarks text default '', p_status die_status default 'Available') returns void
language plpgsql security definer set search_path = public as $$
declare
  d dies;
begin
  perform _require_user();
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
