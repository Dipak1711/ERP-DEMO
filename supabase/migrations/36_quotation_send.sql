-- 36 · Send a quotation to the customer by e-mail (set up the same way as "Send to Supplier" for purchase orders).
-- Needs 34 and 35. Safe to run twice.
--
--  * The Edge Functions `send-quotation` (mails the approved quotation with its PDF) and `quotation-pdf` (just the PDF link) do the work with
--    the service role, AFTER asking `can_send_quotation` with the caller's own login.
--  * `queue_quotation_send` reserves a send (and refuses a second one within 30 seconds), `mark_quotation_sent` records the result:
--    Sent → an Approved quotation becomes Sent (and the first follow-up date is recorded); Failed → the error is logged, nothing else changes.
--  * Every send is kept in the e-mail log (date, time, user, customer e-mail, result), shown on the quotation page.
--  * E-mail itself is switched on later by adding the mail secrets to the Edge Functions (see supabase/functions/README.md).
--    Until then a send fails with a clear "E-mail is not set up yet" message and the quotation stays Approved; "Mark as Sent" still works
--    for quotations sent another way (WhatsApp, print and hand over).

-- ============================================================ 1. the log (closed table, read through a view)
create table if not exists sales_quotation_emails (
  id                  bigserial primary key,
  quotation_id        bigint not null references sales_quotations (id) on delete cascade,
  sent_to             text not null,
  cc                  text,
  note                text,
  sent_by             text,
  delivery_status     text not null default 'Queued' check (delivery_status in ('Queued', 'Sent', 'Failed')),
  error               text,
  pdf_path            text,
  provider_message_id text,
  sent_at             timestamptz not null default now()
);
create index if not exists sales_quotation_emails_q_idx on sales_quotation_emails (quotation_id, sent_at desc);
alter table sales_quotation_emails enable row level security;
revoke all on sales_quotation_emails from anon, authenticated, public;

create or replace view v_sales_quotation_emails as
select e.id, e.quotation_id, coalesce(q.qt_no, q.draft_no) as doc_no,
       mask_text(e.sent_to, 'party_names') as sent_to, mask_text(e.cc, 'party_names') as cc, e.note, e.sent_by,
       e.delivery_status, e.error, e.sent_at
  from sales_quotation_emails e join sales_quotations q on q.id = e.quotation_id
 where _sales_visible();

-- ============================================================ 2. who may send, and the two steps of a send
create or replace function can_send_quotation(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select is_active_user()
     and page_level('sales_quotation') = 'write'
     and can_see_field('party_names') and can_see_field('sales_rates')
     and exists (select 1 from sales_quotations where id = p_id and status in ('Approved', 'Sent'))
$$;

-- step 1: reserve the send. Service role only.
create or replace function queue_quotation_send(p_id bigint, p_email text, p_cc text, p_note text, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare q sales_quotations; v_id bigint;
begin
  select * into q from sales_quotations where id = p_id for update;
  if not found then raise exception 'That quotation does not exist.'; end if;
  if q.status not in ('Approved', 'Sent') then raise exception 'Quotation % is % — only an approved quotation can be sent.', coalesce(q.qt_no, q.draft_no), q.status; end if;
  if exists (select 1 from sales_quotation_emails where quotation_id = p_id and delivery_status in ('Queued', 'Sent') and sent_at > now() - interval '30 seconds') then
    raise exception 'Quotation % was just sent. Wait 30 seconds before sending it again.', coalesce(q.qt_no, q.draft_no);
  end if;
  insert into sales_quotation_emails (quotation_id, sent_to, cc, note, sent_by, delivery_status) values (p_id, p_email, p_cc, p_note, p_user, 'Queued') returning id into v_id;
  return v_id;
end $$;

-- step 2: record the result. Service role only.
create or replace function mark_quotation_sent(p_id bigint, p_email text, p_user text, p_ok boolean, p_error text default null,
                                               p_log_id bigint default null, p_pdf_path text default null, p_message_id text default null,
                                               p_next_date date default null) returns void
language plpgsql security definer set search_path = public as $$
declare q sales_quotations;
begin
  select * into q from sales_quotations where id = p_id for update;
  if not found then raise exception 'That quotation does not exist.'; end if;
  if p_log_id is not null and exists (select 1 from sales_quotation_emails where id = p_log_id and quotation_id = p_id) then
    update sales_quotation_emails set delivery_status = case when p_ok then 'Sent' else 'Failed' end, error = case when p_ok then null else left(p_error, 500) end,
           pdf_path = coalesce(p_pdf_path, pdf_path), provider_message_id = p_message_id, sent_at = now()
     where id = p_log_id;
  else
    insert into sales_quotation_emails (quotation_id, sent_to, sent_by, delivery_status, error, pdf_path, provider_message_id)
    values (p_id, p_email, p_user, case when p_ok then 'Sent' else 'Failed' end, case when p_ok then null else left(p_error, 500) end, p_pdf_path, p_message_id);
  end if;
  if p_ok then
    if q.status = 'Approved' then
      update sales_quotations set status = 'Sent', sent_at = now(), sent_by = p_user where id = p_id;
      perform _qt_log(p_id, 'Sent to customer', p_user, 'E-mailed to ' || p_email);
    else
      perform _qt_log(p_id, 'Sent again', p_user, 'E-mailed to ' || p_email);
    end if;
    if p_next_date is not null and p_next_date >= current_date then
      insert into sales_quotation_followups (quotation_id, followup_date, note, next_date, by_name)
      values (p_id, current_date, 'Quotation e-mailed to the customer', p_next_date, p_user);
    end if;
  end if;
end $$;

-- ============================================================ 3. PDF storage (written only by the Edge Function with the service role)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quotation-pdfs', 'quotation-pdfs', false, 5 * 1024 * 1024, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists quotation_pdfs_read on storage.objects;
create policy quotation_pdfs_read on storage.objects for select to authenticated
  using (bucket_id = 'quotation-pdfs' and public.is_active_user() and public.page_level('sales_quotation') <> 'hidden');

-- ============================================================ 4. grants
revoke all on v_sales_quotation_emails from anon, public;
grant select on v_sales_quotation_emails to authenticated;
revoke all on function can_send_quotation(bigint) from public, anon;
grant execute on function can_send_quotation(bigint) to authenticated;
revoke all on function queue_quotation_send(bigint, text, text, text, text),
                       mark_quotation_sent(bigint, text, text, boolean, text, bigint, text, text, date) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function queue_quotation_send(bigint, text, text, text, text),
                              mark_quotation_sent(bigint, text, text, boolean, text, bigint, text, text, date) to service_role;
  end if;
end $$;
