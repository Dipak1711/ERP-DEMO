-- 17 · Fix: a role that cannot see die makers (qc / operator / viewer) could not EDIT an existing die.
-- The app never loads the maker for them, so the edit arrived without one and failed the "maker is required" check.
-- save_die now keeps the stored maker for those roles; the maker stays required for NEW dies.
-- Safe to run on a database that already has 01–16 (replaces the function; same signature, same privileges).

create or replace function save_die(p_kind die_kind, p_payload jsonb, p_code text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  r         dies;
  v_code    text;
  v_payload jsonb := p_payload;
begin
  perform _require_user();
  -- A role that may not see the maker cannot send it when editing (the app never loads it): keep the stored one,
  -- so the "maker is required" rule applies to NEW dies only for that role.
  if p_code is not null and not can_see_confidential() then
    v_payload := jsonb_set(v_payload, '{maker}', to_jsonb(coalesce((select maker from dies where code = p_code), '')));
  end if;
  perform _validate_die_payload(p_kind, v_payload);
  r := _die_row(p_kind, v_payload);
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
