-- 13 · Read models used by the pages. Derived values live here, never in columns, so they cannot drift.
-- security_invoker = true → the caller's RLS applies to the underlying tables.

-- Raw Inventory › Lots   (lotStatus, lotAvailableWeight in engine.ts)
create view v_lots with (security_invoker = true) as
select l.*,
       l.material || '|' || trim_scale(l.od)::text                                 as material_key,
       round(l.available_qty * (l.inward_weight / l.inward_qty), 3)               as available_weight,
       case when l.available_qty = 0                      then 'Consumed'
            when l.available_qty < l.inward_qty * 0.2      then 'Low Stock'
            else 'Available' end                                                    as status
  from raw_material_lots l;

-- Raw Inventory › Inward history (was the separate `rawInwards` list)
create view v_raw_inwards with (security_invoker = true) as
select l.id as lot_id, l.inward_date as date, l.material, l.material_type, l.od, l.supplier,
       l.inward_qty as qty, l.inward_weight as weight, l.invoice_no, l.created_at
  from raw_material_lots l;

-- Stock per material + OD (New Job form stock check, dashboard, low-stock list)
create view v_raw_stock with (security_invoker = true) as
select l.material, l.od,
       l.material || '|' || trim_scale(l.od)::text                              as material_key,
       count(*) filter (where l.available_qty > 0)                              as open_lots,
       sum(l.inward_qty)::int                                                   as inward_qty,
       sum(l.available_qty)::int                                                as available_qty,
       round(sum(l.available_qty * (l.inward_weight / l.inward_qty)), 3)        as available_weight
  from raw_material_lots l
 group by l.material, l.od;

-- Finished Goods page and dispatch form  (fgAvailable, fgStatus, fgWeight in engine.ts)
create view v_finished_goods with (security_invoker = true) as
select f.*,
       p.name  as product_name,
       j.customer,
       f.qty - f.reserved_qty - f.dispatched_qty                         as available_qty,
       round(f.qty * p.finished_weight, 3)                               as weight,
       case when f.dispatched_qty = f.qty                                 then 'Dispatched'
            when f.dispatched_qty > 0                                     then 'Partially Dispatched'
            when f.qty - f.reserved_qty - f.dispatched_qty = 0            then 'Reserved'
            else 'Available' end                                          as status
  from finished_goods f
  join products p on p.id = f.product_id
  join jobs j     on j.job_no = f.job_no;

-- Hardness register: readings as an ordered array + OK/Not OK verdict  (hardnessVerdict in engine.ts)
create view v_hardness_reports with (security_invoker = true) as
select h.*,
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
  from hardness_reports h;

-- Dashboard KPIs and sidebar badges: open orders and pieces waiting at each stage (QC included)
create view v_stage_wip with (security_invoker = true) as
select s.stage::text as stage, count(*)::int as jobs, coalesce(sum(s.input_qty), 0)::int as wip
  from stage_records s
 where s.status <> 'Completed'
 group by s.stage
union all
select 'qc', count(*)::int, coalesce(sum(q.input_qty), 0)::int
  from qc_records q
 where q.status = 'QC Pending';

-- One row per job: Job Traceability, trace drawer, dashboard  (jobSummary in engine.ts)
create view v_job_summary with (security_invoker = true) as
select j.job_no, j.product_id, p.code as product_code, p.name as product_name, j.customer, j.priority, j.due_date,
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
                      order by s.id desc limit 1) cs on true;

-- Die Master summary cards / registers
create view v_die_summary with (security_invoker = true) as
select m.code as main_code, m.name, m.part_code, m.customer, m.metal, m.status, m.created_on,
       count(d.*) filter (where d.kind = 'forging')::int  as forging_dies,
       count(d.*) filter (where d.kind = 'trimming')::int as trimming_dies,
       count(d.*) filter (where d.status = 'Available')::int          as available,
       count(d.*) filter (where d.status = 'Under Maintenance')::int  as under_maintenance,
       count(d.*) filter (where d.status in ('Damaged', 'Retired'))::int as damaged_or_retired
  from main_dies m
  left join dies d on d.main_code = m.code
 group by m.code;
