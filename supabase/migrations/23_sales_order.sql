-- ============================================================
-- 23 · Sales Order page (Sales & Orders → Sales Order)
-- ============================================================
-- A Sales Order is kept exactly like a Purchase Order: customer, linked document, product, quantity, rate, delivery date, remarks.
-- It uses the same sales_records table, masking view and functions as the other Sales & Orders pages (see 21): customer names and
-- rates stay hidden for roles that may not see them, and saving / deleting needs Write on the new page.
-- Needs 21. Safe to run twice.

-- the new kind
alter table sales_records drop constraint if exists sales_records_kind_check;
alter table sales_records add constraint sales_records_kind_check
  check (kind in ('lead', 'inquiry', 'quotation', 'purchase_order', 'sales_order', 'final_order', 'task'));

-- the new page in Access Control, between Purchase Order and Final Order
insert into app_resources (key, label, section, sort, writable) values
  ('sales_orders', 'Sales Order', 'Sales & Orders', 16, true)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;
update app_resources set sort = 17 where key = 'final_orders';
update app_resources set sort = 18 where key = 'task_assignment';

insert into role_page_access (role, resource, level)
  select r, 'sales_orders', _default_level(r, 'sales_orders')
    from unnest(array['accounts', 'qc', 'operator', 'viewer']::app_role[]) r
on conflict (role, resource) do nothing;

-- the save / delete functions now know the new kind (everything else is unchanged from 21)
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
    ('sales_order',    'sales_orders',    'SO',  array['Draft', 'Confirmed', 'Delivered', 'Cancelled']),
    ('final_order',    'final_orders',    'FO',  array['Confirmed', 'In Production', 'Completed', 'Cancelled']),
    ('task',           'task_assignment', 'TSK', array['Open', 'In Progress', 'Done', 'Cancelled'])
  ) as v(kind, res, prefix, stats) where v.kind = p_kind;
  if v_res is null then raise exception 'Unknown record type "%".', p_kind; end if;
  perform _require_write(v_res);
  if not (v_status = any (v_stats)) then raise exception 'Choose a status.'; end if;
  if p_kind = 'task' and btrim(coalesce(p_payload ->> 'title', '')) = '' then raise exception 'Enter the task.'; end if;
  if p_kind <> 'task' and v_party and btrim(coalesce(p_payload ->> 'party', '')) = '' then raise exception 'Enter the customer / company.'; end if;
  if p_kind in ('quotation', 'purchase_order', 'sales_order', 'final_order') then
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

create or replace function delete_sales_record(p_kind text, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res text := case p_kind
    when 'lead' then 'leads' when 'inquiry' then 'inquiries' when 'quotation' then 'sales_quotation'
    when 'purchase_order' then 'purchase_orders' when 'sales_order' then 'sales_orders' when 'final_order' then 'final_orders' when 'task' then 'task_assignment' end;
begin
  perform _require_user();
  if v_res is null then raise exception 'Unknown record type "%".', p_kind; end if;
  perform _require_write(v_res);
  delete from sales_records where id = p_id and kind = p_kind;
  if not found then raise exception 'That record no longer exists.'; end if;
end $$;

revoke all on function delete_sales_record(text, bigint) from public, anon;
grant execute on function delete_sales_record(text, bigint) to authenticated;
