-- ============================================================
-- 20 · Sales & Orders pages in Access Control
-- ============================================================
-- Registers the new sidebar pages (Sales Dashboard, Sales Quotation, Lead Management, Inquiry, Purchase Order, Final Order,
-- Task Assignment) so the Director / Plant Head can set each role's level on them in Settings → Access Control.
-- The dashboard is view-only; the other five pages are editable (see 21).
-- Safe to run on a database that already has 01–19, and safe to run again (it also fixes labels and order).

insert into app_resources (key, label, section, sort, writable) values
  ('sales_dashboard', 'Sales Dashboard',  'Sales & Orders', 11, false),
  ('sales_quotation', 'Sales Quotation',  'Sales & Orders', 12, true),
  ('leads',           'Lead Management',  'Sales & Orders', 13, true),
  ('inquiries',       'Inquiry',          'Sales & Orders', 14, true),
  ('purchase_orders', 'Purchase Order',   'Sales & Orders', 15, true),
  ('final_orders',    'Final Order',      'Sales & Orders', 16, true),
  ('task_assignment', 'Task Assignment',  'Sales & Orders', 17, true)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;

insert into role_page_access (role, resource, level)
  select r, a.key, _default_level(r, a.key)
    from unnest(array['accounts', 'qc', 'operator', 'viewer']::app_role[]) r
    cross join app_resources a
   where a.section = 'Sales & Orders'
on conflict (role, resource) do nothing;
