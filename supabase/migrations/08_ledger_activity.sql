-- 08 · Quantity movement ledger and the dashboard activity feed. Append-only; written by the RPCs.

create table movements (
  id        bigint generated always as identity primary key,
  ts        timestamptz not null default now(),
  job_no    text references jobs (job_no),   -- NULL for supplier → raw inventory (the demo used '—')
  from_loc  text not null,
  to_loc    text not null,
  qty       int not null default 0 check (qty >= 0),
  loss      int not null default 0 check (loss >= 0),
  note      text not null default ''
);
create index movements_ts_idx  on movements (ts desc, id desc);
create index movements_job_idx on movements (job_no);
create index movements_from_idx on movements (from_loc);

create table activity (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  job_no  text references jobs (job_no),
  kind    activity_kind not null,
  text    text not null
);
create index activity_ts_idx  on activity (ts desc, id desc);
create index activity_job_idx on activity (job_no);
