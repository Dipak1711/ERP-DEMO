-- 11 · Hardness Inspection Report (port of saveHardnessReport in engine.ts).
--
-- p_payload keys (snake_case):
--   job_no, date, component, material, grade, supplier, inward_qty, inspected_qty, cycle_no, drawing_no,
--   checked_by, scale, min_hardness, max_hardness, remarks,
--   readings : [92.5, 88, null, …]   (Sr. No. = position + 1; null = not measured yet)
-- supplier is confidential: a caller without access may type one on a NEW report, but cannot change it on an existing one.
-- Pass p_id to update an existing report, omit it to create HIR-YYYY-NNNN. Returns the report id.

create function save_hardness_report(p_payload jsonb, p_id text default null, p_ts timestamptz default now()) returns text
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
           supplier = case when can_see_confidential() then unmask_keep(btrim(coalesce(p_payload ->> 'supplier', '')), supplier) else supplier end,  -- masked users cannot overwrite it
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
