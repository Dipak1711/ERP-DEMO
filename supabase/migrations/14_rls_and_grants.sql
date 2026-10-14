-- 14 · Row level security and privileges — the part that actually enforces confidentiality.
--
-- Roles (profiles.role)      confidential data        management dashboards   master data
--   director, plant_head     full                     yes                     edit
--   accounts                 full (parties, rates)    no                      read
--   qc, operator, viewer     MASKED                   no                      read
--
-- Mechanics
--   1. Tables that hold confidential columns (products, raw_material_lots, jobs, dispatches, hardness_reports,
--      main_dies, dies) are NOT readable by clients at all. Clients read the masking views in 13 instead.
--      → a masked user cannot get the real value with select *, ?select=customer, a join, an export or Realtime.
--   2. customers / suppliers (pure party lists) are readable only with can_see_confidential().
--   3. Every table is read-only for clients; data changes only through the SECURITY DEFINER functions in 10–12,
--      which enforce the business rules and refuse rate entry for roles that may not see rates.
--   4. `anon` gets nothing.

-- ---- start from a clean slate -------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- ---- enable RLS everywhere ----------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---- read access to NON-confidential tables -----------------------------------------------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
     where schemaname = 'public'
       and tablename not in ('profiles', 'doc_counters',
                             -- confidential: read through v_* views only
                             'products', 'raw_material_lots', 'jobs', 'dispatches', 'hardness_reports', 'main_dies', 'dies',
                             -- confidential party lists: own policy below
                             'customers', 'suppliers')
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (is_active_user())', t || '_read', t);
  end loop;
end $$;

-- party lists
grant select on customers, suppliers to authenticated;
create policy customers_read on customers for select to authenticated using (can_see_confidential());
create policy suppliers_read on suppliers for select to authenticated using (can_see_confidential());

-- views (owner-rights views; they mask and filter by themselves — see 13)
do $$
declare v text;
begin
  for v in select viewname from pg_views where schemaname = 'public' loop
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ---- profiles -----------------------------------------------------------------------------
-- everyone sees their own row; director / plant head manage roles
grant select, update on profiles to authenticated;
create policy profiles_read   on profiles for select to authenticated using (id = auth.uid() or can_manage_masters());
create policy profiles_update on profiles for update to authenticated using (can_manage_masters()) with check (can_manage_masters());

-- ---- master data writes: director / plant head --------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['customers', 'suppliers', 'machines', 'operators', 'inspectors', 'material_master', 'hardness_specs'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (can_manage_masters())', t || '_mgr_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (can_manage_masters()) with check (can_manage_masters())', t || '_mgr_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (can_manage_masters())', t || '_mgr_del', t);
  end loop;
end $$;
-- (products are written through save_product(), because of their confidential columns)
grant usage on all sequences in schema public to authenticated;

-- ---- functions: only the intended entry points are callable --------------------------------
grant execute on function
  -- used by RLS policies and by the views in 13 (Postgres checks function privileges against the CALLER, even inside a view)
  is_active_user(), can_see_confidential(), can_see_management(), can_manage_masters(), current_app_role(),
  mask_text(text), mask_num(numeric), stage_label(text),
  -- production
  add_inward(text, text, numeric, text, date, int, numeric, text, text, numeric, timestamptz),
  create_job(text, int, text, numeric, numeric, text, date, job_priority, numeric, text, text, timestamptz),
  start_stage(process_stage, text, int, text, text, jsonb, timestamptz),
  complete_stage(process_stage, text, int, int, text, text, text, jsonb, timestamptz),
  complete_qc(text, int, int, text, text, text, boolean, boolean, boolean, timestamptz),
  create_dispatch(text, text, date, dispatch_status, jsonb, int, int, numeric, text, text, text, timestamptz),
  mark_dispatched(text, text, timestamptz),
  save_hardness_report(jsonb, text, timestamptz),
  save_product(jsonb),
  -- dies
  save_main_die(jsonb, text),
  save_die(die_kind, jsonb, text),
  replace_die(die_kind, text, jsonb, die_status, text),
  record_maintenance(text, date, text, die_status),
  issue_die(text, date, text, text),
  return_die(text, date, int, text, die_status)
to authenticated;

-- destructive helper: SQL editor / service role only
revoke all on function reset_transactional_data() from public, anon, authenticated;
grant execute on function reset_transactional_data() to service_role;
