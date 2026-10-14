-- 07 · Finished goods and dispatch.

create table finished_goods (
  id             text primary key,                                   -- FG-2026-0001
  job_no         text not null references jobs (job_no),
  product_id     text not null references products (id),
  qty            int not null check (qty > 0),                       -- QC accepted qty received into FG
  reserved_qty   int not null default 0 check (reserved_qty >= 0),   -- packed / ready for dispatch
  dispatched_qty int not null default 0 check (dispatched_qty >= 0),
  received_at    timestamptz not null default now(),
  location       text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint fg_balance check (reserved_qty + dispatched_qty <= qty)
);
create trigger fg_updated before update on finished_goods for each row execute function set_updated_at();
create index fg_job_idx on finished_goods (job_no);

create table dispatches (
  dispatch_no   text primary key,                        -- DSP-2026-0001
  fg_id         text not null references finished_goods (id),
  job_no        text not null references jobs (job_no),
  product_id    text not null references products (id),
  customer      text not null default '',               -- CONFIDENTIAL (party name)
  qty           int not null check (qty > 0),
  vehicle_no    text not null default '',
  driver        text not null default '',
  invoice_no    text not null default '',               -- CONFIDENTIAL
  sales_rate    numeric(12, 2) check (sales_rate is null or sales_rate >= 0),  -- CONFIDENTIAL, ₹/pc snapshot taken at dispatch
  date          date not null,
  weight        numeric(12, 3) not null check (weight >= 0),   -- KG total of all bags
  status        dispatch_status not null,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  dispatched_at timestamptz,
  constraint dispatched_needs_vehicle check (status <> 'Dispatched' or btrim(vehicle_no) <> '')
);
create index dispatch_status_idx on dispatches (status);
create index dispatch_job_idx    on dispatches (job_no);
create index dispatch_fg_idx     on dispatches (fg_id);
create index dispatch_date_idx   on dispatches (date desc);

create table dispatch_bags (
  dispatch_no text not null references dispatches (dispatch_no) on delete cascade,
  bag_no      int  not null check (bag_no > 0),
  qty         int  not null check (qty > 0),
  weight      numeric(12, 3) not null check (weight >= 0),
  primary key (dispatch_no, bag_no)
);
