-- 33 · Purchase Invoice and Payment (three-way match), PO PDF storage, PO e-mail send support.
-- Needs 27, 30, 31, 32. Safe to run twice.
--
-- WHERE THE TOLERANCES LIVE (change a number in one place):
--   po_receipt_tolerance_pct()     migration 32   how far above the ordered quantity a received lot may go (default 5 %)
--   invoice_rate_tolerance_pct()   this file      how far an invoice rate may differ from the PO rate without a variance note (default 2 %)
--
-- THE INVOICE QUANTITY BASIS (three-way match: PO ↔ receipt ↔ invoice). For every PO line, the total invoiced on all POSTED invoices may
-- not exceed:
--     * KG lines:      the ACCEPTED quantity if incoming QC has been recorded on ANY lot of that line, otherwise the RECEIVED quantity
--                      (purchase_order_items.accepted_qty / received_qty, which migration 32 rolls up from the lots);
--     * other units:   the ORDERED quantity (receipts are only tracked in KG, so there is nothing to match against).
--   See _invoice_basis_qty().

-- ============================================================ 0. page resources
insert into app_resources (key, label, section, sort, writable) values
  ('purchase_invoices', 'Purchase Invoices', 'Purchase & Procurement', 28, true),
  ('purchase_payments', 'Purchase Payments', 'Purchase & Procurement', 29, true),
  ('supplier_payables', 'Supplier Payables', 'Purchase & Procurement', 30, false)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;

-- ============================================================ 1. company details for the PO PDF (read only by the Edge Function)
create table if not exists company_settings (
  id       int primary key default 1 check (id = 1),     -- one row
  name     text not null,
  address  text,
  gstin    text,
  phone    text,
  email    text
);
-- Fill the blank values in the Supabase table editor (Table Editor → company_settings). Blank fields are left out of the PDF.
insert into company_settings (id, name, address, gstin, phone)
values (1, 'Everest Auto Forge Pvt. Ltd.', 'Plot No. 12, Industrial Area, Sector 5', null, null)
on conflict (id) do nothing;
alter table company_settings enable row level security;          -- no policy: only the service role (the Edge Function) can read or change it
revoke all on company_settings from anon, authenticated, public;

-- ============================================================ 2. invoices and payments: columns
create or replace function invoice_rate_tolerance_pct() returns numeric language sql immutable as $$ select 2::numeric $$;

-- the old status said Unpaid / Partially Paid / Paid; it becomes the document state, and the paid state moves to pay_status
alter table purchase_invoices
  add column if not exists pay_status text not null default 'Unpaid',
  add column if not exists tax_type text,
  add column if not exists variance_note text,
  add column if not exists created_by text,
  add column if not exists posted_by text,
  add column if not exists posted_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;
alter table purchase_invoices drop constraint if exists purchase_invoices_status_check;
update purchase_invoices set pay_status = status where status in ('Unpaid', 'Partially Paid', 'Paid');
update purchase_invoices set status = 'Posted' where status in ('Unpaid', 'Partially Paid', 'Paid');
alter table purchase_invoices alter column status set default 'Draft';
do $$ begin
  alter table purchase_invoices add constraint purchase_invoices_status_check check (status in ('Draft', 'Posted', 'Cancelled'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table purchase_invoices add constraint purchase_invoices_pay_status_check check (pay_status in ('Unpaid', 'Partially Paid', 'Paid'));
exception when duplicate_object then null; end $$;
-- a supplier's own invoice number can be entered once (a cancelled invoice frees it again)
create unique index if not exists purchase_invoices_supplier_no_key on purchase_invoices (supplier_id, lower(supplier_inv_no)) where status <> 'Cancelled';

create table if not exists purchase_invoice_items (
  id         bigserial primary key,
  invoice_id bigint not null references purchase_invoices(id) on delete cascade,
  line_no    int not null,
  po_item_id bigint not null references purchase_order_items(id),
  lot_id     text references raw_material_lots(id) on delete set null,
  item       text not null,
  qty        numeric not null check (qty > 0),
  rate       numeric not null check (rate >= 0),
  gst_pct    numeric not null default 18,
  amount     numeric generated always as (qty * rate) stored,
  unique (invoice_id, line_no)
);
create index if not exists purchase_invoice_items_po_item_idx on purchase_invoice_items (po_item_id);

-- quantity of a PO line already invoiced on POSTED invoices (kept in step by post_ / cancel_purchase_invoice)
alter table purchase_order_items add column if not exists invoiced_qty numeric not null default 0;

alter table purchase_payments
  add column if not exists created_by text,
  add column if not exists notes text;
do $$ begin
  alter table purchase_payments add constraint purchase_payments_mode_check check (mode is null or mode in ('Bank Transfer', 'Cheque', 'UPI', 'Cash'));
exception when duplicate_object then null; end $$;
create index if not exists purchase_payments_invoice_idx on purchase_payments (pinv_id);

-- ============================================================ 3. e-mail log: what the Edge Function needs to record
alter table po_email_log
  add column if not exists cc text,
  add column if not exists note text,
  add column if not exists pdf_path text,
  add column if not exists provider_message_id text;

-- ============================================================ 4. helpers
-- Quantity of a PO line that may be invoiced in total (see the basis explained at the top of this file).
create or replace function _invoice_basis_qty(p_po_item_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select case
           when upper(btrim(i.uom)) <> 'KG' then i.qty
           when exists (select 1 from raw_material_lots l where l.po_item_id = i.id and l.qc_status <> 'Pending') then i.accepted_qty
           else i.received_qty
         end
    from purchase_order_items i where i.id = p_po_item_id
$$;

-- "30 days", "Net 45 Days" → 30 / 45; anything without a number of days → null
create or replace function _payment_terms_days(p_terms text) returns int
language sql immutable as $$
  select nullif(substring(coalesce(p_terms, '') from '(\d+)\s*(?:days?|d\M)'), '')::int
$$;

-- re-checks every line of one invoice against the match rules; p_exclude_invoice keeps an invoice from counting against itself
create or replace function _check_invoice_lines(p_po_id bigint, p_lines jsonb, p_variance_note text, p_invoice_id bigint) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  it purchase_order_items;
  v_basis numeric;
  v_tol numeric := invoice_rate_tolerance_pct();
  v_needs_note boolean := false;
  v_po_no text := (select po_no from purchase_orders where id = p_po_id);
begin
  -- quantity: per PO line, over all lines of this invoice
  for r in
    select (x ->> 'po_item_id')::bigint as po_item_id, sum((x ->> 'qty')::numeric) as qty
      from jsonb_array_elements(p_lines) x group by 1
  loop
    select * into it from purchase_order_items where id = r.po_item_id;
    v_basis := _invoice_basis_qty(r.po_item_id);
    if it.invoiced_qty - coalesce((select sum(ii.qty) from purchase_invoice_items ii join purchase_invoices pi on pi.id = ii.invoice_id
                                    where ii.invoice_id = p_invoice_id and pi.status = 'Posted' and ii.po_item_id = r.po_item_id), 0) + r.qty > v_basis + 0.0005 then
      raise exception 'Line % of % can be invoiced up to % % (%) — % already invoiced, this invoice adds %.',
        it.line_no, v_po_no, trim_scale(v_basis), it.uom,
        case when upper(btrim(it.uom)) <> 'KG' then 'ordered quantity' when v_basis = it.received_qty and not exists (select 1 from raw_material_lots l where l.po_item_id = it.id and l.qc_status <> 'Pending') then 'received quantity' else 'accepted quantity' end,
        trim_scale(it.invoiced_qty), trim_scale(r.qty);
    end if;
  end loop;

  -- rate: a difference beyond the tolerance needs a variance note
  for r in select (x ->> 'po_item_id')::bigint as po_item_id, (x ->> 'rate')::numeric as rate from jsonb_array_elements(p_lines) x loop
    select * into it from purchase_order_items where id = r.po_item_id;
    if (it.rate = 0 and r.rate > 0) or (it.rate > 0 and abs(r.rate - it.rate) / it.rate * 100 > v_tol) then v_needs_note := true; end if;
  end loop;
  if v_needs_note and coalesce(btrim(p_variance_note), '') = '' then
    raise exception 'A rate differs from the PO rate by more than % %%. Enter a variance note explaining why.', trim_scale(v_tol);
  end if;
end $$;

-- ============================================================ 5. save / post / cancel invoice
create or replace function save_purchase_invoice(p_id bigint, p_header jsonb, p_items jsonb, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  inv     purchase_invoices;
  po      purchase_orders;
  v_id    bigint := p_id;
  v_year  int := extract(year from current_date)::int;
  v_date  date := coalesce(nullif(p_header ->> 'inv_date', '')::date, current_date);
  v_due   date;
  v_no    text := btrim(coalesce(p_header ->> 'supplier_inv_no', ''));
  v_note  text := nullif(btrim(coalesce(p_header ->> 'variance_note', '')), '');
  v_taxable numeric := 0;
  v_gst   numeric := 0;
  x       jsonb;
  pit     purchase_order_items;
  v_line  int := 0;
  v_gstp  numeric;
begin
  perform _require_user();
  perform _require_write('purchase_invoices');
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one line to the invoice.'; end if;
  if v_no = '' then raise exception 'The supplier''s invoice number is required.'; end if;

  if v_id is not null then
    select * into inv from purchase_invoices where id = v_id for update;
    if not found then raise exception 'That invoice does not exist.'; end if;
    if inv.status <> 'Draft' then raise exception 'Invoice % is % and can no longer be edited.', inv.pinv_no, inv.status; end if;
  end if;

  select * into po from purchase_orders where id = coalesce((p_header ->> 'po_id')::bigint, inv.po_id);
  if not found then raise exception 'Choose the purchase order this invoice is against.'; end if;
  if po.status not in ('Released', 'Sent to Supplier', 'Partially Received', 'Fully Received', 'Closed') then
    raise exception 'PO % is % — it can be invoiced only once it has been released.', po.po_no, po.status;
  end if;
  if exists (select 1 from purchase_invoices where supplier_id = po.supplier_id and lower(supplier_inv_no) = lower(v_no) and status <> 'Cancelled' and id is distinct from v_id) then
    raise exception 'This supplier''s invoice number % has already been entered.', v_no;
  end if;

  -- every line must be a line of this PO
  for x in select * from jsonb_array_elements(p_items) loop
    select * into pit from purchase_order_items where id = (x ->> 'po_item_id')::bigint and po_id = po.id;
    if not found then raise exception 'An invoice line is not a line of PO %.', po.po_no; end if;
    if not (coalesce((x ->> 'qty')::numeric, 0) > 0) then raise exception 'Line % of % needs a quantity above zero.', pit.line_no, po.po_no; end if;
    if coalesce((x ->> 'rate')::numeric, -1) < 0 then raise exception 'Line % of % needs a rate.', pit.line_no, po.po_no; end if;
  end loop;
  perform _check_invoice_lines(po.id, p_items, v_note, v_id);

  v_due := coalesce(nullif(p_header ->> 'due_date', '')::date,
                    case when _payment_terms_days(po.payment_terms) is not null then v_date + _payment_terms_days(po.payment_terms) end);

  if v_id is null then
    insert into purchase_invoices (pinv_no, supplier_inv_no, inv_date, supplier_id, po_id, taxable_amount, gst_amount, total_amount, due_date, status, tax_type, variance_note, created_by)
    values ('PINV-' || v_year || '-' || lpad(next_doc_no('PINV', v_year)::text, 4, '0'), v_no, v_date, po.supplier_id, po.id, 0, 0, 0, v_due, 'Draft', po.tax_type, v_note, p_user)
    returning id into v_id;
  else
    delete from purchase_invoice_items where invoice_id = v_id;
  end if;

  for x in select * from jsonb_array_elements(p_items) loop
    select * into pit from purchase_order_items where id = (x ->> 'po_item_id')::bigint;
    v_line := v_line + 1;
    v_gstp := coalesce((x ->> 'gst_pct')::numeric, pit.gst_pct);
    insert into purchase_invoice_items (invoice_id, line_no, po_item_id, lot_id, item, qty, rate, gst_pct)
    values (v_id, v_line, pit.id, nullif(x ->> 'lot_id', ''), pit.item, (x ->> 'qty')::numeric, (x ->> 'rate')::numeric, v_gstp);
    v_taxable := v_taxable + round((x ->> 'qty')::numeric * (x ->> 'rate')::numeric, 2);
    v_gst := v_gst + round((x ->> 'qty')::numeric * (x ->> 'rate')::numeric * v_gstp / 100, 2);
  end loop;

  update purchase_invoices set supplier_inv_no = v_no, inv_date = v_date, due_date = v_due, po_id = po.id, supplier_id = po.supplier_id,
         tax_type = po.tax_type, variance_note = v_note, taxable_amount = v_taxable, gst_amount = v_gst, total_amount = v_taxable + v_gst
   where id = v_id;
  return v_id;
end $$;

create or replace function post_purchase_invoice(p_id bigint, p_user text) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv purchase_invoices;
  v_lines jsonb;
begin
  perform _require_user();
  perform _require_write('purchase_invoices');
  select * into inv from purchase_invoices where id = p_id for update;
  if not found then raise exception 'That invoice does not exist.'; end if;
  if inv.status <> 'Draft' then raise exception 'Invoice % is already %.', inv.pinv_no, inv.status; end if;
  select jsonb_agg(jsonb_build_object('po_item_id', po_item_id, 'qty', qty, 'rate', rate)) into v_lines from purchase_invoice_items where invoice_id = p_id;
  if v_lines is null then raise exception 'Invoice % has no lines.', inv.pinv_no; end if;
  -- the receipts or other invoices may have changed since the draft was saved: check again
  perform _check_invoice_lines(inv.po_id, v_lines, inv.variance_note, p_id);
  update purchase_order_items i set invoiced_qty = i.invoiced_qty + x.q
    from (select po_item_id, sum(qty) q from purchase_invoice_items where invoice_id = p_id group by po_item_id) x where i.id = x.po_item_id;
  update purchase_invoices set status = 'Posted', pay_status = 'Unpaid', posted_by = p_user, posted_at = now() where id = p_id;
end $$;

-- A posted invoice is locked. To correct it: cancel it (only while nothing has been paid against it) and enter it again.
create or replace function cancel_purchase_invoice(p_id bigint, p_reason text, p_user text) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv purchase_invoices;
begin
  perform _require_user();
  perform _require_write('purchase_invoices');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to cancel an invoice.'; end if;
  select * into inv from purchase_invoices where id = p_id for update;
  if not found then raise exception 'That invoice does not exist.'; end if;
  if inv.status = 'Cancelled' then raise exception 'Invoice % is already cancelled.', inv.pinv_no; end if;
  if exists (select 1 from purchase_payments where pinv_id = p_id) then
    raise exception 'Invoice % has payments recorded against it and cannot be cancelled.', inv.pinv_no;
  end if;
  if inv.status = 'Posted' then
    update purchase_order_items i set invoiced_qty = greatest(i.invoiced_qty - x.q, 0)
      from (select po_item_id, sum(qty) q from purchase_invoice_items where invoice_id = p_id group by po_item_id) x where i.id = x.po_item_id;
  end if;
  update purchase_invoices set status = 'Cancelled', cancelled_by = p_user, cancelled_at = now(), cancel_reason = btrim(p_reason) where id = p_id;
end $$;

-- ============================================================ 6. payments
-- p_header = {pinv_id, pay_date, amount, mode, reference, notes}. p_id null = new payment; a number corrects that payment.
-- Payments are accepted only against POSTED invoices (a Draft or Cancelled invoice refuses them) and never above the outstanding balance.
create or replace function save_purchase_payment(p_id bigint, p_header jsonb, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  inv     purchase_invoices;
  pay     purchase_payments;
  v_id    bigint := p_id;
  v_year  int := extract(year from current_date)::int;
  v_amt   numeric := round(coalesce((p_header ->> 'amount')::numeric, 0), 2);
  v_mode  text := btrim(coalesce(p_header ->> 'mode', ''));
  v_ref   text := nullif(btrim(coalesce(p_header ->> 'reference', '')), '');
  v_date  date := coalesce(nullif(p_header ->> 'pay_date', '')::date, current_date);
  v_paid  numeric;
  v_out   numeric;
begin
  perform _require_user();
  perform _require_write('purchase_payments');
  if v_id is not null then
    select * into pay from purchase_payments where id = v_id for update;
    if not found then raise exception 'That payment does not exist.'; end if;
  end if;
  select * into inv from purchase_invoices where id = coalesce((p_header ->> 'pinv_id')::bigint, pay.pinv_id) for update;
  if not found then raise exception 'Choose the invoice this payment is for.'; end if;
  if pay.id is not null and pay.pinv_id <> inv.id then raise exception 'A payment cannot be moved to another invoice.'; end if;
  if inv.status <> 'Posted' then raise exception 'Invoice % is %. Payments can be recorded only against a posted invoice.', inv.pinv_no, inv.status; end if;
  if v_mode not in ('Bank Transfer', 'Cheque', 'UPI', 'Cash') then raise exception 'Choose how it was paid: Bank Transfer, Cheque, UPI or Cash.'; end if;
  if v_mode <> 'Cash' and v_ref is null then raise exception 'A reference (UTR / cheque / UPI transaction number) is required for %.', v_mode; end if;
  if not (v_amt > 0) then raise exception 'The payment amount must be above zero.'; end if;
  if v_date > current_date then raise exception 'The payment date cannot be in the future.'; end if;

  select coalesce(sum(amount), 0) into v_paid from purchase_payments where pinv_id = inv.id and id is distinct from v_id;
  v_out := inv.total_amount - v_paid;
  if v_amt > v_out + 0.004 then
    raise exception 'Invoice % has only ₹ % outstanding; the payment of ₹ % is more than that.', inv.pinv_no, trim_scale(round(v_out, 2)), trim_scale(v_amt);
  end if;

  if v_id is null then
    insert into purchase_payments (pay_no, pay_date, pinv_id, amount, mode, reference, notes, created_by)
    values ('PAY-' || v_year || '-' || lpad(next_doc_no('PAY', v_year)::text, 4, '0'), v_date, inv.id, v_amt, v_mode, v_ref, nullif(btrim(coalesce(p_header ->> 'notes', '')), ''), p_user)
    returning id into v_id;
  else
    update purchase_payments set pay_date = v_date, amount = v_amt, mode = v_mode, reference = v_ref, notes = nullif(btrim(coalesce(p_header ->> 'notes', '')), '') where id = v_id;
  end if;

  update purchase_invoices set pay_status = case when v_paid + v_amt >= total_amount - 0.004 then 'Paid' when v_paid + v_amt > 0 then 'Partially Paid' else 'Unpaid' end
   where id = inv.id;
  return v_id;
end $$;

-- ============================================================ 7. sending a PO (used by the send-po Edge Function)
create or replace function can_send_po(p_po_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select is_active_user()
     and (page_level('procurement_po') = 'write' or page_level('purchase_approvals') = 'write')
     and exists (select 1 from purchase_orders where id = p_po_id and status in ('Released', 'Sent to Supplier'))
$$;

-- Step 1 of a send: reserve it. Refuses a second send of the same PO revision within 30 seconds (double click). Service role only.
create or replace function queue_po_send(p_po_id bigint, p_email text, p_cc text, p_note text, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  po purchase_orders;
  v_id bigint;
begin
  select * into po from purchase_orders where id = p_po_id for update;
  if not found then raise exception 'That purchase order does not exist.'; end if;
  if po.status not in ('Released', 'Sent to Supplier') then raise exception 'PO % is % — only a released PO can be sent.', po.po_no, po.status; end if;
  if exists (select 1 from po_email_log where po_id = p_po_id and rev_no = po.rev_no and delivery_status in ('Queued', 'Sent') and sent_at > now() - interval '30 seconds') then
    raise exception 'PO % was just sent. Wait 30 seconds before sending it again.', po.po_no;
  end if;
  insert into po_email_log (po_id, rev_no, sent_to, cc, note, sent_by, delivery_status) values (p_po_id, po.rev_no, p_email, p_cc, p_note, p_user, 'Queued') returning id into v_id;
  return v_id;
end $$;

-- Step 2: record the result. Replaces the 5-argument version from migration 27 (dropped so the API never sees two). Service role only.
-- p_ok true → the log row becomes Sent and the PO becomes "Sent to Supplier"; p_ok false → the row becomes Failed with the error and the PO does not change.
drop function if exists mark_po_sent(bigint, text, text, boolean, text);
create or replace function mark_po_sent(p_id bigint, p_email text, p_user text, p_ok boolean, p_error text default null,
                                        p_log_id bigint default null, p_pdf_path text default null, p_message_id text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  po purchase_orders;
begin
  select * into po from purchase_orders where id = p_id for update;
  if not found then raise exception 'That purchase order does not exist.'; end if;
  if po.status not in ('Released', 'Sent to Supplier') then raise exception 'Release the PO before sending.'; end if;
  if p_log_id is not null and exists (select 1 from po_email_log where id = p_log_id and po_id = p_id) then
    update po_email_log set delivery_status = case when p_ok then 'Sent' else 'Failed' end, error = case when p_ok then null else left(p_error, 500) end,
           pdf_path = coalesce(p_pdf_path, pdf_path), provider_message_id = p_message_id, sent_at = now()
     where id = p_log_id;
  else
    insert into po_email_log (po_id, rev_no, sent_to, sent_by, delivery_status, error, pdf_path, provider_message_id)
    values (p_id, po.rev_no, p_email, p_user, case when p_ok then 'Sent' else 'Failed' end, case when p_ok then null else left(p_error, 500) end, p_pdf_path, p_message_id);
  end if;
  if p_ok then
    update purchase_orders set status = 'Sent to Supplier' where id = p_id and status = 'Released';
    insert into po_approvals (po_id, rev_no, action, actor, note) values (p_id, po.rev_no, 'Sent', p_user, p_email);
  end if;
end $$;

-- ============================================================ 8. views (follow the caller's access)
create or replace view v_purchase_invoice_register with (security_invoker = on) as
select i.id as invoice_id, i.pinv_no, i.supplier_inv_no, i.inv_date, i.due_date, i.supplier_id, s.name as supplier_name,
       i.po_id, po.po_no, i.status, i.pay_status, i.taxable_amount, i.gst_amount, i.total_amount,
       coalesce(p.paid, 0) as paid_amount,
       case when i.status = 'Posted' then i.total_amount - coalesce(p.paid, 0) else 0 end as balance,
       (i.status = 'Posted' and i.total_amount - coalesce(p.paid, 0) > 0.004 and i.due_date is not null and i.due_date < current_date) as is_overdue,
       case when i.status = 'Posted' and i.total_amount - coalesce(p.paid, 0) > 0.004 and i.due_date is not null and i.due_date < current_date
            then current_date - i.due_date else 0 end as days_overdue,
       i.variance_note, i.created_by, i.posted_by, i.posted_at
  from purchase_invoices i
  join suppliers s on s.id = i.supplier_id
  left join purchase_orders po on po.id = i.po_id
  left join lateral (select sum(amount) as paid from purchase_payments where pinv_id = i.id) p on true;

create or replace view v_purchase_payment_register with (security_invoker = on) as
select pay.id as payment_id, pay.pay_no, pay.pay_date, pay.amount, pay.mode, pay.reference, pay.notes, pay.created_by,
       i.id as invoice_id, i.pinv_no, i.supplier_inv_no, s.name as supplier_name, po.po_no
  from purchase_payments pay
  join purchase_invoices i on i.id = pay.pinv_id
  join suppliers s on s.id = i.supplier_id
  left join purchase_orders po on po.id = i.po_id;

-- Payables per supplier, aged by INVOICE date (0–30 / 31–60 / 61–90 / 90+ days old); overdue_amount = past the due date.
create or replace view v_supplier_payables with (security_invoker = on) as
select s.id as supplier_id, s.name as supplier_name, s.code as supplier_code,
       count(*) filter (where r.balance > 0.004)::int as open_invoices,
       sum(r.total_amount) as total_invoiced,
       sum(r.paid_amount) as total_paid,
       sum(r.balance) as outstanding,
       coalesce(sum(r.balance) filter (where r.is_overdue), 0) as overdue_amount,
       coalesce(sum(r.balance) filter (where r.balance > 0.004 and current_date - r.inv_date <= 30), 0) as bucket_0_30,
       coalesce(sum(r.balance) filter (where r.balance > 0.004 and current_date - r.inv_date between 31 and 60), 0) as bucket_31_60,
       coalesce(sum(r.balance) filter (where r.balance > 0.004 and current_date - r.inv_date between 61 and 90), 0) as bucket_61_90,
       coalesce(sum(r.balance) filter (where r.balance > 0.004 and current_date - r.inv_date > 90), 0) as bucket_90_plus
  from v_purchase_invoice_register r
  join suppliers s on s.id = r.supplier_id
 where r.status = 'Posted'
 group by s.id, s.name, s.code;

-- PO → receipt → invoice → payment. Same columns as before, now from POSTED invoices and their payments only; two columns added at the end.
create or replace view v_po_pending_balance with (security_invoker = on) as
select po.id as po_id, po.po_no, s.name as supplier, po.total_amount,
       coalesce((select sum(i.total_amount) from purchase_invoices i where i.po_id = po.id and i.status = 'Posted'), 0) as invoiced,
       coalesce((select sum(p.amount) from purchase_payments p join purchase_invoices i on i.id = p.pinv_id where i.po_id = po.id and i.status = 'Posted'), 0) as paid,
       greatest(po.total_amount - coalesce((select sum(i.total_amount) from purchase_invoices i where i.po_id = po.id and i.status = 'Posted'), 0), 0) as balance_to_invoice,
       coalesce((select sum(i.total_amount) from purchase_invoices i where i.po_id = po.id and i.status = 'Posted'), 0)
         - coalesce((select sum(p.amount) from purchase_payments p join purchase_invoices i on i.id = p.pinv_id where i.po_id = po.id and i.status = 'Posted'), 0) as payable
  from purchase_orders po
  join suppliers s on s.id = po.supplier_id
 where po.status not in ('Draft', 'Cancelled');

-- ============================================================ 9. row level security
do $$
declare t text;
begin
  foreach t in array array['purchase_invoices', 'purchase_invoice_items', 'purchase_payments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format($p$create policy %I on %I for select to authenticated using (
        is_active_user() and (page_level('purchase_invoices') <> 'hidden' or page_level('purchase_payments') <> 'hidden'
                              or page_level('supplier_payables') <> 'hidden' or page_level('procurement_po') <> 'hidden'
                              or page_level('purchase_approvals') <> 'hidden'))$p$, t || '_read', t);
    execute format('revoke all on %I from anon, public', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

-- ============================================================ 10. PO PDF storage (written only by the Edge Function with the service role)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('po-pdfs', 'po-pdfs', false, 5 * 1024 * 1024, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists po_pdfs_read on storage.objects;
create policy po_pdfs_read on storage.objects for select to authenticated
  using (bucket_id = 'po-pdfs' and public.is_active_user()
         and (public.page_level('procurement_po') <> 'hidden' or public.page_level('purchase_approvals') <> 'hidden'));

-- ============================================================ 11. grants
revoke all on v_purchase_invoice_register, v_purchase_payment_register, v_supplier_payables, v_po_pending_balance from anon, public;
grant select on v_purchase_invoice_register, v_purchase_payment_register, v_supplier_payables, v_po_pending_balance to authenticated;

revoke all on function save_purchase_invoice(bigint, jsonb, jsonb, text), post_purchase_invoice(bigint, text), cancel_purchase_invoice(bigint, text, text),
                       save_purchase_payment(bigint, jsonb, text), can_send_po(bigint) from public, anon;
grant execute on function save_purchase_invoice(bigint, jsonb, jsonb, text), post_purchase_invoice(bigint, text), cancel_purchase_invoice(bigint, text, text),
                          save_purchase_payment(bigint, jsonb, text), can_send_po(bigint) to authenticated;
revoke all on function _invoice_basis_qty(bigint), _payment_terms_days(text), _check_invoice_lines(bigint, jsonb, text, bigint) from public, anon, authenticated;

-- only the service role (the Edge Function) may reserve and record a send
revoke all on function queue_po_send(bigint, text, text, text, text), mark_po_sent(bigint, text, text, boolean, text, bigint, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function queue_po_send(bigint, text, text, text, text), mark_po_sent(bigint, text, text, boolean, text, bigint, text, text) to service_role;
  end if;
end $$;
