-- 31_purchase_rls.sql
-- Run AFTER 27, 28 and 30. Safe to run more than once.
-- Locks every purchase table and view:
--   * nobody who is not signed in can read anything
--   * a signed-in person can read a table only if their role has not hidden the matching page
--   * changes go through the save_/submit_/decide_ functions, which check Write access (suppliers is the one table the Supplier Master page writes directly)

DO $$
DECLARE t TEXT; cond TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'suppliers','purchase_requisitions','purchase_requisition_items','rfqs','rfq_suppliers',
    'supplier_quotations','supplier_quotation_items','purchase_orders','purchase_order_items',
    'po_approvals','po_revisions','po_email_log','purchase_invoices','purchase_payments'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    cond := CASE WHEN t = 'suppliers'
      THEN $c$page_level('suppliers') <> 'hidden' OR page_level('procurement_po') <> 'hidden' OR page_level('purchase_requisitions') <> 'hidden' OR page_level('rfq') <> 'hidden' OR page_level('supplier_quotations') <> 'hidden'$c$
      ELSE $c$page_level('procurement_po') <> 'hidden' OR page_level('purchase_approvals') <> 'hidden' OR page_level('purchase_dashboard') <> 'hidden'$c$ END;
    -- the six tables from migration 30 keep the policy that file made (it also lets their own pages read them)
    IF t NOT IN ('purchase_requisitions','purchase_requisition_items','rfqs','rfq_suppliers','supplier_quotations','supplier_quotation_items') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
      EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_active_user() AND (%s))', t || '_read', t, cond);
    END IF;
    EXECUTE format('REVOKE ALL ON %I FROM anon, PUBLIC', t);
    EXECUTE format('GRANT SELECT ON %I TO authenticated', t);
  END LOOP;
END $$;

-- Supplier Master saves straight to the table, so it needs write policies.
GRANT INSERT, UPDATE ON suppliers TO authenticated;
DROP POLICY IF EXISTS suppliers_insert ON suppliers;
DROP POLICY IF EXISTS suppliers_update ON suppliers;
CREATE POLICY suppliers_insert ON suppliers FOR INSERT TO authenticated WITH CHECK (has_write_access('suppliers'));
CREATE POLICY suppliers_update ON suppliers FOR UPDATE TO authenticated
  USING (has_write_access('suppliers')) WITH CHECK (has_write_access('suppliers'));

-- Views follow the caller's rights and are closed to anyone not signed in.
ALTER VIEW v_supplier_comparison  SET (security_invoker = on);
ALTER VIEW v_po_register          SET (security_invoker = on);
ALTER VIEW v_po_urgent            SET (security_invoker = on);
ALTER VIEW v_po_pending_balance   SET (security_invoker = on);
ALTER VIEW v_supplier_performance SET (security_invoker = on);
REVOKE ALL ON v_supplier_comparison, v_po_register, v_po_urgent, v_po_pending_balance, v_supplier_performance FROM anon, PUBLIC;
GRANT SELECT ON v_supplier_comparison, v_po_register, v_po_urgent, v_po_pending_balance, v_supplier_performance TO authenticated;

-- Triggers fired by normal users must still be able to update the PO tables.
ALTER FUNCTION trg_inward_rollup()   SECURITY DEFINER SET search_path = public;
ALTER FUNCTION trg_po_items_locked() SECURITY DEFINER SET search_path = public;

-- Functions from migration 27: signed-in users only, never anonymous.
REVOKE EXECUTE ON FUNCTION submit_po(BIGINT, TEXT)                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION decide_po(BIGINT, BOOLEAN, TEXT, TEXT)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION submit_po(BIGINT, TEXT)                 TO authenticated;
GRANT  EXECUTE ON FUNCTION decide_po(BIGINT, BOOLEAN, TEXT, TEXT)  TO authenticated;
-- mark_po_sent is for the email Edge Function (service role) only.
REVOKE EXECUTE ON FUNCTION mark_po_sent(BIGINT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
