-- 04 · Raw inventory. One row per inward lot (the old `rawInwards` list is the view v_raw_inwards).
-- available_qty only changes inside start_stage('cutting') via FIFO.

create table raw_material_lots (
  id             text primary key,                         -- RM-2026-001
  material       text not null references material_master (material) on update cascade,
  material_type  text not null default '',                 -- grade text, e.g. CW614N
  od             numeric(8, 2) not null check (od > 0),
  supplier       text not null check (btrim(supplier) <> ''),
  inward_date    date not null,
  heat_no        text,
  invoice_no     text,
  inward_qty     int not null check (inward_qty > 0),      -- PCS
  inward_weight  numeric(12, 3) not null check (inward_weight > 0), -- KG
  available_qty  int not null,                             -- PCS
  unit           text not null default 'PCS' check (unit = 'PCS'),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint lot_available_in_range check (available_qty >= 0 and available_qty <= inward_qty)
);
create trigger lots_updated before update on raw_material_lots for each row execute function set_updated_at();

-- FIFO lookup: oldest lot first, only lots that still have stock
create index lots_fifo_idx on raw_material_lots (material, od, inward_date, id) where available_qty > 0;
create index lots_supplier_idx on raw_material_lots (supplier);
