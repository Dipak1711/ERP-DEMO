-- ============================================================
-- 21 · Sales & Orders records (leads, inquiries, quotations, purchase orders, final orders, tasks)
-- ============================================================
-- ONE table holds all six kinds (they share most columns), ONE masking view reads it, ONE function saves it.
--   party / contact / phone / email  → hidden unless the role may see "party_names"
--   rate / amount                    → hidden unless the role may see "sales_rates"
-- The table itself is closed to clients; they read v_sales_records and write through save_sales_record(), which also
-- checks the Write level of the right page (leads, inquiries, sales_quotation, purchase_orders, final_orders, task_assignment).
-- Needs 18 and 20. Safe to run twice.

-- the six pages are editable now (20 registered them as view-only)
update app_resources set writable = true
 where key in ('sales_quotation', 'leads', 'inquiries', 'purchase_orders', 'final_orders', 'task_assignment');
update role_page_access set level = _default_level(role, resource)
 where resource in ('sales_quotation', 'leads', 'inquiries', 'purchase_orders', 'final_orders', 'task_assignment')
   and level = 'read' and role <> 'viewer';

create table if not exists sales_records (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('lead', 'inquiry', 'quotation', 'purchase_order', 'final_order', 'task')),
  doc_no     text not null,
  doc_date   date not null default current_date,
  party      text not null default '',          -- company / customer name            (confidential)
  contact    text not null default '',          -- contact person                      (confidential)
  phone      text not null default '',          --                                     (confidential)
  email      text not null default '',          --                                     (confidential)
  source     text not null default '',          -- lead source
  title      text not null default '',          -- task title
  product    text not null default '',
  qty        numeric check (qty is null or qty >= 0),
  rate       numeric check (rate is null or rate >= 0),   -- ₹ per piece              (confidential)
  ref_no     text not null default '',          -- the document this one follows (lead / inquiry / quotation / PO no.)
  ext_ref    text not null default '',          -- the customer's own PO number
  due_date   date,                              -- valid until / required by / delivery / task due date
  priority   text not null default '',
  status     text not null,
  assignee   text not null default '',
  remarks    text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, doc_no)
);
create index if not exists sales_records_kind_idx on sales_records (kind, created_at desc);

alter table sales_records enable row level security;
revoke all on sales_records from anon, authenticated;       -- clients use v_sales_records / save_sales_record only

create or replace view v_sales_records as
select r.id, r.kind, r.doc_no, r.doc_date, r.source, r.title, r.product, r.qty, r.ref_no, r.ext_ref, r.due_date,
       r.priority, r.status, r.assignee, r.remarks, r.created_at, r.updated_at,
       mask_text(r.party,   'party_names') as party,       -- confidential
       mask_text(r.contact, 'party_names') as contact,     -- confidential
       mask_text(r.phone,   'party_names') as phone,       -- confidential
       mask_text(r.email,   'party_names') as email,       -- confidential
       mask_num(r.rate,     'sales_rates') as rate,        -- confidential
       mask_num(round(r.qty * r.rate, 2), 'sales_rates') as amount   -- confidential
  from sales_records r
 where is_active_user();

grant select on v_sales_records to authenticated;
revoke all on v_sales_records from anon;

-- Create (p_id null) or edit one record. Returns its number (LD-2026-0001, INQ-…, QT-…, PO-…, FO-…, TSK-…).
create or replace function save_sales_record(p_kind text, p_id bigint, p_payload jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_res    text;
  v_prefix text;
  v_stats  text[];
  v_no     text;
  v_status text := btrim(coalesce(p_payload ->> 'status', ''));
  v_party  boolean := can_see_field('party_names');
  v_rates  boolean := can_see_field('sales_rates');
  v_qty    numeric := nullif(p_payload ->> 'qty', '')::numeric;
  v_rate   numeric := nullif(p_payload ->> 'rate', '')::numeric;
  v_due    date    := nullif(p_payload ->> 'due_date', '')::date;
  v_date   date    := coalesce(nullif(p_payload ->> 'doc_date', '')::date, current_date);
begin
  perform _require_user();
  select v.res, v.prefix, v.stats into v_res, v_prefix, v_stats from (values
    ('lead',           'leads',           'LD',  array['New', 'Contacted', 'Qualified', 'Lost', 'Converted']),
    ('inquiry',        'inquiries',       'INQ', array['Open', 'Quoted', 'Closed', 'Lost']),
    ('quotation',      'sales_quotation', 'QT',  array['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired']),
    ('purchase_order', 'purchase_orders', 'PO',  array['Received', 'Accepted', 'Cancelled']),
    ('final_order',    'final_orders',    'FO',  array['Confirmed', 'In Production', 'Completed', 'Cancelled']),
    ('task',           'task_assignment', 'TSK', array['Open', 'In Progress', 'Done', 'Cancelled'])
  ) as v(kind, res, prefix, stats) where v.kind = p_kind;
  if v_res is null then raise exception 'Unknown record type "%".', p_kind; end if;
  perform _require_write(v_res);
  if not (v_status = any (v_stats)) then raise exception 'Choose a status.'; end if;
  if p_kind = 'task' and btrim(coalesce(p_payload ->> 'title', '')) = '' then raise exception 'Enter the task.'; end if;
  if p_kind <> 'task' and v_party and btrim(coalesce(p_payload ->> 'party', '')) = '' then raise exception 'Enter the customer / company.'; end if;
  if p_kind in ('quotation', 'purchase_order', 'final_order') then
    if btrim(coalesce(p_payload ->> 'product', '')) = '' then raise exception 'Enter the product.'; end if;
    if coalesce(v_qty, 0) <= 0 then raise exception 'Enter the quantity.'; end if;
  end if;

  if p_id is null then
    v_no := v_prefix || '-' || extract(year from v_date)::int || '-' || lpad(next_doc_no('sales_' || p_kind, extract(year from v_date)::int)::text, 4, '0');
    insert into sales_records (kind, doc_no, doc_date, party, contact, phone, email, source, title, product, qty, rate,
                               ref_no, ext_ref, due_date, priority, status, assignee, remarks)
    values (p_kind, v_no, v_date,
            case when v_party then btrim(coalesce(p_payload ->> 'party', '')) else '' end,
            case when v_party then btrim(coalesce(p_payload ->> 'contact', '')) else '' end,
            case when v_party then btrim(coalesce(p_payload ->> 'phone', '')) else '' end,
            case when v_party then btrim(coalesce(p_payload ->> 'email', '')) else '' end,
            btrim(coalesce(p_payload ->> 'source', '')), btrim(coalesce(p_payload ->> 'title', '')),
            btrim(coalesce(p_payload ->> 'product', '')), v_qty,
            case when v_rates then v_rate end,
            btrim(coalesce(p_payload ->> 'ref_no', '')), btrim(coalesce(p_payload ->> 'ext_ref', '')), v_due,
            btrim(coalesce(p_payload ->> 'priority', '')), v_status, btrim(coalesce(p_payload ->> 'assignee', '')),
            btrim(coalesce(p_payload ->> 'remarks', '')));
    return v_no;
  end if;

  update sales_records r set
      doc_date = v_date,
      -- a role that cannot see these fields cannot change them either
      party    = case when v_party then btrim(coalesce(p_payload ->> 'party', '')) else r.party end,
      contact  = case when v_party then btrim(coalesce(p_payload ->> 'contact', '')) else r.contact end,
      phone    = case when v_party then btrim(coalesce(p_payload ->> 'phone', '')) else r.phone end,
      email    = case when v_party then btrim(coalesce(p_payload ->> 'email', '')) else r.email end,
      rate     = case when v_rates then v_rate else r.rate end,
      source   = btrim(coalesce(p_payload ->> 'source', '')),
      title    = btrim(coalesce(p_payload ->> 'title', '')),
      product  = btrim(coalesce(p_payload ->> 'product', '')),
      qty      = v_qty,
      ref_no   = btrim(coalesce(p_payload ->> 'ref_no', '')),
      ext_ref  = btrim(coalesce(p_payload ->> 'ext_ref', '')),
      due_date = v_due,
      priority = btrim(coalesce(p_payload ->> 'priority', '')),
      status   = v_status,
      assignee = btrim(coalesce(p_payload ->> 'assignee', '')),
      remarks  = btrim(coalesce(p_payload ->> 'remarks', '')),
      updated_at = now()
    where r.id = p_id and r.kind = p_kind
    returning r.doc_no into v_no;
  if v_no is null then raise exception 'That record no longer exists.'; end if;
  return v_no;
end $$;

revoke all on function save_sales_record(text, bigint, jsonb) from public, anon;
grant execute on function save_sales_record(text, bigint, jsonb) to authenticated;

-- Delete one record. Same page-level rule as saving: the role needs Write on that page.
create or replace function delete_sales_record(p_kind text, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res text := case p_kind
    when 'lead' then 'leads' when 'inquiry' then 'inquiries' when 'quotation' then 'sales_quotation'
    when 'purchase_order' then 'purchase_orders' when 'final_order' then 'final_orders' when 'task' then 'task_assignment' end;
begin
  perform _require_user();
  if v_res is null then raise exception 'Unknown record type "%".', p_kind; end if;
  perform _require_write(v_res);
  delete from sales_records where id = p_id and kind = p_kind;
  if not found then raise exception 'That record no longer exists.'; end if;
end $$;

revoke all on function delete_sales_record(text, bigint) from public, anon;
grant execute on function delete_sales_record(text, bigint) to authenticated;
