-- 14 · Row level security and privileges.
--
-- Model
--   • Signed-in, active users can READ everything.
--   • Master data (products, customers, suppliers, machines, operators, inspectors, material/hardness master)
--     can be written by role 'admin' only.
--   • Production, QC, FG, dispatch, hardness and die tables have NO client write access at all:
--     they change only through the SECURITY DEFINER functions in 10–12, which enforce the business rules.
--   • `anon` gets nothing.

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

-- ---- read access --------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename not in ('profiles', 'doc_counters') loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (is_active_user())', t || '_read', t);
  end loop;
end $$;

-- views (security_invoker, so the policies above apply)
do $$
declare v text;
begin
  for v in select viewname from pg_views where schemaname = 'public' loop
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ---- profiles -----------------------------------------------------------------------------
grant select, update on profiles to authenticated;
create policy profiles_read_own_or_admin on profiles for select to authenticated using (id = auth.uid() or is_admin());
create policy profiles_admin_update      on profiles for update to authenticated using (is_admin()) with check (is_admin());

-- ---- master data: admin writes ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['products', 'customers', 'suppliers', 'machines', 'operators', 'inspectors', 'material_master', 'hardness_specs'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (is_admin())', t || '_admin_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (is_admin()) with check (is_admin())', t || '_admin_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (is_admin())', t || '_admin_del', t);
  end loop;
end $$;
-- identity sequences used by the master tables
grant usage on all sequences in schema public to authenticated;

-- ---- functions: only the intended entry points are callable --------------------------------
-- (revoked above; grant back the public RPC surface + helpers used inside RLS policies / views)
grant execute on function
  is_active_user(), is_admin(), stage_label(text),
  add_inward(text, text, numeric, text, date, int, numeric, text, text, timestamptz),
  create_job(text, int, text, numeric, numeric, text, date, job_priority, numeric, text, text, timestamptz),
  start_stage(process_stage, text, int, text, text, jsonb, timestamptz),
  complete_stage(process_stage, text, int, int, text, text, text, jsonb, timestamptz),
  complete_qc(text, int, int, text, text, text, boolean, boolean, boolean, timestamptz),
  create_dispatch(text, text, date, dispatch_status, jsonb, int, int, numeric, text, text, text, timestamptz),
  mark_dispatched(text, text, timestamptz),
  save_hardness_report(jsonb, text, timestamptz),
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
