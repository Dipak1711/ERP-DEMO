-- 13 · Read models used by the pages. Derived values live here, never in columns, so they cannot drift.
--
-- ACCESS MODEL: clients have NO direct SELECT on any table that holds confidential data (see 14).
-- They read these views instead. Views run with the owner's rights (so RLS on the base tables does not get in the way)
-- and do two things themselves:
--     1. return nothing unless the caller is an active user         → where is_active_user()
--     2. wrap every confidential column in mask_text() / mask_num()  → '••••••' / NULL unless director,
--                                                                      plant_head or accounts
-- Confidential = party names (customer, supplier, die maker), invoice numbers, purchase / sales rates, die cost, values.
-- Never expose a confidential column here without a mask — it would bypass the whole model.

-- who am I (the frontend reads this once to decide what to show)
create view v_me as
select auth.uid()               as user_id,
       current_app_role()       as role,
       can_see_confidential()   as can_see_confidential,
       can_see_management()     as can_see_management
 where is_active_user();

-- Product Master
create view v_products as
select p.id, p.code, p.name, p.material, p.od, p.cutting_length, p.finished_weight,
       p.ht_temperature, p.ht_soak_minutes, p.ht_process, p.ht_quench, p.die_no, p.active,
       mask_text(p.default_customer) as default_customer,     -- confidential
       mask_num(p.sales_rate)        as sales_rate            -- confidential
  from products p
 where is_active_user();

-- Raw Inventory › Lots   (lotStatus, lotAvailableWeight in engine.ts)
create view v_lots as
select l.id, l.material, l.material_type, l.od, l.inward_date, l.heat_no, l.inward_qty, l.inward_weight, l.available_qty,
       l.unit, l.created_at,
       l.material || '|' || trim_scale(l.od)::text                          as material_key,
       round(l.available_qty * (l.inward_weight / l.inward_qty), 3)         as available_weight,
       case when l.available_qty = 0                 then 'Consumed'
            when l.available_qty < l.inward_qty * 0.2 then 'Low Stock'
            else 'Available' end                                              as status,
       mask_text(l.supplier)      as supplier,                -- confidential
       mask_text(l.invoice_no)    as invoice_no,              -- confidential
       mask_num(l.purchase_rate)  as purchase_rate,           -- confidential, ₹/KG
       mask_num(round(l.available_qty * (l.inward_weight / l.inward_qty) * l.purchase_rate, 2)) as stock_value  -- confidential
  from raw_material_lots l
 where is_active_user();

-- Raw Inventory › Inward history (was the separate `rawInwards` list)
create view v_raw_inwards as
select l.id as lot_id, l.inward_date as date, l.material, l.material_type, l.od,
       l.inward_qty as qty, l.inward_weight as weight, l.created_at,
       mask_text(l.supplier)     as supplier,
       mask_text(l.invoice_no)   as invoice_no,
       mask_num(l.purchase_rate) as purchase_rate
  from raw_material_lots l
 where is_active_user();

-- Stock per material + OD (New Job form stock check, dashboard, low-stock list) — quantities only
create view v_raw_stock as
select l.material, l.od,
       l.material || '|' || trim_scale(l.od)::text                              as material_key,
       count(*) filter (where l.available_qty > 0)                              as open_lots,
       sum(l.inward_qty)::int                                                   as inward_qty,
       sum(l.available_qty)::int                                                as available_qty,
       round(sum(l.available_qty * (l.inward_weight / l.inward_qty)), 3)        as available_weight
  from raw_material_lots l
 where is_active_user()
 group by l.material, l.od;

-- Jobs (route card header)
create view v_jobs as
select j.job_no, j.product_id, j.planned_qty, j.material, j.od, j.due_date, j.priority, j.current_stage,
       j.piece_weight_g, j.die_no, j.machine_no, j.created_at,
       mask_text(j.customer) as customer                   -- confidential
  from jobs j
 where is_active_user();

-- Finished Goods page and dispatch form  (fgAvailable, fgStatus, fgWeight in engine.ts)
create view v_finished_goods as
select f.id, f.job_no, f.product_id, f.qty, f.reserved_qty, f.dispatched_qty, f.received_at, f.location,
       p.name  as product_name,
       mask_text(j.customer)                                              as customer,    -- confidential
       f.qty - f.reserved_qty - f.dispatched_qty                         as available_qty,
       round(f.qty * p.finished_weight, 3)                               as weight,
       case when f.dispatched_qty = f.qty                                 then 'Dispatched'
            when f.dispatched_qty > 0                                     then 'Partially Dispatched'
            when f.qty - f.reserved_qty - f.dispatched_qty = 0            then 'Reserved'
            else 'Available' end                                          as status,
       mask_num(round((f.qty - f.reserved_qty - f.dispatched_qty) * p.sales_rate, 2)) as available_value  -- confidential
  from finished_goods f
  join products p on p.id = f.product_id
  join jobs j     on j.job_no = f.job_no
 where is_active_user();

-- Dispatch register
create view v_dispatches as
select d.dispatch_no, d.fg_id, d.job_no, d.product_id, d.qty, d.vehicle_no, d.driver, d.date, d.weight, d.status,
       d.created_at, d.dispatched_at,
       mask_text(d.customer)                 as customer,        -- confidential
       mask_text(d.invoice_no)               as invoice_no,      -- confidential
       mask_num(d.sales_rate)                as sales_rate,      -- confidential, ₹/pc
       mask_num(round(d.qty * d.sales_rate, 2)) as amount        -- confidential, qty × rate
  from dispatches d
 where is_active_user();

-- Hardness register: readings as an ordered array + OK/Not OK verdict  (hardnessVerdict in engine.ts)
create view v_hardness_reports as
select h.id, h.job_no, h.date, h.component, h.material, h.grade, h.inward_qty, h.inspected_qty, h.cycle_no, h.drawing_no,
       h.checked_by, h.scale, h.min_hardness, h.max_hardness, h.remarks, h.created_at, h.updated_at,
       mask_text(h.supplier) as supplier,                       -- confidential
       coalesce((select jsonb_agg(r.value order by r.sr_no) from hardness_readings r where r.report_id = h.id), '[]'::jsonb) as readings,
       case
         when exists (select 1 from hardness_readings r
                       where r.report_id = h.id and r.value is not null and (r.value < h.min_hardness or r.value > h.max_hardness))
              then 'Fail'
         when not exists (select 1 from hardness_readings r where r.report_id = h.id)
              or exists (select 1 from hardness_readings r where r.report_id = h.id and r.value is null)
              then 'Incomplete'
         else 'Pass'
       end as verdict
  from hardness_reports h
 where is_active_user();

-- Dashboard KPIs and sidebar badges: open orders and pieces waiting at each stage (QC included)
create view v_stage_wip as
select s.stage::text as stage, count(*)::int as jobs, coalesce(sum(s.input_qty), 0)::int as wip
  from stage_records s
 where s.status <> 'Completed' and is_active_user()
 group by s.stage
union all
select 'qc', count(*)::int, coalesce(sum(q.input_qty), 0)::int
  from qc_records q
 where q.status = 'QC Pending' and is_active_user();

-- One row per job: Job Traceability, trace drawer, dashboard  (jobSummary in engine.ts)
create view v_job_summary as
select j.job_no, j.product_id, p.code as product_code, p.name as product_name,
       mask_text(j.customer) as customer,                     -- confidential
       j.priority, j.due_date,
       j.current_stage, j.planned_qty, j.created_at,
       coalesce(iss.qty, 0)::int                                         as issued_qty,
       coalesce(iss.weight, 0)                                           as issued_weight,
       coalesce(pl.loss, 0)::int                                         as process_loss,
       coalesce(case when q.status <> 'QC Pending' then q.rejected_qty end, 0) as qc_rejected,
       coalesce(pl.loss, 0)::int + coalesce(case when q.status <> 'QC Pending' then q.rejected_qty end, 0) as total_loss,
       coalesce(fg.dispatched, 0)::int                                   as dispatched_qty,
       coalesce(fg.available, 0)::int                                    as fg_available_qty,
       case j.current_stage
         when 'cutting' then cs.input_qty when 'forging' then cs.input_qty
         when 'trimming' then cs.input_qty when 'heatTreatment' then cs.input_qty
         when 'qc' then q.input_qty
         when 'finishedGoods' then coalesce(fg.remaining, 0)
         when 'dispatched' then coalesce(fg.dispatched, 0)
         else 0 end                                                      as current_qty,
       case j.current_stage
         when 'cutting' then case cs.status when 'In Progress' then 'In Progress' else 'Pending' end
         when 'forging' then case cs.status when 'In Progress' then 'In Progress' else 'Pending' end
         when 'trimming' then case cs.status when 'In Progress' then 'In Progress' else 'Pending' end
         when 'heatTreatment' then case cs.status when 'In Progress' then 'In Progress' else 'Pending' end
         when 'qc' then 'QC Pending'
         when 'finishedGoods' then 'Ready for Dispatch'
         when 'dispatched' then 'Dispatched'
         else 'Rejected' end                                             as status,
       case j.current_stage
         when 'cutting' then 1 when 'forging' then 2 when 'trimming' then 3 when 'heatTreatment' then 4
         when 'qc' then 5 when 'finishedGoods' then 6 when 'dispatched' then 7 else -1 end as flow_index,
       case when q.id is not null and q.status <> 'QC Pending' and coalesce(iss.qty, 0) > 0
            then round(coalesce(fg.total, 0)::numeric / iss.qty * 100, 1) end             as yield_pct
  from jobs j
  join products p on p.id = j.product_id
  left join qc_records q on q.job_no = j.job_no
  left join lateral (select sum(i.qty) as qty, sum(i.weight) as weight
                       from job_material_issues i where i.job_no = j.job_no) iss on true
  left join lateral (select sum(s.loss_qty) as loss
                       from stage_records s where s.job_no = j.job_no and s.status = 'Completed') pl on true
  left join lateral (select sum(f.qty) as total, sum(f.dispatched_qty) as dispatched,
                            sum(f.qty - f.reserved_qty - f.dispatched_qty) as available,
                            sum(f.qty - f.dispatched_qty) as remaining
                       from finished_goods f where f.job_no = j.job_no) fg on true
  left join lateral (select s.input_qty, s.status
                       from stage_records s
                      where s.job_no = j.job_no and s.stage::text = j.current_stage::text
                      order by s.id desc limit 1) cs on true
 where is_active_user();

-- Die Master
create view v_main_dies as
select m.code, m.name, m.part_code, m.description, m.metal, m.created_on, m.status, m.remarks, m.is_demo, m.created_at, m.updated_at,
       mask_text(m.customer) as customer                     -- confidential
  from main_dies m
 where is_active_user();

create view v_dies as
select d.code, d.kind, d.main_code, d.material,
       d.top_l, d.top_w, d.top_h, d.bottom_l, d.bottom_w, d.bottom_h, d.top_weight, d.bottom_weight,
       d.making_date, d.drawing_no, d.revision, d.top_img_path, d.bottom_img_path, d.status, d.remarks, d.location,
       d.pieces, d.last_maint_date, d.maint_remarks, d.replaces_code, d.replaced_by_code, d.is_demo, d.created_at, d.updated_at,
       mask_text(d.maker) as maker,                          -- confidential (vendor)
       mask_num(d.cost)   as cost                            -- confidential
  from dies d
 where is_active_user();

-- Die Master summary cards / registers
create view v_die_summary as
select m.code as main_code, m.name, m.part_code, mask_text(m.customer) as customer, m.metal, m.status, m.created_on,
       count(d.*) filter (where d.kind = 'forging')::int  as forging_dies,
       count(d.*) filter (where d.kind = 'trimming')::int as trimming_dies,
       count(d.*) filter (where d.status = 'Available')::int          as available,
       count(d.*) filter (where d.status = 'Under Maintenance')::int  as under_maintenance,
       count(d.*) filter (where d.status in ('Damaged', 'Retired'))::int as damaged_or_retired
  from main_dies m
  left join dies d on d.main_code = m.code
 where is_active_user()
 group by m.code;

-- ------------------------------------------------------------------ financial reports ---
-- Sales by party: director, plant head, accounts only (empty for everyone else)
create view v_sales_by_customer as
select d.customer, count(*)::int as dispatches, sum(d.qty)::int as qty,
       sum(d.qty * d.sales_rate) as amount
  from dispatches d
 where d.status = 'Dispatched' and can_see_confidential()
 group by d.customer;

-- Management dashboard numbers: director and plant head only (empty for everyone else)
create view v_management_summary as
select (select round(coalesce(sum(l.available_qty * (l.inward_weight / l.inward_qty) * l.purchase_rate), 0), 2) from raw_material_lots l) as raw_stock_value,
       (select round(coalesce(sum((f.qty - f.reserved_qty - f.dispatched_qty) * p.sales_rate), 0), 2)
          from finished_goods f join products p on p.id = f.product_id)                                                                  as finished_goods_value,
       (select round(coalesce(sum(d.qty * d.sales_rate), 0), 2) from dispatches d where d.status = 'Dispatched')                        as dispatched_value
 where can_see_management();
