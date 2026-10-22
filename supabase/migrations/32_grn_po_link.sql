-- 32 · Goods receipt ↔ Purchase Order link, incoming QC, supplier performance and report views.
-- Needs 18, 19, 24, 25, 27, 30, 31. Safe to run twice.
--
-- What this adds
--   1. Raw-material inward (add_inward / update_inward) can optionally be booked AGAINST a PO line. Receiving without a PO works exactly as before.
--   2. set_lot_qc(): incoming QC (Accepted / Rejected / Partial). Rejected bars are moved out of usable stock (blocked_qty), so production's
--      first-in-first-out issue (which only reads available_qty) can never pick them up. Nothing else that reads available_qty had to change.
--   3. The receipt roll-up trigger now handles moving a lot between PO lines, deleting a lot, and steps the PO status back down when needed.
--   4. Read-only report views (security_invoker, so they follow the caller's access) and a corrected v_supplier_performance.
--   5. The 'purchase_reports' and 'supplier_performance' page resources (both appear in Settings → Access Control).

-- ============================================================ 0. page resource
insert into app_resources (key, label, section, sort, writable) values
  ('purchase_reports',    'Purchase Reports',    'Purchase & Procurement', 26, false),
  ('supplier_performance', 'Supplier Performance', 'Purchase & Procurement', 27, false)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;

-- ============================================================ 1. columns on the inward lot
alter table raw_material_lots
  add column if not exists blocked_qty int not null default 0,     -- bars rejected at incoming QC: not usable, not "issued"
  add column if not exists qc_by text,
  add column if not exists qc_at timestamptz;
do $$ begin
  alter table raw_material_lots add constraint lot_blocked_in_range check (blocked_qty >= 0 and available_qty + blocked_qty <= inward_qty);
exception when duplicate_object then null; end $$;
create index if not exists lots_po_item_idx on raw_material_lots (po_item_id) where po_item_id is not null;
create index if not exists lots_supplier_id_idx on raw_material_lots (supplier_id) where supplier_id is not null;

-- ============================================================ 2. one place for the over-receipt tolerance
-- A lot may bring a PO line up to this many percent ABOVE the ordered quantity (suppliers rarely ship the exact weight).
create or replace function po_receipt_tolerance_pct() returns numeric language sql immutable as $$ select 5::numeric $$;

-- Validates a receipt against a PO line and returns what the lot should inherit from it (supplier, rate per KG).
-- Returns no row when no PO is given, so a receipt without a PO is untouched.
create or replace function _po_receipt_check(p_po_id bigint, p_item_id bigint, p_weight numeric, p_lot_id text default null)
returns table (supplier_id bigint, supplier_name text, rate numeric)
language plpgsql security definer set search_path = public as $$
declare
  po   purchase_orders;
  it   purchase_order_items;
  v_recv numeric;
  v_cap  numeric;
begin
  if p_po_id is null and p_item_id is null then return; end if;
  if p_po_id is null or p_item_id is null then raise exception 'Choose both the purchase order and the line of the purchase order.'; end if;
  select * into po from purchase_orders where id = p_po_id;
  if not found then raise exception 'That purchase order does not exist.'; end if;
  if po.status not in ('Released', 'Sent to Supplier', 'Partially Received', 'Fully Received') then
    raise exception 'PO % is % — material can be received only against a released PO.', po.po_no, po.status;
  end if;
  select * into it from purchase_order_items where id = p_item_id;
  if not found or it.po_id <> p_po_id then raise exception 'That line does not belong to PO %.', po.po_no; end if;
  if upper(btrim(it.uom)) <> 'KG' then
    raise exception 'PO line % of % is ordered in %, but receipts are tracked in KG. Receive this one without a PO link.', it.line_no, po.po_no, it.uom;
  end if;
  v_recv := coalesce((select sum(inward_weight) from raw_material_lots where po_item_id = p_item_id and (p_lot_id is null or id <> p_lot_id)), 0);
  v_cap  := it.qty * (1 + po_receipt_tolerance_pct() / 100);
  if v_recv + p_weight > v_cap then
    raise exception 'Over-receipt on PO % line %: ordered % KG, already received % KG, this lot % KG — more than the allowed % %% above the order.',
      po.po_no, it.line_no, trim_scale(it.qty), trim_scale(v_recv), trim_scale(p_weight), trim_scale(po_receipt_tolerance_pct());
  end if;
  return query select po.supplier_id, (select name from suppliers where id = po.supplier_id), it.rate;
end $$;

-- ============================================================ 3. add_inward / update_inward with an optional PO
-- The old signatures are dropped first: CREATE OR REPLACE with extra parameters would leave two overloads and the API could not choose between them.
drop function if exists add_inward(text, text, numeric, text, date, int, numeric, text, text, numeric, timestamptz);
drop function if exists update_inward(text, text, text, numeric, text, date, int, numeric, text, text, numeric, timestamptz);

create or replace function add_inward(
  p_material      text,
  p_material_type text,
  p_od            numeric,
  p_supplier      text,
  p_inward_date   date,
  p_qty           int,
  p_weight        numeric,
  p_heat_no       text default null,
  p_invoice_no    text default null,
  p_purchase_rate numeric default null,      -- ₹ per KG — confidential, director / plant head / accounts only
  p_ts            timestamptz default now(),
  p_po_id         bigint default null,       -- optional: book this receipt against a PO line
  p_po_item_id    bigint default null,
  p_qc_status     text default null          -- optional: 'Accepted' when it is checked on arrival; otherwise 'Pending'
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ts   timestamptz := coalesce(p_ts, now());
  v_qty  int;
  v_n    int;
  v_id   text;
  v_wt   numeric(12, 3);
  v_sup  text := btrim(coalesce(p_supplier, ''));
  v_sid  bigint;
  v_rate numeric := p_purchase_rate;
  chk    record;
begin
  perform _require_user();
  perform _require_write('raw_inventory');
  if coalesce(btrim(p_material), '') = '' then raise exception 'Material is required.'; end if;
  if not (coalesce(p_od, 0) > 0) then raise exception 'OD / Size must be greater than zero.'; end if;
  v_qty := _assert_qty(p_qty, 'Quantity');
  if not (coalesce(p_weight, 0) > 0) then raise exception 'Weight must be greater than zero.'; end if;
  if p_inward_date is null then raise exception 'Inward date is required.'; end if;
  if p_purchase_rate is not null and not can_see_field('purchase_rates') then
    raise exception 'You are not allowed to enter purchase rates.' using errcode = '42501';
  end if;
  if p_purchase_rate < 0 then raise exception 'Purchase rate cannot be negative.'; end if;
  if not exists (select 1 from material_master where material = btrim(p_material)) then
    raise exception 'Unknown material %.', p_material;
  end if;
  if p_qc_status is not null and p_qc_status not in ('Pending', 'Accepted') then
    raise exception 'A new inward can only be Pending or Accepted; record a rejection from the lot afterwards.';
  end if;

  v_wt := round(p_weight, 3);
  select * into chk from _po_receipt_check(p_po_id, p_po_item_id, v_wt, null);
  if found then
    v_sid := chk.supplier_id;
    v_sup := chk.supplier_name;                             -- the lot's supplier is the PO's supplier
    if v_rate is null then v_rate := chk.rate; end if;      -- the PO rate is the purchase rate unless one was typed
  else
    if v_sup = '' then raise exception 'Supplier is required.'; end if;
    select id into v_sid from suppliers where lower(name) = lower(v_sup);
  end if;

  v_n  := next_doc_no('lot', _year(v_ts));
  v_id := format('RM-%s-%s', _year(v_ts), lpad(v_n::text, 3, '0'));

  insert into raw_material_lots (id, material, material_type, od, supplier, inward_date, heat_no, invoice_no,
                                 inward_qty, inward_weight, available_qty, purchase_rate,
                                 po_id, po_item_id, supplier_id, qc_status, accepted_weight, rejected_weight)
  values (v_id, btrim(p_material), coalesce(btrim(p_material_type), ''), p_od, v_sup, p_inward_date,
          nullif(btrim(p_heat_no), ''), nullif(btrim(p_invoice_no), ''), v_qty, v_wt, v_qty, round(v_rate, 2),
          p_po_id, p_po_item_id, v_sid, coalesce(p_qc_status, 'Pending'),
          case when p_qc_status = 'Accepted' then v_wt end, case when p_qc_status = 'Accepted' then 0 end);

  perform _move(v_ts, null, 'Supplier', 'Raw Inventory', v_qty, 0,
                format('%s OD %smm · lot %s', btrim(p_material), trim_scale(p_od), v_id));
  perform _log(v_ts, 'inward', format('%s PCS %s (OD %smm) received — lot %s%s',
                v_qty, btrim(p_material), trim_scale(p_od), v_id,
                case when p_po_id is not null then format(' against PO %s', (select po_no from purchase_orders where id = p_po_id)) else '' end));
  return v_id;
end $$;

create or replace function update_inward(
  p_lot_id        text,
  p_material      text,
  p_material_type text,
  p_od            numeric,
  p_supplier      text,
  p_inward_date   date,
  p_qty           int,
  p_weight        numeric,
  p_heat_no       text default null,
  p_invoice_no    text default null,
  p_purchase_rate numeric default null,
  p_ts            timestamptz default now(),
  p_po_id         bigint default null,
  p_po_item_id    bigint default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ts     timestamptz := coalesce(p_ts, now());
  lot      raw_material_lots;
  v_issued int;
  v_qty    int;
  v_wt     numeric(12, 3);
  v_sup    text;
  v_sid    bigint;
  v_rate   numeric;
  chk      record;
begin
  perform _require_user();
  perform _require_write('raw_inventory');
  select * into lot from raw_material_lots where id = p_lot_id for update;
  if not found then raise exception 'Lot % does not exist.', p_lot_id; end if;
  v_issued := lot.inward_qty - lot.available_qty - lot.blocked_qty;       -- already taken by production

  if coalesce(btrim(p_material), '') = '' then raise exception 'Material is required.'; end if;
  if can_see_field('party_names') and p_po_id is null and coalesce(btrim(p_supplier), '') = '' then raise exception 'Supplier is required.'; end if;
  if not (coalesce(p_od, 0) > 0) then raise exception 'OD / Size must be greater than zero.'; end if;
  v_qty := _assert_qty(p_qty, 'Quantity');
  if not (coalesce(p_weight, 0) > 0) then raise exception 'Weight must be greater than zero.'; end if;
  if p_inward_date is null then raise exception 'Inward date is required.'; end if;
  if p_purchase_rate < 0 then raise exception 'Purchase rate cannot be negative.'; end if;
  if not exists (select 1 from material_master where material = btrim(p_material)) then raise exception 'Unknown material %.', p_material; end if;
  if v_qty < v_issued + lot.blocked_qty then
    raise exception 'Quantity cannot be below % PCS — % PCS are issued to production and % PCS were rejected at QC.', v_issued + lot.blocked_qty, v_issued, lot.blocked_qty;
  end if;
  if (v_issued > 0 or lot.blocked_qty > 0) and (btrim(p_material) <> lot.material or p_od <> lot.od) then
    raise exception 'Material and size cannot be changed — part of lot % is already issued to production or rejected at QC.', p_lot_id;
  end if;
  v_wt := round(p_weight, 3);
  if lot.qc_status <> 'Pending' and v_wt <> lot.inward_weight then
    raise exception 'The weight cannot be changed after incoming QC has been recorded for lot %.', p_lot_id;
  end if;

  v_sup  := case when can_see_field('party_names') then btrim(coalesce(p_supplier, '')) else lot.supplier end;
  v_sid  := lot.supplier_id;
  v_rate := case when can_see_field('purchase_rates') then p_purchase_rate else lot.purchase_rate end;
  select * into chk from _po_receipt_check(p_po_id, p_po_item_id, v_wt, p_lot_id);
  if found then
    v_sid := chk.supplier_id;
    v_sup := chk.supplier_name;
    if v_rate is null then v_rate := chk.rate; end if;
  elsif can_see_field('party_names') then
    select id into v_sid from suppliers where lower(name) = lower(v_sup);
  end if;

  update raw_material_lots set
      material      = btrim(p_material),
      material_type = coalesce(btrim(p_material_type), ''),
      od            = p_od,
      supplier      = v_sup,
      supplier_id   = v_sid,
      inward_date   = p_inward_date,
      heat_no       = case when column_visible('raw.heat_no')   then nullif(btrim(p_heat_no), '')         else heat_no end,
      invoice_no    = case when can_see_field('invoices')       then nullif(btrim(p_invoice_no), '')      else invoice_no end,
      purchase_rate = round(v_rate, 2),
      inward_qty    = v_qty,
      inward_weight = v_wt,
      available_qty = v_qty - v_issued - lot.blocked_qty,
      po_id         = p_po_id,
      po_item_id    = p_po_item_id
    where id = p_lot_id;

  update movements
     set qty = v_qty, note = format('%s OD %smm · lot %s', btrim(p_material), trim_scale(p_od), p_lot_id)
   where from_loc = 'Supplier' and to_loc = 'Raw Inventory' and note like '%lot ' || p_lot_id;

  perform _log(v_ts, 'inward', format('Inward lot %s corrected — %s PCS %s (OD %smm)', p_lot_id, v_qty, btrim(p_material), trim_scale(p_od)));
  return p_lot_id;
end $$;

-- a lot that has stock blocked by QC counts that stock as "not available" but also "not issued": the delete test follows
create or replace function delete_inward(p_lot_id text, p_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare
  lot raw_material_lots;
begin
  perform _require_user();
  perform _require_write('raw_inventory');
  select * into lot from raw_material_lots where id = p_lot_id for update;
  if not found then raise exception 'Lot % does not exist.', p_lot_id; end if;
  if lot.available_qty + lot.blocked_qty <> lot.inward_qty or exists (select 1 from job_material_issues where lot_id = p_lot_id) then
    raise exception 'Lot % cannot be deleted — % PCS of it are already issued to production.', p_lot_id, lot.inward_qty - lot.available_qty - lot.blocked_qty;
  end if;
  delete from movements where from_loc = 'Supplier' and to_loc = 'Raw Inventory' and note like '%lot ' || p_lot_id;
  delete from raw_material_lots where id = p_lot_id;
  perform _log(coalesce(p_ts, now()), 'inward', format('Inward lot %s deleted — %s PCS %s (OD %smm)', p_lot_id, lot.inward_qty, lot.material, trim_scale(lot.od)));
end $$;

-- ============================================================ 4. incoming QC
-- Accepted → all of the lot is good. Rejected → all of it is blocked. Partial → the typed accepted / rejected weights; the rejected
-- share of the bars (by weight) moves from available_qty to blocked_qty. Bars production has already taken cannot be un-issued.
create or replace function set_lot_qc(
  p_lot_id          text,
  p_status          text,
  p_accepted_weight numeric default null,
  p_rejected_weight numeric default null,
  p_user            text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  lot       raw_material_lots;
  v_acc     numeric(12, 3);
  v_rej     numeric(12, 3);
  v_block   int;
  v_avail   int;
begin
  perform _require_user();
  if page_level('raw_inventory') <> 'write' and page_level('qc') <> 'write' then
    raise exception 'You do not have write access to record incoming QC.' using errcode = '42501';
  end if;
  select * into lot from raw_material_lots where id = p_lot_id for update;
  if not found then raise exception 'Lot % does not exist.', p_lot_id; end if;
  if p_status not in ('Pending', 'Accepted', 'Rejected', 'Partial') then raise exception 'Unknown QC status %.', p_status; end if;

  if p_status = 'Pending' then
    v_acc := null; v_rej := null;
  elsif p_status = 'Accepted' then
    v_acc := lot.inward_weight; v_rej := 0;
  elsif p_status = 'Rejected' then
    v_acc := 0; v_rej := lot.inward_weight;
  else
    v_acc := round(coalesce(p_accepted_weight, 0), 3);
    v_rej := round(coalesce(p_rejected_weight, 0), 3);
    if v_acc < 0 or v_rej < 0 then raise exception 'Weights cannot be negative.'; end if;
    if v_acc = 0 or v_rej = 0 then raise exception 'Partial acceptance needs both an accepted and a rejected weight. Use Accepted or Rejected otherwise.'; end if;
    if v_acc + v_rej > lot.inward_weight then
      raise exception 'Accepted + rejected (% KG) is more than the received weight of % KG.', v_acc + v_rej, lot.inward_weight;
    end if;
  end if;

  -- bars to block: the rejected share of the lot (all bars when the whole lot is rejected)
  v_block := case when coalesce(v_rej, 0) = 0 then 0
                  when v_rej >= lot.inward_weight then lot.inward_qty
                  else least(lot.inward_qty, round(lot.inward_qty * v_rej / lot.inward_weight)::int) end;
  v_avail := lot.available_qty + lot.blocked_qty - v_block;
  if v_avail < 0 then
    raise exception 'Production has already taken % PCS of lot %, so only % PCS can still be marked rejected.',
      lot.inward_qty - lot.available_qty - lot.blocked_qty, p_lot_id, lot.available_qty + lot.blocked_qty;
  end if;

  update raw_material_lots set
      qc_status = p_status, accepted_weight = v_acc, rejected_weight = v_rej,
      blocked_qty = v_block, available_qty = v_avail,
      qc_by = coalesce(nullif(btrim(p_user), ''), qc_by), qc_at = now()
    where id = p_lot_id;

  perform _log(now(), 'inward', format('Incoming QC on lot %s: %s%s', p_lot_id, p_status,
    case when p_status in ('Rejected', 'Partial') then format(' — %s KG rejected, %s PCS blocked', trim_scale(v_rej), v_block) else '' end));
end $$;

-- ============================================================ 5. roll-up trigger
-- Recomputes received / accepted / rejected on the PO line(s) a lot touches (the old line AND the new one when a lot is moved) and
-- steps the PO status up or down. SECURITY DEFINER because the PO tables are behind RLS.
create or replace function trg_inward_rollup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_item bigint;
  v_po   bigint;
begin
  for v_item in
    select distinct x from unnest(array[case when tg_op <> 'INSERT' then old.po_item_id end,
                                        case when tg_op <> 'DELETE' then new.po_item_id end]) as t(x) where x is not null
  loop
    update purchase_order_items i set
      received_qty = coalesce((select sum(inward_weight) from raw_material_lots where po_item_id = v_item), 0),
      accepted_qty = coalesce((select sum(accepted_weight) from raw_material_lots where po_item_id = v_item), 0),
      rejected_qty = coalesce((select sum(rejected_weight) from raw_material_lots where po_item_id = v_item), 0)
    where i.id = v_item
    returning i.po_id into v_po;

    update purchase_orders po set status = case
        when not exists (select 1 from purchase_order_items where po_id = v_po and received_qty < qty) then 'Fully Received'
        when (select sum(received_qty) from purchase_order_items where po_id = v_po) > 0 then 'Partially Received'
        when exists (select 1 from po_approvals where po_id = v_po and action = 'Sent') then 'Sent to Supplier'
        else 'Released' end
      where po.id = v_po and po.status in ('Released', 'Sent to Supplier', 'Partially Received', 'Fully Received');
  end loop;
  return coalesce(new, old);
end $$;
drop trigger if exists inward_rollup on raw_material_lots;
create trigger inward_rollup after insert or delete or update of po_id, po_item_id, inward_weight, accepted_weight, rejected_weight
  on raw_material_lots for each row execute function trg_inward_rollup();

alter function trg_po_items_locked() security definer set search_path = public;

-- ============================================================ 6. lots view: expose QC / PO columns (appended; existing columns unchanged)
create or replace view v_lots as
select l.id, l.material, l.material_type, l.od, l.inward_date, case when (select column_visible('raw.heat_no')) then l.heat_no end as heat_no, l.inward_qty, l.inward_weight, l.available_qty,
       l.unit, l.created_at,
       l.material || '|' || trim_scale(l.od)::text                          as material_key,
       round(l.available_qty * (l.inward_weight / l.inward_qty), 3)         as available_weight,
       case when l.available_qty = 0 and l.blocked_qty > 0 and l.blocked_qty >= l.inward_qty then 'Rejected'
            when l.available_qty = 0                 then 'Consumed'
            when l.available_qty < l.inward_qty * 0.2 then 'Low Stock'
            else 'Available' end                                              as status,
       mask_text(l.supplier, 'party_names')      as supplier,
       mask_text(l.invoice_no, 'invoices')       as invoice_no,
       mask_num(l.purchase_rate, 'purchase_rates')  as purchase_rate,
       mask_num(round(l.available_qty * (l.inward_weight / l.inward_qty) * l.purchase_rate, 2), 'purchase_rates') as stock_value,
       l.blocked_qty, l.qc_status, l.accepted_weight, l.rejected_weight, l.po_id, l.po_item_id,
       (select po.po_no from purchase_orders po where po.id = l.po_id) as po_no
  from raw_material_lots l
 where is_active_user();

-- ============================================================ 7. report views (all follow the caller's access)
-- Signed-in users cannot read raw_material_lots directly (inventory is read through the masking views), so the report views get the
-- receipt facts they need from this owner-rights view. It exposes no rates and masks the invoice number, and returns rows only to people who
-- may open a purchase page or the inventory.
create or replace view v_lot_facts as
select l.id as lot_id, l.inward_date, l.po_id, l.po_item_id, l.supplier_id, l.heat_no, mask_text(l.invoice_no, 'invoices') as invoice_no,
       l.material, l.material_type, l.od, l.inward_qty, l.inward_weight, l.qc_status, l.accepted_weight, l.rejected_weight
  from raw_material_lots l
 where is_active_user()
   and (page_level('procurement_po') <> 'hidden' or page_level('purchase_reports') <> 'hidden'
        or page_level('purchase_dashboard') <> 'hidden' or page_level('raw_inventory') <> 'hidden');

create or replace view v_po_receipts with (security_invoker = on) as
select l.po_id, l.po_item_id, l.lot_id, l.inward_date, l.heat_no, l.invoice_no,
       l.material, l.material_type, l.od, l.inward_qty, l.inward_weight, l.qc_status, l.accepted_weight, l.rejected_weight
  from v_lot_facts l
 where l.po_id is not null;

create or replace view v_po_item_register with (security_invoker = on) as
select i.id as item_id, po.id as po_id, po.po_no, po.rev_no, po.po_date, po.status, po.urgency,
       po.supplier_id, s.name as supplier_name, po.pr_id, po.sq_id,
       i.line_no, i.item, i.material, i.grade, i.size, i.uom, i.qty, i.rate, i.amount, i.gst_pct,
       i.received_qty, i.accepted_qty, i.rejected_qty, greatest(i.qty - i.received_qty, 0) as pending_qty,
       coalesce(i.delivery_date, po.delivery_date) as delivery_date,
       (select max(f.inward_date) from v_lot_facts f where f.po_item_id = i.id) as last_receipt_date,
       (coalesce(i.delivery_date, po.delivery_date) < current_date and i.received_qty < i.qty
          and po.status in ('Released', 'Sent to Supplier', 'Partially Received')) as is_overdue,
       case when coalesce(i.delivery_date, po.delivery_date) < current_date and i.received_qty < i.qty
                 and po.status in ('Released', 'Sent to Supplier', 'Partially Received')
            then current_date - coalesce(i.delivery_date, po.delivery_date) else 0 end as days_overdue
  from purchase_order_items i
  join purchase_orders po on po.id = i.po_id
  join suppliers s on s.id = po.supplier_id;

create or replace view v_po_delivery_schedule with (security_invoker = on) as
select r.*,
       case when r.received_qty >= r.qty then 'Delivered'
            when r.is_overdue then 'Overdue'
            when r.delivery_date is not null and r.delivery_date <= current_date + 3 then 'Due soon'
            else 'On track' end as schedule_status
  from v_po_item_register r
 where r.status in ('Released', 'Sent to Supplier', 'Partially Received', 'Fully Received', 'Closed');

create or replace view v_purchase_rate_history with (security_invoker = on) as
select i.item, i.material, i.grade, i.size, s.name as supplier_name, po.id as po_id, po.po_no, po.po_date, i.uom, i.rate, i.qty
  from purchase_order_items i
  join purchase_orders po on po.id = i.po_id
  join suppliers s on s.id = po.supplier_id
 where po.status not in ('Draft', 'Cancelled');

create or replace view v_pr_status with (security_invoker = on) as
select pr.id as pr_id, pr.pr_no, pr.pr_date, pr.department, pr.requested_by, pr.urgency, pr.status,
       i.line_no, i.item, i.material, i.grade, i.size, i.uom, i.qty, i.ordered_qty,
       greatest(i.qty - i.ordered_qty, 0) as remaining_qty, i.required_date
  from purchase_requisitions pr
  join purchase_requisition_items i on i.pr_id = pr.id;

create or replace view v_rfq_status with (security_invoker = on) as
select r.id as rfq_id, r.rfq_no, r.rfq_date, pr.pr_no, r.due_date, r.status,
       (select count(*) from rfq_suppliers x where x.rfq_id = r.id) as suppliers_invited,
       (select count(*) from rfq_suppliers x where x.rfq_id = r.id and x.sent_at is not null) as sent_count,
       (select count(*) from rfq_suppliers x where x.rfq_id = r.id and x.responded_at is not null) as responded_count,
       (select count(*) from supplier_quotations q where q.rfq_id = r.id) as quotation_count
  from rfqs r
  left join purchase_requisitions pr on pr.id = r.pr_id;

create or replace view v_sq_register with (security_invoker = on) as
select q.id as sq_id, q.sq_no, q.sq_date, s.name as supplier_name, r.rfq_no, pr.pr_no, q.valid_till, q.payment_terms, q.delivery_terms,
       q.lead_days, q.status,
       (select count(*) from supplier_quotation_items x where x.sq_id = q.id) as item_count,
       coalesce((select sum(x.qty * x.rate) from supplier_quotation_items x where x.sq_id = q.id), 0) as total_amount
  from supplier_quotations q
  join suppliers s on s.id = q.supplier_id
  left join rfqs r on r.id = q.rfq_id
  left join purchase_requisitions pr on pr.id = q.pr_id;

create or replace view v_comparison_report with (security_invoker = on) as
select pr.pr_no, c.item, c.grade, c.size, c.required_qty, c.supplier, c.sq_no, c.rate, c.lead_days, c.payment_terms, c.rate_rank
  from v_supplier_comparison c
  left join purchase_requisitions pr on pr.id = c.pr_id;

-- every amendment: the version it replaced (rev_no), why, who, when, and the total before and after
create or replace view v_po_amendments with (security_invoker = on) as
select po.po_no, rv.rev_no as replaced_rev, rv.rev_no + 1 as new_rev, rv.reason, rv.amended_by, rv.amended_at,
       (rv.snapshot ->> 'total_amount')::numeric as old_total,
       coalesce((nx.snapshot ->> 'total_amount')::numeric, po.total_amount) as new_total,
       s.name as supplier_name
  from po_revisions rv
  join purchase_orders po on po.id = rv.po_id
  join suppliers s on s.id = po.supplier_id
  left join po_revisions nx on nx.po_id = rv.po_id and nx.rev_no = rv.rev_no + 1;

-- ============================================================ 8. supplier performance (corrected)
--  on_time_delivery_pct  of the POs whose delivery date has come: a PO is ON TIME when every line is received and the LAST receipt is on or
--                        before the delivery date; LATE when the last receipt came after it, or it is past due and not fully received.
--                        POs not yet due and not fully received are left out. NULL = nothing to judge yet.
--  quality_acceptance_pct / rejection_pct  by weight over lots that have had incoming QC: accepted ÷ QC'd, rejected ÷ QC'd.
--  quantity_shortage     quantity ordered but not received, on lines of closed POs or POs past their delivery date (shortage_base_qty = what was ordered on those lines).
--  price_index           per PO line: its rate ÷ the lowest rate paid for the same item + grade in the last 12 months (1.00 = best); averaged per supplier.
--                        Only lines where at least two suppliers were bought from are compared; NULL when a supplier has nothing to compare against.
--  avg_response_hrs      average hours from an RFQ being sent to the supplier's quotation arriving.
--  po_count / total_purchase_value  over POs that have been released.
drop view if exists v_supplier_performance;
create view v_supplier_performance with (security_invoker = on) as
with live as (
  select po.* from purchase_orders po
   where po.status in ('Released', 'Sent to Supplier', 'Partially Received', 'Fully Received', 'Closed')
), po_judged as (
  select l.id as po_id, l.supplier_id,
         case
           when l.delivery_date is null then null
           when not exists (select 1 from purchase_order_items i where i.po_id = l.id and i.received_qty < i.qty)
                then case when coalesce((select max(f.inward_date) from v_lot_facts f where f.po_id = l.id), l.delivery_date) <= l.delivery_date then 'on_time' else 'late' end
           when l.delivery_date < current_date then 'late'
           else null end as verdict
    from live l
), delivery as (
  select supplier_id, count(*) filter (where verdict = 'on_time') as on_time_count, count(*) filter (where verdict = 'late') as late_count
    from po_judged group by supplier_id
), qc as (
  select supplier_id,
         sum(inward_weight) filter (where qc_status <> 'Pending') as qcd,
         sum(accepted_weight) as acc, sum(rejected_weight) as rej
    from v_lot_facts where supplier_id is not null group by supplier_id
), short as (
  select l.supplier_id, sum(greatest(i.qty - i.received_qty, 0)) as qty_short, sum(i.qty) as qty_base
    from live l join purchase_order_items i on i.po_id = l.id
   where l.status = 'Closed' or l.delivery_date < current_date
   group by l.supplier_id
), spend as (
  select supplier_id, count(*) as po_count, sum(total_amount) as total_value from live group by supplier_id
), prices as (
  select l.supplier_id,
         avg(i.rate / nullif((select min(i2.rate)
                                from purchase_order_items i2 join purchase_orders p2 on p2.id = i2.po_id
                               where lower(btrim(i2.item)) = lower(btrim(i.item)) and lower(coalesce(i2.grade, '')) = lower(coalesce(i.grade, ''))
                                 and upper(i2.uom) = upper(i.uom)
                                 and p2.status not in ('Draft', 'Cancelled') and p2.po_date >= current_date - 365), 0)) as idx
    from live l join purchase_order_items i on i.po_id = l.id
   where l.po_date >= current_date - 365
     -- only lines that have a rival: the same item + grade bought from at least two different suppliers
     and (select count(distinct p3.supplier_id)
            from purchase_order_items i3 join purchase_orders p3 on p3.id = i3.po_id
           where lower(btrim(i3.item)) = lower(btrim(i.item)) and lower(coalesce(i3.grade, '')) = lower(coalesce(i.grade, ''))
             and upper(i3.uom) = upper(i.uom)
             and p3.status not in ('Draft', 'Cancelled') and p3.po_date >= current_date - 365) >= 2
   group by l.supplier_id
), resp as (
  select supplier_id, avg(extract(epoch from (responded_at - sent_at)) / 3600) as hrs
    from rfq_suppliers where responded_at is not null and sent_at is not null group by supplier_id
)
select s.id as supplier_id, s.name, s.code as supplier_code,
       coalesce(sp.po_count, 0)::int as po_count,
       coalesce(sp.total_value, 0) as total_purchase_value,
       round(d.on_time_count::numeric / nullif(d.on_time_count + d.late_count, 0) * 100, 1) as on_time_delivery_pct,
       coalesce(d.on_time_count, 0)::int as on_time_count,
       coalesce(d.late_count, 0)::int as late_count,
       round(q.acc / nullif(q.qcd, 0) * 100, 1) as quality_acceptance_pct,
       round(q.rej / nullif(q.qcd, 0) * 100, 1) as rejection_pct,
       round(pr.idx, 2) as price_index,
       coalesce(sh.qty_short, 0) as quantity_shortage,
       coalesce(sh.qty_base, 0) as shortage_base_qty,      -- ordered qty of the same lines, so a shortage can be judged as a share
       round(rs.hrs::numeric, 1) as avg_response_hrs,
       s.default_payment_terms as payment_terms
  from suppliers s
  left join spend sp on sp.supplier_id = s.id
  left join delivery d on d.supplier_id = s.id
  left join qc q on q.supplier_id = s.id
  left join short sh on sh.supplier_id = s.id
  left join prices pr on pr.supplier_id = s.id
  left join resp rs on rs.supplier_id = s.id
 where s.active;

-- ============================================================ 9. access
revoke all on v_lot_facts, v_po_receipts, v_po_item_register, v_po_delivery_schedule, v_purchase_rate_history, v_pr_status, v_rfq_status,
              v_sq_register, v_comparison_report, v_po_amendments, v_supplier_performance from anon, public;
grant select on v_lot_facts, v_po_receipts, v_po_item_register, v_po_delivery_schedule, v_purchase_rate_history, v_pr_status, v_rfq_status,
                v_sq_register, v_comparison_report, v_po_amendments, v_supplier_performance to authenticated;

revoke all on function add_inward(text, text, numeric, text, date, int, numeric, text, text, numeric, timestamptz, bigint, bigint, text) from public, anon;
revoke all on function update_inward(text, text, text, numeric, text, date, int, numeric, text, text, numeric, timestamptz, bigint, bigint) from public, anon;
revoke all on function set_lot_qc(text, text, numeric, numeric, text) from public, anon;
revoke all on function delete_inward(text, timestamptz) from public, anon;
revoke all on function _po_receipt_check(bigint, bigint, numeric, text) from public, anon, authenticated;
grant execute on function add_inward(text, text, numeric, text, date, int, numeric, text, text, numeric, timestamptz, bigint, bigint, text) to authenticated;
grant execute on function update_inward(text, text, text, numeric, text, date, int, numeric, text, text, numeric, timestamptz, bigint, bigint) to authenticated;
grant execute on function set_lot_qc(text, text, numeric, numeric, text) to authenticated;
grant execute on function delete_inward(text, timestamptz) to authenticated;
