-- 34 · Sales module: Sales Quotation with costing + Director approval, Sales Order (the work order), follow-ups, minimum margin.
-- Needs 18–33. Safe to run twice.
--
-- THE FLOW  (statuses of a quotation)
--   Draft → Pending Approval → Approved / Rejected / Revision Required → Sent → Won / Lost
--   * The Plant Head prepares it: customer, lines (product, qty, price, discount) and the cost of each line typed by hand
--     (material + processing + other, per unit). The margin is worked out from them.
--   * Only a person with Write on "Quotation Approvals" (the Director by default) approves, rejects or sends it back.
--   * The quotation number QT-yyyy-nnnn is given when it is approved. Before that it carries a draft number QD-yyyy-nnnn.
--   * Won → a Sales Order (SO-yyyy-nnnn) is created from it, line by line.
--
-- GROSS MARGIN % = (net rate − total cost) ÷ net rate × 100, per unit, where net rate = rate after discount and
-- total cost = material + processing + other cost. For a whole quotation: total profit ÷ total amount × 100 (weighted by quantity).
--   e.g. quoted 500 / kg, cost 425 / kg → profit 75 → margin 15 %.
--
-- WHO SEES WHAT (existing Access Control switches, plus one new one)
--   customer / contact       party_names        rate, discount value, amounts   sales_rates
--   cost, profit, margin %   margins   (NEW: "Costs & margins" — Director and Plant Head by default)
-- The tables are closed to clients: they read the v_sales_* views (which withhold hidden values) and write through the functions.

-- ============================================================ 0. access control
insert into field_groups (key, label, description, sort) values
  ('margins', 'Costs & margins', 'Cost of each quotation line, profit and gross margin %', 6)
on conflict (key) do nothing;

create or replace function _default_field(p_role app_role, p_group text) returns boolean
language sql immutable as $$
  select case when p_group = 'margins' then p_role in ('director', 'plant_head')
              else p_role in ('director', 'plant_head', 'accounts') end;
$$;

insert into role_field_access (role, field_group, visible)
  select r, g.key, _default_field(r, g.key)
    from unnest(array['plant_head', 'accounts', 'qc', 'operator', 'viewer']::app_role[]) r cross join field_groups g
on conflict (role, field_group) do nothing;

-- A page added after the access tables were first filled used to have NO row for any role, so every role except the Director saw it
-- as Hidden (page_level() falls back to 'hidden'). New pages now get a row for every role automatically, and the pages that are
-- already missing rows (the purchase pages added in 30–33) get theirs below. A setting an admin has saved is never changed.
create or replace function _new_page_level(p_role app_role, p_writable boolean) returns text
language sql immutable as $$
  select case
    when p_role in ('director', 'plant_head') then case when p_writable then 'write' else 'read' end
    when p_role = 'accounts' then case when p_writable then 'write' else 'read' end
    when p_role = 'viewer' then 'read'
    else 'hidden' end;          -- QC and Operator start without it; the Director can open it in Settings → Access Control
$$;

create or replace function trg_resource_role_rows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into role_page_access (role, resource, level)
    select r, new.key, _new_page_level(r, new.writable) from unnest(array['plant_head', 'accounts', 'qc', 'operator', 'viewer']::app_role[]) r
  on conflict (role, resource) do nothing;
  return new;
end $$;
drop trigger if exists app_resources_role_rows on app_resources;
create trigger app_resources_role_rows after insert on app_resources for each row execute function trg_resource_role_rows();

-- the new pages (the rows come from the trigger above; the approvals page is then narrowed for the Plant Head, once)
do $$
declare v_new boolean := not exists (select 1 from app_resources where key = 'quotation_approvals');
begin
  insert into app_resources (key, label, section, sort, writable) values
    ('quotation_approvals', 'Quotation Approvals', 'Sales & Orders', 14, true),
    ('sales_reports',       'Sales Reports',       'Sales & Orders', 19, false)
  on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;
  if v_new then
    -- approving is the Director's job: the Plant Head can see the approvals page but not decide, everybody else does not see it
    update role_page_access set level = 'read' where resource = 'quotation_approvals' and role in ('plant_head', 'accounts', 'viewer');
    update role_page_access set level = 'hidden' where resource = 'quotation_approvals' and role in ('qc', 'operator');
  end if;
  -- the sales pages that become editable / viewable in the new module keep the labels they had
  update app_resources set writable = true where key in ('sales_quotation', 'sales_orders');
  update app_resources set sort = 12 where key = 'sales_quotation' and sort <> 12;
end $$;

-- pages that exist but have no row for a role (added after 29): fill them in
insert into role_page_access (role, resource, level)
  select r, a.key, _new_page_level(r, a.writable)
    from unnest(array['plant_head', 'accounts', 'qc', 'operator', 'viewer']::app_role[]) r cross join app_resources a
on conflict (role, resource) do nothing;

-- ============================================================ 1. settings
create table if not exists sales_settings (
  id             int primary key default 1 check (id = 1),
  min_margin_pct numeric not null default 15 check (min_margin_pct >= 0 and min_margin_pct < 100)
);
insert into sales_settings (id) values (1) on conflict (id) do nothing;
alter table sales_settings enable row level security;
revoke all on sales_settings from anon, authenticated, public;

create or replace function sales_min_margin() returns numeric
language sql stable security definer set search_path = public as $$ select min_margin_pct from sales_settings where id = 1 $$;

-- ============================================================ 2. tables
create table if not exists sales_quotations (
  id             bigserial primary key,
  draft_no       text not null unique,                 -- QD-2026-0001, from the moment it is created
  qt_no          text unique,                          -- QT-2026-0001, given when the Director approves
  qt_date        date not null default current_date,
  customer       text not null default '',             -- CONFIDENTIAL (party_names)
  contact        text not null default '',
  phone          text not null default '',
  email          text not null default '',
  enquiry_no     text not null default '',             -- the enquiry / inquiry this answers
  salesperson    text not null default '',             -- whoever prepared it (the Plant Head)
  payment_terms  text not null default '',
  delivery_terms text not null default '',
  valid_until    date,
  remarks        text not null default '',
  status         text not null default 'Draft'
                 check (status in ('Draft', 'Pending Approval', 'Revision Required', 'Rejected', 'Approved', 'Sent', 'Won', 'Lost')),
  submitted_at   timestamptz,
  approved_by    text,
  approved_at    timestamptz,
  decision_note  text,
  sent_at        timestamptz,
  sent_by        text,
  response_date  date,
  lost_reason    text,
  response_note  text,
  legacy         boolean not null default false,       -- copied from the old Sales Quotation page (no cost entered)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists sales_quotations_status_idx on sales_quotations (status, qt_date desc);

create table if not exists sales_quotation_items (
  id            bigserial primary key,
  quotation_id  bigint not null references sales_quotations (id) on delete cascade,
  line_no       int not null,
  product       text not null,
  grade         text not null default '',
  size          text not null default '',
  uom           text not null default 'PCS',
  qty           numeric not null check (qty > 0),
  rate          numeric not null check (rate >= 0),                       -- price per unit before discount   (CONFIDENTIAL: sales_rates)
  discount_pct  numeric not null default 0 check (discount_pct >= 0 and discount_pct < 100),
  material_cost   numeric check (material_cost >= 0),                     -- cost per unit                    (CONFIDENTIAL: margins)
  processing_cost numeric check (processing_cost >= 0),
  other_cost      numeric check (other_cost >= 0),
  unique (quotation_id, line_no)
);

create table if not exists sales_quotation_actions (          -- the approval trail
  id           bigserial primary key,
  quotation_id bigint not null references sales_quotations (id) on delete cascade,
  action       text not null,
  actor        text,
  note         text,
  margin_pct   numeric,
  acted_at     timestamptz not null default now()
);
create index if not exists sales_quotation_actions_q_idx on sales_quotation_actions (quotation_id, acted_at);

create table if not exists sales_quotation_followups (
  id            bigserial primary key,
  quotation_id  bigint not null references sales_quotations (id) on delete cascade,
  followup_date date not null,
  note          text not null,
  next_date     date,
  by_name       text,
  created_at    timestamptz not null default now()
);
create index if not exists sales_quotation_followups_q_idx on sales_quotation_followups (quotation_id, followup_date);

create table if not exists sales_orders (
  id             bigserial primary key,
  so_no          text not null unique,                  -- SO-2026-0001
  so_date        date not null default current_date,
  quotation_id   bigint references sales_quotations (id),
  customer       text not null default '',              -- CONFIDENTIAL (party_names)
  contact        text not null default '',
  phone          text not null default '',
  email          text not null default '',
  ext_ref        text not null default '',              -- the customer's own purchase-order number
  delivery_date  date,
  payment_terms  text not null default '',
  delivery_terms text not null default '',
  remarks        text not null default '',
  status         text not null default 'Draft' check (status in ('Draft', 'Confirmed', 'In Production', 'Delivered', 'Cancelled')),
  cancel_reason  text,
  legacy         boolean not null default false,
  created_by_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists sales_orders_quotation_key on sales_orders (quotation_id) where quotation_id is not null and status <> 'Cancelled';

create table if not exists sales_order_items (
  id        bigserial primary key,
  order_id  bigint not null references sales_orders (id) on delete cascade,
  line_no   int not null,
  product   text not null,
  grade     text not null default '',
  size      text not null default '',
  uom       text not null default 'PCS',
  qty       numeric not null check (qty > 0),
  rate      numeric not null check (rate >= 0),         -- price per unit                (CONFIDENTIAL: sales_rates)
  unique (order_id, line_no)
);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'sales_quotations_updated') then
    create trigger sales_quotations_updated before update on sales_quotations for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'sales_orders_updated') then
    create trigger sales_orders_updated before update on sales_orders for each row execute function set_updated_at();
  end if;
end $$;

-- closed to clients: the views and functions below are the only way in
alter table sales_quotations          enable row level security;
alter table sales_quotation_items     enable row level security;
alter table sales_quotation_actions   enable row level security;
alter table sales_quotation_followups enable row level security;
alter table sales_orders              enable row level security;
alter table sales_order_items         enable row level security;
revoke all on sales_quotations, sales_quotation_items, sales_quotation_actions, sales_quotation_followups, sales_orders, sales_order_items
  from anon, authenticated, public;

-- ============================================================ 3. views (they withhold what the role may not see)
-- may the signed-in person open any page of the sales module?
create or replace function _sales_visible() returns boolean
language sql stable security definer set search_path = public as $$
  select is_active_user() and (page_level('sales_quotation') <> 'hidden' or page_level('quotation_approvals') <> 'hidden'
                               or page_level('sales_dashboard') <> 'hidden' or page_level('sales_reports') <> 'hidden'
                               or page_level('sales_orders') <> 'hidden')
$$;

create or replace view v_sales_settings as
  select s.min_margin_pct from sales_settings s where s.id = 1 and _sales_visible();

create or replace view v_sales_quotation_items as
select i.id, i.quotation_id, coalesce(q.qt_no, q.draft_no) as doc_no, q.qt_no, q.draft_no, q.status, q.qt_date, q.valid_until, q.salesperson,
       mask_text(q.customer, 'party_names') as customer,
       i.line_no, i.product, i.grade, i.size, i.uom, i.qty, i.discount_pct,
       mask_num(i.rate, 'sales_rates')                                                      as rate,
       mask_num(round(i.rate * (1 - i.discount_pct / 100), 4), 'sales_rates')               as net_rate,
       mask_num(round(i.qty * i.rate * (1 - i.discount_pct / 100), 2), 'sales_rates')       as amount,
       mask_num(i.material_cost,   'margins') as material_cost,
       mask_num(i.processing_cost, 'margins') as processing_cost,
       mask_num(i.other_cost,      'margins') as other_cost,
       mask_num(case when i.material_cost is null then null else i.material_cost + coalesce(i.processing_cost, 0) + coalesce(i.other_cost, 0) end, 'margins') as unit_cost,
       mask_num(case when i.material_cost is null then null
                     else round(i.rate * (1 - i.discount_pct / 100) - (i.material_cost + coalesce(i.processing_cost, 0) + coalesce(i.other_cost, 0)), 4) end, 'margins') as unit_profit,
       mask_num(case when i.material_cost is null or i.rate * (1 - i.discount_pct / 100) <= 0 then null
                     else round((i.rate * (1 - i.discount_pct / 100) - (i.material_cost + coalesce(i.processing_cost, 0) + coalesce(i.other_cost, 0)))
                                / (i.rate * (1 - i.discount_pct / 100)) * 100, 2) end, 'margins') as margin_pct
  from sales_quotation_items i
  join sales_quotations q on q.id = i.quotation_id
 where _sales_visible();

create or replace view v_sales_quotations as
with agg as (
  select i.quotation_id,
         count(*)::int                                                                                      as line_count,
         string_agg(i.product, ', ' order by i.line_no)                                                     as products,
         sum(i.qty)                                                                                         as total_qty,
         sum(i.qty * i.rate * (1 - i.discount_pct / 100))                                                   as amount,
         sum(i.qty * i.rate * i.discount_pct / 100)                                                         as discount_value,
         case when count(i.material_cost) = count(*)
              then sum(i.qty * (i.material_cost + coalesce(i.processing_cost, 0) + coalesce(i.other_cost, 0))) end as cost_total
    from sales_quotation_items i group by i.quotation_id
), fu as (
  select quotation_id, max(followup_date) as last_followup, count(*)::int as followups,
         (array_agg(next_date order by followup_date desc, id desc))[1] as next_followup
    from sales_quotation_followups group by quotation_id
)
select q.id, coalesce(q.qt_no, q.draft_no) as doc_no, q.qt_no, q.draft_no, q.qt_date, q.status,
       (q.status in ('Approved', 'Sent') and q.valid_until is not null and q.valid_until < current_date) as is_expired,
       case when q.status in ('Approved', 'Sent') and q.valid_until is not null and q.valid_until < current_date then 'Expired' else q.status end as display_status,
       q.valid_until, q.enquiry_no, q.salesperson, q.payment_terms, q.delivery_terms, q.remarks,
       q.submitted_at, q.approved_by, q.approved_at, q.decision_note, q.sent_at, q.sent_by,
       q.response_date, q.lost_reason, q.response_note, q.legacy, q.created_at, q.updated_at,
       coalesce(a.line_count, 0) as line_count, a.products, a.total_qty,
       mask_text(q.customer, 'party_names') as customer,
       mask_text(q.contact,  'party_names') as contact,
       mask_text(q.phone,    'party_names') as phone,
       mask_text(q.email,    'party_names') as email,
       mask_num(round(a.amount, 2),         'sales_rates') as amount,
       mask_num(round(a.discount_value, 2), 'sales_rates') as discount_value,
       mask_num(round(a.cost_total, 2),     'margins')     as cost_total,
       mask_num(case when a.cost_total is null then null else round(a.amount - a.cost_total, 2) end, 'margins') as profit,
       mask_num(case when a.cost_total is null or coalesce(a.amount, 0) <= 0 then null else round((a.amount - a.cost_total) / a.amount * 100, 2) end, 'margins') as margin_pct,
       (case when can_see_field('margins') and a.cost_total is not null and coalesce(a.amount, 0) > 0
             then (a.amount - a.cost_total) / a.amount * 100 < sales_min_margin() end) as below_min_margin,
       (select min_margin_pct from sales_settings where id = 1) as min_margin_pct,
       case when q.status = 'Sent' then current_date - q.sent_at::date end as days_pending,
       fu.last_followup as last_followup_date, fu.next_followup as next_followup_date, coalesce(fu.followups, 0) as followup_count,
       so.id as order_id, so.so_no as order_no
  from sales_quotations q
  left join agg a on a.quotation_id = q.id
  left join fu on fu.quotation_id = q.id
  left join sales_orders so on so.quotation_id = q.id and so.status <> 'Cancelled'
 where _sales_visible();

create or replace view v_sales_quotation_actions as
select a.id, a.quotation_id, coalesce(q.qt_no, q.draft_no) as doc_no, a.action, a.actor, a.note, a.acted_at,
       mask_num(a.margin_pct, 'margins') as margin_pct
  from sales_quotation_actions a join sales_quotations q on q.id = a.quotation_id
 where _sales_visible();

create or replace view v_sales_quotation_followups as
select f.id, f.quotation_id, coalesce(q.qt_no, q.draft_no) as doc_no, f.followup_date, f.note, f.next_date, f.by_name, f.created_at
  from sales_quotation_followups f join sales_quotations q on q.id = f.quotation_id
 where _sales_visible();

-- the rate each customer was quoted for each product, with the previous one (Customer Price History / Rate Comparison reports)
create or replace view v_customer_price_history as
select q.id as quotation_id, coalesce(q.qt_no, q.draft_no) as doc_no, q.qt_date,
       mask_text(q.customer, 'party_names') as customer, i.product, i.grade, i.size, i.uom,
       mask_num(round(i.rate * (1 - i.discount_pct / 100), 4), 'sales_rates') as rate,
       mask_num(round(lag(i.rate * (1 - i.discount_pct / 100)) over w, 4), 'sales_rates') as previous_rate
  from sales_quotation_items i
  join sales_quotations q on q.id = i.quotation_id
 where q.status in ('Approved', 'Sent', 'Won', 'Lost') and _sales_visible()
window w as (partition by lower(q.customer), lower(i.product), lower(i.grade), lower(i.size) order by q.qt_date, q.id);

create or replace view v_sales_orders as
select o.id, o.so_no, o.so_date, o.quotation_id, q.qt_no as quotation_no, o.ext_ref, o.delivery_date, o.payment_terms, o.delivery_terms, o.remarks,
       o.status, o.cancel_reason, o.legacy, o.created_by_name, o.created_at, o.updated_at,
       mask_text(o.customer, 'party_names') as customer,
       mask_text(o.contact,  'party_names') as contact,
       mask_text(o.phone,    'party_names') as phone,
       mask_text(o.email,    'party_names') as email,
       (select count(*)::int from sales_order_items i where i.order_id = o.id) as line_count,
       (select string_agg(i.product, ', ' order by i.line_no) from sales_order_items i where i.order_id = o.id) as products,
       (select sum(i.qty) from sales_order_items i where i.order_id = o.id) as total_qty,
       mask_num((select round(sum(i.qty * i.rate), 2) from sales_order_items i where i.order_id = o.id), 'sales_rates') as amount
  from sales_orders o
  left join sales_quotations q on q.id = o.quotation_id
 where _sales_visible();

create or replace view v_sales_order_items as
select i.id, i.order_id, o.so_no, i.line_no, i.product, i.grade, i.size, i.uom, i.qty,
       mask_num(i.rate, 'sales_rates') as rate, mask_num(round(i.qty * i.rate, 2), 'sales_rates') as amount
  from sales_order_items i join sales_orders o on o.id = i.order_id
 where _sales_visible();

-- ============================================================ 4. functions
-- the next free document number (never one that is already used, whatever the counter says)
create or replace function _next_qt_no(p_year int) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  loop
    v := 'QT-' || p_year || '-' || lpad(next_doc_no('sales_quotation', p_year)::text, 4, '0');
    exit when not exists (select 1 from sales_quotations where qt_no = v) and not exists (select 1 from sales_records where doc_no = v);
  end loop;
  return v;
end $$;

create or replace function _next_so_no(p_year int) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  loop
    v := 'SO-' || p_year || '-' || lpad(next_doc_no('sales_sales_order', p_year)::text, 4, '0');
    exit when not exists (select 1 from sales_orders where so_no = v) and not exists (select 1 from sales_records where doc_no = v);
  end loop;
  return v;
end $$;

create or replace function _qt_margin(p_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select case when count(i.material_cost) = count(*) and sum(i.qty * i.rate * (1 - i.discount_pct / 100)) > 0
              then round((sum(i.qty * i.rate * (1 - i.discount_pct / 100))
                          - sum(i.qty * (i.material_cost + coalesce(i.processing_cost, 0) + coalesce(i.other_cost, 0))))
                         / sum(i.qty * i.rate * (1 - i.discount_pct / 100)) * 100, 2) end
    from sales_quotation_items i where i.quotation_id = p_id
$$;

create or replace function _qt_log(p_id bigint, p_action text, p_actor text, p_note text default null) returns void
language sql security definer set search_path = public as $$
  insert into sales_quotation_actions (quotation_id, action, actor, note, margin_pct) values (p_id, p_action, p_actor, nullif(btrim(p_note), ''), _qt_margin(p_id))
$$;

-- p_header = {customer, contact, phone, email, enquiry_no, payment_terms, delivery_terms, valid_until, remarks, qt_date}
-- p_items  = [{product, grade, size, uom, qty, rate, discount_pct, material_cost, processing_cost, other_cost}]
create or replace function save_sales_quotation(p_id bigint, p_header jsonb, p_items jsonb, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  q       sales_quotations;
  v_id    bigint := p_id;
  v_year  int := extract(year from current_date)::int;
  x       jsonb;
  v_line  int := 0;
  v_valid date := nullif(p_header ->> 'valid_until', '')::date;
begin
  perform _require_user();
  perform _require_write('sales_quotation');
  if not (can_see_field('party_names') and can_see_field('sales_rates') and can_see_field('margins')) then
    raise exception 'A quotation holds customer names, prices and costs. Ask the Director for access to Party names, Sales rates and Costs & margins.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_header ->> 'customer', '')) = '' then raise exception 'Enter the customer.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one product line.'; end if;

  if v_id is not null then
    select * into q from sales_quotations where id = v_id for update;
    if not found then raise exception 'That quotation does not exist.'; end if;
    if q.status not in ('Draft', 'Revision Required') then raise exception 'Quotation % is % and can no longer be edited.', coalesce(q.qt_no, q.draft_no), q.status; end if;
  end if;

  for x in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    if btrim(coalesce(x ->> 'product', '')) = '' then raise exception 'Line %: enter the product.', v_line; end if;
    if not (coalesce(nullif(x ->> 'qty', '')::numeric, 0) > 0) then raise exception 'Line %: enter the quantity.', v_line; end if;
    if coalesce(nullif(x ->> 'rate', '')::numeric, -1) < 0 then raise exception 'Line %: enter the rate.', v_line; end if;
    if coalesce(nullif(x ->> 'discount_pct', '')::numeric, 0) < 0 or coalesce(nullif(x ->> 'discount_pct', '')::numeric, 0) >= 100 then
      raise exception 'Line %: the discount must be from 0 up to 99.99 %%.', v_line;
    end if;
  end loop;

  if v_id is null then
    insert into sales_quotations (draft_no, qt_date, customer, contact, phone, email, enquiry_no, salesperson, payment_terms, delivery_terms, valid_until, remarks)
    values ('QD-' || v_year || '-' || lpad(next_doc_no('sales_qt_draft', v_year)::text, 4, '0'),
            coalesce(nullif(p_header ->> 'qt_date', '')::date, current_date),
            btrim(p_header ->> 'customer'), btrim(coalesce(p_header ->> 'contact', '')), btrim(coalesce(p_header ->> 'phone', '')), btrim(coalesce(p_header ->> 'email', '')),
            btrim(coalesce(p_header ->> 'enquiry_no', '')), coalesce(p_user, ''), btrim(coalesce(p_header ->> 'payment_terms', '')), btrim(coalesce(p_header ->> 'delivery_terms', '')),
            v_valid, btrim(coalesce(p_header ->> 'remarks', '')))
    returning id into v_id;
    perform _qt_log(v_id, 'Created', p_user);
  else
    update sales_quotations set qt_date = coalesce(nullif(p_header ->> 'qt_date', '')::date, qt_date), customer = btrim(p_header ->> 'customer'),
           contact = btrim(coalesce(p_header ->> 'contact', '')), phone = btrim(coalesce(p_header ->> 'phone', '')), email = btrim(coalesce(p_header ->> 'email', '')),
           enquiry_no = btrim(coalesce(p_header ->> 'enquiry_no', '')), payment_terms = btrim(coalesce(p_header ->> 'payment_terms', '')),
           delivery_terms = btrim(coalesce(p_header ->> 'delivery_terms', '')), valid_until = v_valid, remarks = btrim(coalesce(p_header ->> 'remarks', ''))
     where id = v_id;
    delete from sales_quotation_items where quotation_id = v_id;
  end if;

  v_line := 0;
  for x in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    insert into sales_quotation_items (quotation_id, line_no, product, grade, size, uom, qty, rate, discount_pct, material_cost, processing_cost, other_cost)
    values (v_id, v_line, btrim(x ->> 'product'), btrim(coalesce(x ->> 'grade', '')), btrim(coalesce(x ->> 'size', '')), coalesce(nullif(btrim(x ->> 'uom'), ''), 'PCS'),
            (x ->> 'qty')::numeric, (x ->> 'rate')::numeric, coalesce(nullif(x ->> 'discount_pct', '')::numeric, 0),
            nullif(x ->> 'material_cost', '')::numeric, nullif(x ->> 'processing_cost', '')::numeric, nullif(x ->> 'other_cost', '')::numeric);
  end loop;
  return v_id;
end $$;

create or replace function submit_sales_quotation(p_id bigint, p_user text) returns void
language plpgsql security definer set search_path = public as $$
declare
  q sales_quotations;
begin
  perform _require_user();
  perform _require_write('sales_quotation');
  select * into q from sales_quotations where id = p_id for update;
  if not found then raise exception 'That quotation does not exist.'; end if;
  if q.status not in ('Draft', 'Revision Required') then raise exception 'Quotation % is % and cannot be submitted.', coalesce(q.qt_no, q.draft_no), q.status; end if;
  if q.valid_until is null then raise exception 'Enter how long the quotation is valid (Valid until).'; end if;
  if q.valid_until < current_date then raise exception 'The validity date has already passed.'; end if;
  if exists (select 1 from sales_quotation_items where quotation_id = p_id and material_cost is null) then
    raise exception 'Enter the cost of every line (at least the material cost) so the margin can be worked out before approval.';
  end if;
  update sales_quotations set status = 'Pending Approval', submitted_at = now() where id = p_id;
  perform _qt_log(p_id, 'Submitted', p_user);
end $$;

-- p_decision: 'approve' | 'reject' | 'revise'. Needs Write on "Quotation Approvals" (the Director by default).
create or replace function decide_sales_quotation(p_id bigint, p_decision text, p_note text, p_user text) returns void
language plpgsql security definer set search_path = public as $$
declare
  q sales_quotations;
  v_margin numeric;
  v_year int := extract(year from current_date)::int;
begin
  perform _require_user();
  perform _require_write('quotation_approvals');
  select * into q from sales_quotations where id = p_id for update;
  if not found then raise exception 'That quotation does not exist.'; end if;
  if q.status <> 'Pending Approval' then raise exception 'Quotation % is % — only a quotation waiting for approval can be decided.', coalesce(q.qt_no, q.draft_no), q.status; end if;
  v_margin := _qt_margin(p_id);
  if p_decision = 'approve' then
    if v_margin is not null and v_margin < sales_min_margin() and coalesce(btrim(p_note), '') = '' then
      raise exception 'The margin (% %%) is below the minimum of % %%. Enter a note saying why you approve it.', v_margin, sales_min_margin();
    end if;
    update sales_quotations set status = 'Approved', approved_by = p_user, approved_at = now(), decision_note = nullif(btrim(p_note), ''),
           qt_no = coalesce(qt_no, _next_qt_no(v_year))
     where id = p_id;
    perform _qt_log(p_id, 'Approved', p_user, p_note);
  elsif p_decision = 'reject' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Enter the reason for rejecting.'; end if;
    update sales_quotations set status = 'Rejected', approved_by = p_user, approved_at = now(), decision_note = btrim(p_note) where id = p_id;
    perform _qt_log(p_id, 'Rejected', p_user, p_note);
  elsif p_decision = 'revise' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Tell the sender what to change.'; end if;
    update sales_quotations set status = 'Revision Required', decision_note = btrim(p_note) where id = p_id;
    perform _qt_log(p_id, 'Revision Requested', p_user, p_note);
  else
    raise exception 'Choose approve, reject or send back for revision.';
  end if;
end $$;

create or replace function send_sales_quotation(p_id bigint, p_user text) returns void
language plpgsql security definer set search_path = public as $$
declare q sales_quotations;
begin
  perform _require_user();
  perform _require_write('sales_quotation');
  select * into q from sales_quotations where id = p_id for update;
  if not found then raise exception 'That quotation does not exist.'; end if;
  if q.status <> 'Approved' then raise exception 'Only an approved quotation can be sent to the customer (it is %).', q.status; end if;
  update sales_quotations set status = 'Sent', sent_at = now(), sent_by = p_user where id = p_id;
  perform _qt_log(p_id, 'Sent to customer', p_user);
end $$;

-- the customer's answer. p_response: 'Won' | 'Lost'. A lost quotation needs one of the standard reasons (Other needs a note).
create or replace function respond_sales_quotation(p_id bigint, p_response text, p_reason text, p_note text, p_date date, p_user text) returns void
language plpgsql security definer set search_path = public as $$
declare q sales_quotations;
begin
  perform _require_user();
  perform _require_write('sales_quotation');
  select * into q from sales_quotations where id = p_id for update;
  if not found then raise exception 'That quotation does not exist.'; end if;
  if q.status <> 'Sent' then raise exception 'Only a quotation that has been sent can get a customer response (it is %).', q.status; end if;
  if p_response not in ('Won', 'Lost') then raise exception 'The response is Won or Lost.'; end if;
  if p_response = 'Lost' then
    if coalesce(p_reason, '') not in ('Price High', 'Delivery Time High', 'Customer Cancelled', 'Competitor Price Lower', 'Quality Issue', 'Customer Requirement Changed', 'Other') then
      raise exception 'Choose why the quotation was lost.';
    end if;
    if p_reason = 'Other' and coalesce(btrim(p_note), '') = '' then raise exception 'Describe the reason in the note.'; end if;
  end if;
  update sales_quotations set status = p_response, response_date = coalesce(p_date, current_date),
         lost_reason = case when p_response = 'Lost' then p_reason end, response_note = nullif(btrim(p_note), '') where id = p_id;
  perform _qt_log(p_id, p_response, p_user, concat_ws(' — ', nullif(p_reason, ''), nullif(btrim(p_note), '')));
end $$;

create or replace function add_quotation_followup(p_id bigint, p_date date, p_note text, p_next_date date, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare q sales_quotations; v_id bigint;
begin
  perform _require_user();
  perform _require_write('sales_quotation');
  select * into q from sales_quotations where id = p_id;
  if not found then raise exception 'That quotation does not exist.'; end if;
  if q.status not in ('Sent', 'Approved') then raise exception 'Follow-ups are recorded once the quotation is approved or sent.'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Write what was discussed.'; end if;
  if p_next_date is not null and p_next_date < coalesce(p_date, current_date) then raise exception 'The next follow-up cannot be before this one.'; end if;
  insert into sales_quotation_followups (quotation_id, followup_date, note, next_date, by_name)
  values (p_id, coalesce(p_date, current_date), btrim(p_note), p_next_date, p_user) returning id into v_id;
  return v_id;
end $$;

-- Director sets the minimum margin the dashboard and the approval flag compare against
create or replace function set_min_margin(p_pct numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('quotation_approvals');
  if p_pct is null or p_pct < 0 or p_pct >= 100 then raise exception 'The minimum margin is from 0 up to 99.99 %%.'; end if;
  update sales_settings set min_margin_pct = p_pct where id = 1;
end $$;

-- ---------------------------------------------------------------- sales orders
-- p_header = {customer, contact, phone, email, ext_ref, delivery_date, payment_terms, delivery_terms, remarks, so_date, quotation_id}
-- p_items  = [{product, grade, size, uom, qty, rate}]
create or replace function save_sales_order(p_id bigint, p_header jsonb, p_items jsonb, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  o      sales_orders;
  v_id   bigint := p_id;
  v_year int := extract(year from current_date)::int;
  x      jsonb;
  v_line int := 0;
begin
  perform _require_user();
  perform _require_write('sales_orders');
  if not (can_see_field('party_names') and can_see_field('sales_rates')) then
    raise exception 'A sales order holds customer names and prices. Ask the Director for access to Party names and Sales rates.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_header ->> 'customer', '')) = '' then raise exception 'Enter the customer.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one product line.'; end if;
  if v_id is not null then
    select * into o from sales_orders where id = v_id for update;
    if not found then raise exception 'That sales order does not exist.'; end if;
    if o.status <> 'Draft' then raise exception 'Sales order % is % and can no longer be edited.', o.so_no, o.status; end if;
  end if;
  for x in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    if btrim(coalesce(x ->> 'product', '')) = '' then raise exception 'Line %: enter the product.', v_line; end if;
    if not (coalesce(nullif(x ->> 'qty', '')::numeric, 0) > 0) then raise exception 'Line %: enter the quantity.', v_line; end if;
    if coalesce(nullif(x ->> 'rate', '')::numeric, -1) < 0 then raise exception 'Line %: enter the rate.', v_line; end if;
  end loop;

  if v_id is null then
    insert into sales_orders (so_no, so_date, quotation_id, customer, contact, phone, email, ext_ref, delivery_date, payment_terms, delivery_terms, remarks, created_by_name)
    values (_next_so_no(v_year),
            coalesce(nullif(p_header ->> 'so_date', '')::date, current_date), nullif(p_header ->> 'quotation_id', '')::bigint,
            btrim(p_header ->> 'customer'), btrim(coalesce(p_header ->> 'contact', '')), btrim(coalesce(p_header ->> 'phone', '')), btrim(coalesce(p_header ->> 'email', '')),
            btrim(coalesce(p_header ->> 'ext_ref', '')), nullif(p_header ->> 'delivery_date', '')::date,
            btrim(coalesce(p_header ->> 'payment_terms', '')), btrim(coalesce(p_header ->> 'delivery_terms', '')), btrim(coalesce(p_header ->> 'remarks', '')), p_user)
    returning id into v_id;
  else
    update sales_orders set so_date = coalesce(nullif(p_header ->> 'so_date', '')::date, so_date), customer = btrim(p_header ->> 'customer'),
           contact = btrim(coalesce(p_header ->> 'contact', '')), phone = btrim(coalesce(p_header ->> 'phone', '')), email = btrim(coalesce(p_header ->> 'email', '')),
           ext_ref = btrim(coalesce(p_header ->> 'ext_ref', '')), delivery_date = nullif(p_header ->> 'delivery_date', '')::date,
           payment_terms = btrim(coalesce(p_header ->> 'payment_terms', '')), delivery_terms = btrim(coalesce(p_header ->> 'delivery_terms', '')),
           remarks = btrim(coalesce(p_header ->> 'remarks', ''))
     where id = v_id;
    delete from sales_order_items where order_id = v_id;
  end if;
  v_line := 0;
  for x in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    insert into sales_order_items (order_id, line_no, product, grade, size, uom, qty, rate)
    values (v_id, v_line, btrim(x ->> 'product'), btrim(coalesce(x ->> 'grade', '')), btrim(coalesce(x ->> 'size', '')), coalesce(nullif(btrim(x ->> 'uom'), ''), 'PCS'),
            (x ->> 'qty')::numeric, (x ->> 'rate')::numeric);
  end loop;
  return v_id;
end $$;

-- Won quotation → Sales Order (a Draft, with the customer, terms and every line at its net rate). p_header = {ext_ref, delivery_date, remarks}
create or replace function create_sales_order_from_quotation(p_quotation_id bigint, p_header jsonb, p_user text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  q      sales_quotations;
  v_id   bigint;
  v_year int := extract(year from current_date)::int;
begin
  perform _require_user();
  perform _require_write('sales_orders');
  select * into q from sales_quotations where id = p_quotation_id for update;
  if not found then raise exception 'That quotation does not exist.'; end if;
  if q.status <> 'Won' then raise exception 'A sales order is created from a quotation the customer has accepted (this one is %).', q.status; end if;
  if exists (select 1 from sales_orders where quotation_id = p_quotation_id and status <> 'Cancelled') then
    raise exception 'A sales order has already been created from quotation %.', q.qt_no;
  end if;
  insert into sales_orders (so_no, quotation_id, customer, contact, phone, email, ext_ref, delivery_date, payment_terms, delivery_terms, remarks, created_by_name)
  values (_next_so_no(v_year), q.id, q.customer, q.contact, q.phone, q.email,
          btrim(coalesce(p_header ->> 'ext_ref', '')), nullif(p_header ->> 'delivery_date', '')::date, q.payment_terms, q.delivery_terms,
          btrim(coalesce(p_header ->> 'remarks', '')), p_user)
  returning id into v_id;
  insert into sales_order_items (order_id, line_no, product, grade, size, uom, qty, rate)
    select v_id, i.line_no, i.product, i.grade, i.size, i.uom, i.qty, round(i.rate * (1 - i.discount_pct / 100), 4)
      from sales_quotation_items i where i.quotation_id = q.id order by i.line_no;
  perform _qt_log(q.id, 'Sales order created', p_user, (select so_no from sales_orders where id = v_id));
  return v_id;
end $$;

-- Draft → Confirmed → In Production → Delivered; a note is needed to cancel
create or replace function set_sales_order_status(p_id bigint, p_status text, p_note text, p_user text) returns void
language plpgsql security definer set search_path = public as $$
declare o sales_orders;
begin
  perform _require_user();
  perform _require_write('sales_orders');
  select * into o from sales_orders where id = p_id for update;
  if not found then raise exception 'That sales order does not exist.'; end if;
  if p_status = 'Cancelled' then
    if o.status in ('Delivered', 'Cancelled') then raise exception 'Sales order % is already %.', o.so_no, o.status; end if;
    if coalesce(btrim(p_note), '') = '' then raise exception 'Enter the reason for cancelling.'; end if;
    update sales_orders set status = 'Cancelled', cancel_reason = btrim(p_note) where id = p_id;
  elsif (o.status, p_status) in (('Draft', 'Confirmed'), ('Confirmed', 'In Production'), ('In Production', 'Delivered')) then
    update sales_orders set status = p_status where id = p_id;
  else
    raise exception 'A % sales order cannot move to %.', o.status, p_status;
  end if;
end $$;

-- ============================================================ 5. the old pages' records are copied across (once)
do $$
declare r record; v_qid bigint; v_oid bigint; v_status text;
begin
  if to_regclass('public.sales_records') is null then return; end if;
  for r in select * from sales_records where kind = 'quotation' and not exists (select 1 from sales_quotations q where q.qt_no = sales_records.doc_no) order by id loop
    v_status := case r.status when 'Draft' then 'Draft' when 'Accepted' then 'Won' when 'Rejected' then 'Lost' else 'Sent' end;
    insert into sales_quotations (draft_no, qt_no, qt_date, customer, contact, phone, email, enquiry_no, payment_terms, delivery_terms, valid_until, remarks, status,
                                  approved_by, approved_at, sent_at, response_date, lost_reason, response_note, legacy, created_at)
    values (replace(r.doc_no, 'QT-', 'QL-'), r.doc_no, r.doc_date, r.party, r.contact, r.phone, r.email, r.ref_no, '', '', r.due_date, r.remarks, v_status,
            case when v_status <> 'Draft' then 'Earlier record' end, case when v_status <> 'Draft' then r.created_at end,
            case when v_status in ('Sent', 'Won', 'Lost') then r.created_at end,
            case when v_status in ('Won', 'Lost') then r.doc_date end,
            case when v_status = 'Lost' then 'Other' end, case when v_status = 'Lost' then 'Marked rejected on the earlier Sales Quotation page' end, true, r.created_at)
    returning id into v_qid;
    if r.qty is not null and r.qty > 0 then
      insert into sales_quotation_items (quotation_id, line_no, product, uom, qty, rate)
      values (v_qid, 1, coalesce(nullif(r.product, ''), 'Product'), 'PCS', r.qty, coalesce(r.rate, 0));
    end if;
    insert into sales_quotation_actions (quotation_id, action, actor, note, acted_at) values (v_qid, 'Copied from the earlier Sales Quotation page', 'System', null, r.created_at);
  end loop;
  for r in select * from sales_records where kind = 'sales_order' and not exists (select 1 from sales_orders o where o.so_no = sales_records.doc_no) order by id loop
    insert into sales_orders (so_no, so_date, quotation_id, customer, contact, phone, email, ext_ref, delivery_date, remarks, status, legacy, created_by_name, created_at)
    values (r.doc_no, r.doc_date, (select q.id from sales_quotations q where q.qt_no = r.ref_no and r.ref_no <> '' limit 1), r.party, r.contact, r.phone, r.email, r.ext_ref, r.due_date,
            r.remarks, case when r.status in ('Draft', 'Confirmed', 'Delivered', 'Cancelled') then r.status else 'Confirmed' end, true, 'Earlier record', r.created_at)
    on conflict do nothing
    returning id into v_oid;
    if v_oid is not null and r.qty is not null and r.qty > 0 then
      insert into sales_order_items (order_id, line_no, product, uom, qty, rate) values (v_oid, 1, coalesce(nullif(r.product, ''), 'Product'), 'PCS', r.qty, coalesce(r.rate, 0));
    end if;
    v_oid := null;
  end loop;
end $$;

-- the number counters carry on after the highest number copied from the earlier pages
insert into doc_counters (kind, year, last_value)
  select 'sales_quotation', substring(qt_no from 4 for 4)::int, max(substring(qt_no from 9)::int)
    from sales_quotations where qt_no ~ '^QT-[0-9]{4}-[0-9]+$' group by 1, 2
on conflict (kind, year) do update set last_value = greatest(doc_counters.last_value, excluded.last_value);
insert into doc_counters (kind, year, last_value)
  select 'sales_sales_order', substring(so_no from 4 for 4)::int, max(substring(so_no from 9)::int)
    from sales_orders where so_no ~ '^SO-[0-9]{4}-[0-9]+$' group by 1, 2
on conflict (kind, year) do update set last_value = greatest(doc_counters.last_value, excluded.last_value);

-- ============================================================ 6. grants
revoke all on v_sales_settings, v_sales_quotation_items, v_sales_quotations, v_sales_quotation_actions, v_sales_quotation_followups,
              v_customer_price_history, v_sales_orders, v_sales_order_items from anon, public;
grant select on v_sales_settings, v_sales_quotation_items, v_sales_quotations, v_sales_quotation_actions, v_sales_quotation_followups,
                v_customer_price_history, v_sales_orders, v_sales_order_items to authenticated;

revoke all on function save_sales_quotation(bigint, jsonb, jsonb, text), submit_sales_quotation(bigint, text), decide_sales_quotation(bigint, text, text, text),
                       send_sales_quotation(bigint, text), respond_sales_quotation(bigint, text, text, text, date, text),
                       add_quotation_followup(bigint, date, text, date, text), set_min_margin(numeric),
                       save_sales_order(bigint, jsonb, jsonb, text), create_sales_order_from_quotation(bigint, jsonb, text),
                       set_sales_order_status(bigint, text, text, text) from public, anon;
grant execute on function save_sales_quotation(bigint, jsonb, jsonb, text), submit_sales_quotation(bigint, text), decide_sales_quotation(bigint, text, text, text),
                          send_sales_quotation(bigint, text), respond_sales_quotation(bigint, text, text, text, date, text),
                          add_quotation_followup(bigint, date, text, date, text), set_min_margin(numeric),
                          save_sales_order(bigint, jsonb, jsonb, text), create_sales_order_from_quotation(bigint, jsonb, text),
                          set_sales_order_status(bigint, text, text, text) to authenticated;
revoke all on function _qt_margin(bigint), _qt_log(bigint, text, text, text), _next_qt_no(int), _next_so_no(int), trg_resource_role_rows(),
                       _new_page_level(app_role, boolean) from public, anon, authenticated;
-- the views call these two as the person reading them (like can_see_field), so signed-in users need to be able to run them
revoke all on function _sales_visible(), sales_min_margin() from public, anon;
grant execute on function _sales_visible(), sales_min_margin() to authenticated;
