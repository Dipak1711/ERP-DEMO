-- 05 · Jobs (route cards), raw-material issues and the four process stages.

create table jobs (
  job_no           text primary key,                       -- JOB-2026-0001, same number through every stage
  product_id       text not null references products (id),
  customer         text not null default '',
  planned_qty      int not null check (planned_qty > 0),
  material         text not null references material_master (material) on update cascade, -- what Cutting will consume
  od               numeric(8, 2) not null check (od > 0),
  due_date         date,
  priority         job_priority not null default 'Normal',
  current_stage    job_stage not null default 'cutting',
  piece_weight_g   numeric(10, 2) check (piece_weight_g is null or piece_weight_g > 0), -- cut weight / piece
  die_no           text,
  machine_no       text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger jobs_updated before update on jobs for each row execute function set_updated_at();
create index jobs_stage_idx    on jobs (current_stage);
create index jobs_product_idx  on jobs (product_id);
create index jobs_created_idx  on jobs (created_at desc);

-- raw lots consumed by a job (filled when Cutting starts; one row per lot taken)
create table job_material_issues (
  id         bigint generated always as identity primary key,
  job_no     text not null references jobs (job_no),
  lot_id     text not null references raw_material_lots (id),
  qty        int not null check (qty > 0),
  weight     numeric(12, 3) not null check (weight >= 0),
  issued_at  timestamptz not null default now()
);
create index issues_job_idx on job_material_issues (job_no);
create index issues_lot_idx on job_material_issues (lot_id);

-- Cutting / Forging / Trimming / Heat Treatment share one shape.
-- params: cuttingLength | dieNo | trimDie, skipped | temperature, soakMinutes, process, quench …
create table stage_records (
  id            bigint generated always as identity primary key,
  job_no        text not null references jobs (job_no),
  stage         process_stage not null,
  input_qty     int not null check (input_qty >= 0),
  loss_qty      int not null default 0 check (loss_qty >= 0),
  output_qty    int not null default 0 check (output_qty >= 0),
  status        stage_status not null default 'Pending',
  received_at   timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  machine       text not null default '',
  operator      text not null default '',
  remarks       text not null default '',
  params        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (job_no, stage),
  constraint loss_not_above_input check (loss_qty <= input_qty),
  -- OUTPUT = INPUT − LOSS, once the stage is completed
  constraint output_equals_input_minus_loss check (status <> 'Completed' or output_qty = input_qty - loss_qty)
);
create trigger stage_records_updated before update on stage_records for each row execute function set_updated_at();
create index stage_open_idx on stage_records (stage, status) where status <> 'Completed';
