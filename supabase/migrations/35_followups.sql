-- 35 · Follow-ups: marking a quotation as sent can record the first follow-up date, and the Follow-ups page gets its access row.
-- Needs 34. Safe to run twice.
--
--  * send_sales_quotation(id, user, next_date): when a next follow-up date is given, a follow-up "Quotation sent to the customer" is
--    recorded with that date, so the Follow-ups page, the bell and the dashboard pick it up.
--  * The Follow-ups page only READS what the person may already see (quotations, orders, purchase orders, invoices, tasks, RFQs); it has
--    its own access row so the Director can switch it on or off per role in Settings → Access Control.

-- the old two-argument function is replaced (a second overload would make calls without a date ambiguous)
drop function if exists send_sales_quotation(bigint, text);

create or replace function send_sales_quotation(p_id bigint, p_user text, p_next_date date default null) returns void
language plpgsql security definer set search_path = public as $$
declare q sales_quotations;
begin
  perform _require_user();
  perform _require_write('sales_quotation');
  select * into q from sales_quotations where id = p_id for update;
  if not found then raise exception 'That quotation does not exist.'; end if;
  if q.status <> 'Approved' then raise exception 'Only an approved quotation can be sent to the customer (it is %).', q.status; end if;
  if p_next_date is not null and p_next_date < current_date then raise exception 'The follow-up date cannot be in the past.'; end if;
  update sales_quotations set status = 'Sent', sent_at = now(), sent_by = p_user where id = p_id;
  perform _qt_log(p_id, 'Sent to customer', p_user);
  if p_next_date is not null then
    insert into sales_quotation_followups (quotation_id, followup_date, note, next_date, by_name)
    values (p_id, current_date, 'Quotation sent to the customer', p_next_date, p_user);
  end if;
end $$;

revoke all on function send_sales_quotation(bigint, text, date) from public, anon;
grant execute on function send_sales_quotation(bigint, text, date) to authenticated;

insert into app_resources (key, label, section, sort, writable) values
  ('followups', 'Follow-ups', 'Main Menu', 11, false)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;

-- the trigger from 34 gives every role a row; fill in any that are missing
insert into role_page_access (role, resource, level)
  select r, a.key, _new_page_level(r, a.writable)
    from unnest(array['plant_head', 'accounts', 'qc', 'operator', 'viewer']::app_role[]) r cross join app_resources a
   where a.key = 'followups'
on conflict (role, resource) do nothing;
