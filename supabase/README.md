# supabase/

Database for ForgeFlow ERP. **Not connected to the app yet** — see [PLAN.md](PLAN.md) for the page-by-page analysis,
design decisions, table map and rollout steps.

```
supabase/
├── PLAN.md                 analysis + migration plan
├── migrations/             15 ordered files (timestamp prefix = apply order)
└── seed.sql                master data (products, materials, hardness ranges, customers, …)
```

## Apply (when a project exists)

```bash
npm i -g supabase            # or: npx supabase
supabase init                # only writes supabase/config.toml; existing folders are kept
supabase link --project-ref <ref>
supabase db push             # runs migrations/
psql "$DATABASE_URL" -f supabase/seed.sql      # or paste seed.sql into the SQL editor
```

Local test run (needs Docker): `supabase start && supabase db reset` applies migrations, then `seed.sql` if listed in
`config.toml` under `[db.seed] sql_paths = ["./seed.sql"]`.

First admin: sign up once, then in the SQL editor
`update profiles set role = 'admin' where id = '<auth user uuid>';`

## Smoke test (SQL editor, after seed)

```sql
select add_inward('Brass Round Bar', 'CW614N', 45, 'ABC Metals', current_date, 600, 168);            -- RM-2026-001
select create_job('P-BB45', 500, 'Brass Round Bar', 45);                                              -- JOB-2026-0001
select complete_stage('cutting', 'JOB-2026-0001', 14, 500);                                           -- 486 → Forging
select complete_stage('forging', 'JOB-2026-0001', 6);
select complete_stage('trimming', 'JOB-2026-0001', 0, null, null, null, null, '{"skipped":1}');
select complete_stage('heatTreatment', 'JOB-2026-0001', 0, null, null, null, null, '{"temperature":550}');
select complete_qc('JOB-2026-0001', 478, 2, 'Priya Kulkarni (QA)', 'Burr');                           -- FG-2026-0001
select create_dispatch('FG-2026-0001', 'GJ13AX3059', current_date, 'Dispatched', null, 478, 10, 50.2);
select * from v_job_summary;                                                                          -- status Dispatched, yield 95.6 %
select * from movements order by id;
```

The numbers mirror the worked example in the root README / `npm run test:engine`.

## Conventions

* snake_case columns; enum labels equal the frontend strings.
* Errors are `raise exception` with the same text as `ERPError`; PostgREST returns it in `message`.
* Clients can `select` tables/views but only change data through the RPCs (see PLAN.md §5).
* Counters restart every year; die codes are `max()+1`.
