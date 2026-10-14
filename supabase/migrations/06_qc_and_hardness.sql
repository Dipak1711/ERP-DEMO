-- 06 · Final QC and the Hardness Inspection Report (client's paper format F QC 03).

create table qc_records (
  id                bigint generated always as identity primary key,
  job_no            text not null unique references jobs (job_no),  -- one QC lot per job
  input_qty         int not null check (input_qty > 0),
  accepted_qty      int not null default 0 check (accepted_qty >= 0),
  rejected_qty      int not null default 0 check (rejected_qty >= 0),
  status            qc_status not null default 'QC Pending',
  received_at       timestamptz not null default now(),
  inspected_at      timestamptz,
  inspector         text not null default '',
  rejection_reason  text not null default '',
  remarks           text not null default '',
  check_dimensional boolean not null default false,
  check_visual      boolean not null default false,
  check_hardness    boolean not null default false,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- ACCEPTED + REJECTED = INPUT once inspected
  constraint qc_balance check (status = 'QC Pending' or accepted_qty + rejected_qty = input_qty)
);
create trigger qc_updated before update on qc_records for each row execute function set_updated_at();
create index qc_status_idx on qc_records (status);

create table hardness_reports (
  id            text primary key,                         -- HIR-2026-0001
  job_no        text references jobs (job_no),            -- optional link to a production job
  date          date not null,
  component     text not null check (btrim(component) <> ''),
  material      text not null check (material in ('Aluminium', 'Brass', 'Copper')),
  grade         text not null default '',                 -- e.g. AA 6082-T6
  supplier      text not null default '',
  inward_qty    int not null default 0 check (inward_qty >= 0),
  inspected_qty int not null check (inspected_qty > 0),
  cycle_no      text not null default '',
  drawing_no    text not null default '',
  checked_by    text not null check (btrim(checked_by) <> ''),
  scale         hardness_scale not null default 'HRB',
  min_hardness  numeric(6, 1) not null check (min_hardness > 0),
  max_hardness  numeric(6, 1) not null check (max_hardness > 0),
  remarks       text not null default '',
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (min_hardness <= max_hardness),
  check (inward_qty = 0 or inspected_qty <= inward_qty)
);
create trigger hardness_updated before update on hardness_reports for each row execute function set_updated_at();
create index hardness_date_idx on hardness_reports (date desc);
create index hardness_job_idx  on hardness_reports (job_no);

-- one row per inspected piece; Sr. No. = sr_no; value NULL = not measured yet
create table hardness_readings (
  report_id text not null references hardness_reports (id) on delete cascade,
  sr_no     int  not null check (sr_no between 1 and 50),
  value     numeric(6, 1) check (value is null or value > 0),
  primary key (report_id, sr_no)
);
