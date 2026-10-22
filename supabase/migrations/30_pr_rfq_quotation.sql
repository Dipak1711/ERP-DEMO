-- ============================================================
-- 30 · Upstream Purchase Flow: PR, RFQ, Supplier Quotation, Comparison & PO Linking
-- ============================================================
-- Extends the purchase cycle with upstream procurement stages:
-- 1. Purchase Requisition (PR) with approval & quantity tracking
-- 2. Request for Quotation (RFQ) with supplier invitations and response tracking
-- 3. Supplier Quotations (SQ) linked to PR/RFQ items with selection workflow
-- 4. PR quantity enforcement and recomputation on PO release & amendment
-- 5. Safe PO item updates preserving received quantities
-- 6. Granular RLS policies on all upstream purchase tables

-- ============ 0. ACCESS CONTROL REGISTRATION ============
INSERT INTO app_resources (key, label, section, sort, writable) VALUES
  ('purchase_requisitions', 'Purchase Requisitions',      'Purchase & Procurement', 23, true),
  ('rfq',                   'Requests for Quotation (RFQ)', 'Purchase & Procurement', 24, true),
  ('supplier_quotations',   'Supplier Quotations',        'Purchase & Procurement', 25, true)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, section = EXCLUDED.section, sort = EXCLUDED.sort, writable = EXCLUDED.writable;

-- ============ 1. RECOMPUTE PR STATUS HELPER ============
CREATE OR REPLACE FUNCTION _recompute_pr_status(p_pr_id BIGINT) RETURNS VOID AS $$
DECLARE
  v_total_items INT;
  v_fully_ordered INT;
  v_any_ordered INT;
  v_cur_status TEXT;
BEGIN
  IF p_pr_id IS NULL THEN RETURN; END IF;
  SELECT status INTO v_cur_status FROM purchase_requisitions WHERE id = p_pr_id FOR UPDATE;
  IF v_cur_status IN ('Cancelled', 'Draft', 'Approval Pending', 'Rejected') THEN
    RETURN;
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE ordered_qty >= qty),
         COUNT(*) FILTER (WHERE ordered_qty > 0)
  INTO v_total_items, v_fully_ordered, v_any_ordered
  FROM purchase_requisition_items
  WHERE pr_id = p_pr_id;

  IF v_total_items = 0 THEN
    RETURN;
  ELSIF v_fully_ordered = v_total_items THEN
    UPDATE purchase_requisitions SET status = 'Closed' WHERE id = p_pr_id;
  ELSIF v_any_ordered > 0 THEN
    UPDATE purchase_requisitions SET status = 'Partially Ordered' WHERE id = p_pr_id;
  ELSE
    UPDATE purchase_requisitions SET status = 'Approved' WHERE id = p_pr_id;
  END IF;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============ 2. PURCHASE REQUISITION RPCS ============

-- create / update a Draft PR. p_items = [{item,material,grade,size,uom,qty,required_date}]
CREATE OR REPLACE FUNCTION save_pr(p_id BIGINT, p_header JSONB, p_items JSONB, p_user TEXT)
RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT := p_id;
  v_status TEXT;
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_pr_no TEXT;
  i INT := 0;
  it JSONB;
BEGIN
  IF NOT has_write_access('purchase_requisitions') THEN
    RAISE EXCEPTION 'You do not have write access to Purchase Requisitions.';
  END IF;
  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Add at least one item to the Requisition.';
  END IF;

  IF v_id IS NULL THEN
    v_pr_no := 'PR-' || v_year || '-' || LPAD(next_doc_no('PR', v_year)::TEXT, 4, '0');
    INSERT INTO purchase_requisitions (
      pr_no, pr_date, requested_by, department, urgency, status, remarks
    ) VALUES (
      v_pr_no,
      COALESCE(NULLIF(p_header->>'pr_date','')::DATE, CURRENT_DATE),
      COALESCE(p_header->>'requested_by', p_user),
      p_header->>'department',
      COALESCE(p_header->>'urgency', 'Normal'),
      'Draft',
      p_header->>'remarks'
    ) RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_status FROM purchase_requisitions WHERE id = v_id FOR UPDATE;
    IF v_status <> 'Draft' THEN
      RAISE EXCEPTION 'Only Draft Requisitions can be edited (current status: %).', v_status;
    END IF;

    UPDATE purchase_requisitions SET
      pr_date = COALESCE(NULLIF(p_header->>'pr_date','')::DATE, pr_date),
      requested_by = COALESCE(p_header->>'requested_by', requested_by),
      department = p_header->>'department',
      urgency = COALESCE(p_header->>'urgency', 'Normal'),
      remarks = p_header->>'remarks'
    WHERE id = v_id;

    DELETE FROM purchase_requisition_items WHERE pr_id = v_id;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    i := i + 1;
    INSERT INTO purchase_requisition_items (
      pr_id, line_no, item, material, grade, size, uom, qty, required_date, ordered_qty
    ) VALUES (
      v_id,
      i,
      it->>'item',
      it->>'material',
      it->>'grade',
      it->>'size',
      COALESCE(it->>'uom', 'KG'),
      (it->>'qty')::NUMERIC,
      NULLIF(it->>'required_date', '')::DATE,
      0
    );
  END LOOP;

  RETURN v_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Submit Draft PR for approval
CREATE OR REPLACE FUNCTION submit_pr(p_id BIGINT, p_user TEXT) RETURNS VOID AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NOT has_write_access('purchase_requisitions') THEN
    RAISE EXCEPTION 'You do not have write access to Purchase Requisitions.';
  END IF;
  SELECT status INTO v_status FROM purchase_requisitions WHERE id = p_id FOR UPDATE;
  IF v_status <> 'Draft' THEN
    RAISE EXCEPTION 'Only Draft Requisitions can be submitted (status: %).', v_status;
  END IF;

  UPDATE purchase_requisitions
  SET status = 'Approval Pending'
  WHERE id = p_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Approve / Reject PR (requires write on 'purchase_approvals')
CREATE OR REPLACE FUNCTION decide_pr(p_id BIGINT, p_approve BOOLEAN, p_note TEXT, p_user TEXT) RETURNS VOID AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NOT has_write_access('purchase_approvals') THEN
    RAISE EXCEPTION 'You are not authorised to approve Purchase Requisitions.';
  END IF;
  SELECT status INTO v_status FROM purchase_requisitions WHERE id = p_id FOR UPDATE;
  IF v_status <> 'Approval Pending' THEN
    RAISE EXCEPTION 'Requisition is not pending approval (status: %).', v_status;
  END IF;

  IF p_approve THEN
    UPDATE purchase_requisitions
    SET status = 'Approved', approved_by = p_user, approved_at = NOW()
    WHERE id = p_id;
  ELSE
    -- Rejected: send back to Draft for corrections
    UPDATE purchase_requisitions
    SET status = 'Draft',
        remarks = COALESCE(remarks || E'\n', '') || 'Rejected by ' || p_user || ': ' || COALESCE(p_note, 'No reason specified')
    WHERE id = p_id;
  END IF;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Cancel PR (only allowed if no PO exists against it)
CREATE OR REPLACE FUNCTION cancel_pr(p_id BIGINT, p_reason TEXT, p_user TEXT) RETURNS VOID AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NOT has_write_access('purchase_requisitions') THEN
    RAISE EXCEPTION 'You do not have write access to Purchase Requisitions.';
  END IF;
  SELECT status INTO v_status FROM purchase_requisitions WHERE id = p_id FOR UPDATE;
  IF v_status IN ('Cancelled', 'Closed') THEN
    RAISE EXCEPTION 'Requisition is already %.', v_status;
  END IF;

  IF EXISTS (SELECT 1 FROM purchase_orders WHERE pr_id = p_id AND status <> 'Cancelled') THEN
    RAISE EXCEPTION 'Cannot cancel Requisition: active Purchase Orders exist referencing this PR.';
  END IF;

  UPDATE purchase_requisitions
  SET status = 'Cancelled',
      remarks = COALESCE(remarks || E'\n', '') || 'Cancelled by ' || p_user || ': ' || COALESCE(p_reason, '')
  WHERE id = p_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============ 3. RFQ RPCS ============

-- Create or update RFQ from an approved PR with invited suppliers
CREATE OR REPLACE FUNCTION save_rfq(
  p_id BIGINT,
  p_pr_id BIGINT,
  p_due_date DATE,
  p_supplier_ids BIGINT[],
  p_user TEXT
) RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT := p_id;
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_rfq_no TEXT;
  v_pr_status TEXT;
  s_id BIGINT;
BEGIN
  IF NOT has_write_access('rfq') THEN
    RAISE EXCEPTION 'You do not have write access to RFQs.';
  END IF;

  IF p_pr_id IS NOT NULL THEN
    SELECT status INTO v_pr_status FROM purchase_requisitions WHERE id = p_pr_id;
    IF v_pr_status NOT IN ('Approved', 'Partially Ordered') THEN
      RAISE EXCEPTION 'RFQs can only be created from Approved Requisitions (current status: %).', v_pr_status;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    v_rfq_no := 'RFQ-' || v_year || '-' || LPAD(next_doc_no('RFQ', v_year)::TEXT, 4, '0');
    INSERT INTO rfqs (rfq_no, rfq_date, pr_id, due_date, status)
    VALUES (v_rfq_no, CURRENT_DATE, p_pr_id, p_due_date, 'Open')
    RETURNING id INTO v_id;
  ELSE
    UPDATE rfqs
    SET due_date = p_due_date
    WHERE id = v_id AND status IN ('Open', 'Quotes Received');
  END IF;

  IF p_supplier_ids IS NOT NULL THEN
    FOREACH s_id IN ARRAY p_supplier_ids LOOP
      INSERT INTO rfq_suppliers (rfq_id, supplier_id)
      VALUES (v_id, s_id)
      ON CONFLICT (rfq_id, supplier_id) DO NOTHING;
    END LOOP;
  END IF;

  RETURN v_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Mark an RFQ as sent to an invited supplier
CREATE OR REPLACE FUNCTION mark_rfq_sent(p_rfq_id BIGINT, p_supplier_id BIGINT, p_user TEXT) RETURNS VOID AS $$
BEGIN
  IF NOT has_write_access('rfq') THEN
    RAISE EXCEPTION 'You do not have write access to RFQs.';
  END IF;

  UPDATE rfq_suppliers
  SET sent_at = COALESCE(sent_at, NOW())
  WHERE rfq_id = p_rfq_id AND supplier_id = p_supplier_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============ 4. SUPPLIER QUOTATION RPCS ============

-- Save a supplier quotation against a PR or RFQ.
-- p_items = [{pr_item_id, item, material, grade, size, uom, qty, rate}]
CREATE OR REPLACE FUNCTION save_sq(p_id BIGINT, p_header JSONB, p_items JSONB, p_user TEXT)
RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT := p_id;
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_sq_no TEXT;
  v_rfq_id BIGINT;
  v_pr_id BIGINT;
  v_supplier_id BIGINT;
  it JSONB;
BEGIN
  IF NOT has_write_access('supplier_quotations') THEN
    RAISE EXCEPTION 'You do not have write access to Supplier Quotations.';
  END IF;
  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Quotation must have at least one line item.';
  END IF;

  v_supplier_id := (p_header->>'supplier_id')::BIGINT;
  v_rfq_id := NULLIF(p_header->>'rfq_id', '')::BIGINT;
  v_pr_id := NULLIF(p_header->>'pr_id', '')::BIGINT;

  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier is required.';
  END IF;

  IF v_id IS NULL THEN
    v_sq_no := 'SQ-' || v_year || '-' || LPAD(next_doc_no('SQ', v_year)::TEXT, 4, '0');
    INSERT INTO supplier_quotations (
      sq_no, sq_date, rfq_id, pr_id, supplier_id, valid_till,
      payment_terms, delivery_terms, lead_days, attachment_path, status
    ) VALUES (
      v_sq_no,
      COALESCE(NULLIF(p_header->>'sq_date','')::DATE, CURRENT_DATE),
      v_rfq_id,
      v_pr_id,
      v_supplier_id,
      NULLIF(p_header->>'valid_till', '')::DATE,
      p_header->>'payment_terms',
      p_header->>'delivery_terms',
      NULLIF(p_header->>'lead_days', '')::INT,
      p_header->>'attachment_path',
      COALESCE(p_header->>'status', 'Received')
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE supplier_quotations SET
      valid_till = NULLIF(p_header->>'valid_till', '')::DATE,
      payment_terms = p_header->>'payment_terms',
      delivery_terms = p_header->>'delivery_terms',
      lead_days = NULLIF(p_header->>'lead_days', '')::INT,
      attachment_path = p_header->>'attachment_path'
    WHERE id = v_id;

    DELETE FROM supplier_quotation_items WHERE sq_id = v_id;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO supplier_quotation_items (
      sq_id, pr_item_id, item, material, grade, size, uom, qty, rate
    ) VALUES (
      v_id,
      NULLIF(it->>'pr_item_id', '')::BIGINT,
      it->>'item',
      it->>'material',
      it->>'grade',
      it->>'size',
      COALESCE(it->>'uom', 'KG'),
      (it->>'qty')::NUMERIC,
      (it->>'rate')::NUMERIC
    );
  END LOOP;

  -- If linked to an RFQ, update rfq_suppliers and RFQ status
  IF v_rfq_id IS NOT NULL THEN
    UPDATE rfq_suppliers
    SET responded_at = COALESCE(responded_at, NOW())
    WHERE rfq_id = v_rfq_id AND supplier_id = v_supplier_id;

    UPDATE rfqs
    SET status = 'Quotes Received'
    WHERE id = v_rfq_id AND status = 'Open';
  END IF;

  RETURN v_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Set quotation status (Shortlisted / Selected / Rejected / Received)
CREATE OR REPLACE FUNCTION set_sq_status(p_id BIGINT, p_status TEXT, p_user TEXT) RETURNS VOID AS $$
BEGIN
  IF NOT has_write_access('supplier_quotations') THEN
    RAISE EXCEPTION 'You do not have write access to Supplier Quotations.';
  END IF;
  IF p_status NOT IN ('Received', 'Shortlisted', 'Selected', 'Rejected') THEN
    RAISE EXCEPTION 'Invalid quotation status: %.', p_status;
  END IF;

  UPDATE supplier_quotations
  SET status = p_status
  WHERE id = p_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============ 5. PO QUANTITY VALIDATION & STATUS RECOMPUTATION ============

-- Replace release_po to enforce PR quantities and recompute PR status
CREATE OR REPLACE FUNCTION release_po(p_id BIGINT, p_user TEXT) RETURNS VOID AS $$
DECLARE
  r purchase_orders;
  v_over RECORD;
  v_pr_rec RECORD;
BEGIN
  IF NOT has_write_access('purchase_approvals') THEN
    RAISE EXCEPTION 'You are not authorised to release Purchase Orders.';
  END IF;
  SELECT * INTO r FROM purchase_orders WHERE id = p_id FOR UPDATE;
  IF r.status <> 'Approved' THEN
    RAISE EXCEPTION 'Only Approved POs can be released (status: %).', r.status;
  END IF;

  -- 1. PR Quantity Enforcement
  SELECT pri.item, pri.qty AS requested, pri.ordered_qty, poi.qty AS po_qty
  INTO v_over
  FROM purchase_order_items poi
  JOIN purchase_requisition_items pri ON pri.id = poi.pr_item_id
  WHERE poi.po_id = p_id AND (pri.ordered_qty + poi.qty > pri.qty)
  LIMIT 1;

  IF v_over.item IS NOT NULL THEN
    RAISE EXCEPTION 'PO quantity for item "%" (%) exceeds remaining PR quantity (requested %, already ordered %).',
      v_over.item, v_over.po_qty, v_over.requested, v_over.ordered_qty;
  END IF;

  -- 2. Release PO
  UPDATE purchase_orders
  SET status = 'Released', released_by = p_user, released_at = NOW()
  WHERE id = p_id;

  INSERT INTO po_approvals (po_id, rev_no, action, actor)
  VALUES (p_id, r.rev_no, 'Released', p_user);

  -- 3. Roll PR ordered_qty
  UPDATE purchase_requisition_items pri
  SET ordered_qty = pri.ordered_qty + poi.qty
  FROM purchase_order_items poi
  WHERE poi.po_id = p_id AND poi.pr_item_id = pri.id;

  -- 4. Recompute linked PR statuses
  FOR v_pr_rec IN
    SELECT DISTINCT pri.pr_id
    FROM purchase_order_items poi
    JOIN purchase_requisition_items pri ON pri.id = poi.pr_item_id
    WHERE poi.po_id = p_id
  LOOP
    PERFORM _recompute_pr_status(v_pr_rec.pr_id);
  END LOOP;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Replace amend_po to roll back ordered_qty and recompute PR statuses
CREATE OR REPLACE FUNCTION amend_po(p_id BIGINT, p_reason TEXT, p_user TEXT) RETURNS INT AS $$
DECLARE
  r purchase_orders;
  v_snap JSONB;
  v_pr_rec RECORD;
BEGIN
  IF NOT has_write_access('procurement_po') THEN
    RAISE EXCEPTION 'No write access to Purchase Orders.';
  END IF;
  IF COALESCE(TRIM(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Amendment reason is required.';
  END IF;

  SELECT * INTO r FROM purchase_orders WHERE id = p_id FOR UPDATE;
  IF r.status NOT IN ('Released', 'Sent to Supplier', 'Partially Received') THEN
    RAISE EXCEPTION 'Only released POs can be amended (status: %).', r.status;
  END IF;

  SELECT to_jsonb(r) || jsonb_build_object('items',
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no) FROM purchase_order_items i WHERE i.po_id = p_id))
  INTO v_snap;

  INSERT INTO po_revisions (po_id, rev_no, reason, snapshot, amended_by)
  VALUES (p_id, r.rev_no, p_reason, v_snap, p_user);

  -- Roll back PR ordered quantity
  UPDATE purchase_requisition_items pri
  SET ordered_qty = GREATEST(pri.ordered_qty - poi.qty, 0)
  FROM purchase_order_items poi
  WHERE poi.po_id = p_id AND poi.pr_item_id = pri.id;

  -- Recompute linked PR statuses
  FOR v_pr_rec IN
    SELECT DISTINCT pri.pr_id
    FROM purchase_order_items poi
    JOIN purchase_requisition_items pri ON pri.id = poi.pr_item_id
    WHERE poi.po_id = p_id
  LOOP
    PERFORM _recompute_pr_status(v_pr_rec.pr_id);
  END LOOP;

  UPDATE purchase_orders
  SET status = 'Draft', rev_no = rev_no + 1, is_amendment = TRUE
  WHERE id = p_id;

  INSERT INTO po_approvals (po_id, rev_no, action, actor, note)
  VALUES (p_id, r.rev_no + 1, 'Amendment Started', p_user, p_reason);

  RETURN r.rev_no + 1;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============ 6. SAFE SAVE_PO WITH LINE PRESERVATION ============

-- Replace save_po: preserves lines and checks that lines with received_qty are never deleted
CREATE OR REPLACE FUNCTION save_po(p_id BIGINT, p_header JSONB, p_items JSONB, p_user TEXT)
RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT := p_id;
  v_status TEXT;
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_po_no TEXT;
  i INT := 0;
  it JSONB;
  v_incoming_lines INT[] := '{}';
  v_line INT;
  v_del RECORD;
BEGIN
  IF NOT has_write_access('procurement_po') THEN
    RAISE EXCEPTION 'You do not have write access to Purchase Orders.';
  END IF;
  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Add at least one item to the PO.';
  END IF;

  IF v_id IS NULL THEN
    v_po_no := 'PUR-' || v_year || '-' || LPAD(next_doc_no('PUR', v_year)::TEXT, 4, '0');
    INSERT INTO purchase_orders (
      po_no, supplier_id, pr_id, sq_id, urgency, delivery_date, payment_terms,
      delivery_terms, other_terms, tax_type, attachments, created_by
    ) VALUES (
      v_po_no,
      (p_header->>'supplier_id')::BIGINT,
      NULLIF(p_header->>'pr_id', '')::BIGINT,
      NULLIF(p_header->>'sq_id', '')::BIGINT,
      COALESCE(p_header->>'urgency', 'Normal'),
      NULLIF(p_header->>'delivery_date', '')::DATE,
      p_header->>'payment_terms',
      p_header->>'delivery_terms',
      p_header->>'other_terms',
      COALESCE(p_header->>'tax_type', 'intra'),
      COALESCE(p_header->'attachments', '[]'::jsonb),
      p_user
    ) RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_status FROM purchase_orders WHERE id = v_id FOR UPDATE;
    IF v_status <> 'Draft' THEN
      RAISE EXCEPTION 'Only Draft POs can be edited (current status: %).', v_status;
    END IF;

    UPDATE purchase_orders SET
      supplier_id = (p_header->>'supplier_id')::BIGINT,
      pr_id = COALESCE(NULLIF(p_header->>'pr_id', '')::BIGINT, pr_id),
      sq_id = COALESCE(NULLIF(p_header->>'sq_id', '')::BIGINT, sq_id),
      urgency = COALESCE(p_header->>'urgency', 'Normal'),
      delivery_date = NULLIF(p_header->>'delivery_date', '')::DATE,
      payment_terms = p_header->>'payment_terms',
      delivery_terms = p_header->>'delivery_terms',
      other_terms = p_header->>'other_terms',
      tax_type = COALESCE(p_header->>'tax_type', 'intra'),
      attachments = COALESCE(p_header->'attachments', '[]'::jsonb)
    WHERE id = v_id;
  END IF;

  -- Check existing lines that are being removed:
  -- Collect incoming line numbers
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    i := i + 1;
    v_incoming_lines := array_append(v_incoming_lines, i);
  END LOOP;

  -- Ensure no line with received goods is removed
  SELECT line_no, received_qty, item INTO v_del
  FROM purchase_order_items
  WHERE po_id = v_id AND line_no <> ALL(v_incoming_lines) AND received_qty > 0
  LIMIT 1;

  IF v_del.line_no IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot remove item line % ("%"): % units have already been received.',
      v_del.line_no, v_del.item, v_del.received_qty;
  END IF;

  -- Delete rows no longer present (safe because received_qty is 0)
  DELETE FROM purchase_order_items
  WHERE po_id = v_id AND line_no <> ALL(v_incoming_lines);

  -- Upsert items by line_no
  i := 0;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    i := i + 1;
    INSERT INTO purchase_order_items (
      po_id, line_no, pr_item_id, item, material, grade, size, hsn, uom, qty, rate, gst_pct, delivery_date
    ) VALUES (
      v_id,
      i,
      NULLIF(it->>'pr_item_id', '')::BIGINT,
      it->>'item',
      it->>'material',
      it->>'grade',
      it->>'size',
      it->>'hsn',
      COALESCE(it->>'uom', 'KG'),
      (it->>'qty')::NUMERIC,
      (it->>'rate')::NUMERIC,
      COALESCE((it->>'gst_pct')::NUMERIC, 18),
      NULLIF(it->>'delivery_date', '')::DATE
    )
    ON CONFLICT (po_id, line_no) DO UPDATE SET
      pr_item_id = EXCLUDED.pr_item_id,
      item = EXCLUDED.item,
      material = EXCLUDED.material,
      grade = EXCLUDED.grade,
      size = EXCLUDED.size,
      hsn = EXCLUDED.hsn,
      uom = EXCLUDED.uom,
      qty = EXCLUDED.qty,
      rate = EXCLUDED.rate,
      gst_pct = EXCLUDED.gst_pct,
      delivery_date = EXCLUDED.delivery_date;
  END LOOP;

  PERFORM recalc_po(v_id);
  RETURN v_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============ 7. EXECUTE PERMISSIONS ============
REVOKE EXECUTE ON FUNCTION
  save_pr(BIGINT, JSONB, JSONB, TEXT),
  submit_pr(BIGINT, TEXT),
  decide_pr(BIGINT, BOOLEAN, TEXT, TEXT),
  cancel_pr(BIGINT, TEXT, TEXT),
  save_rfq(BIGINT, BIGINT, DATE, BIGINT[], TEXT),
  mark_rfq_sent(BIGINT, BIGINT, TEXT),
  save_sq(BIGINT, JSONB, JSONB, TEXT),
  set_sq_status(BIGINT, TEXT, TEXT),
  release_po(BIGINT, TEXT),
  save_po(BIGINT, JSONB, JSONB, TEXT),
  amend_po(BIGINT, TEXT, TEXT),
  _recompute_pr_status(BIGINT)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  save_pr(BIGINT, JSONB, JSONB, TEXT),
  submit_pr(BIGINT, TEXT),
  decide_pr(BIGINT, BOOLEAN, TEXT, TEXT),
  cancel_pr(BIGINT, TEXT, TEXT),
  save_rfq(BIGINT, BIGINT, DATE, BIGINT[], TEXT),
  mark_rfq_sent(BIGINT, BIGINT, TEXT),
  save_sq(BIGINT, JSONB, JSONB, TEXT),
  set_sq_status(BIGINT, TEXT, TEXT),
  release_po(BIGINT, TEXT),
  save_po(BIGINT, JSONB, JSONB, TEXT),
  amend_po(BIGINT, TEXT, TEXT),
  _recompute_pr_status(BIGINT)
TO authenticated;

-- ============ 8. ROW-LEVEL SECURITY (RLS) ============

ALTER TABLE purchase_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requisition_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_quotation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_requisitions_read ON purchase_requisitions;
CREATE POLICY purchase_requisitions_read ON purchase_requisitions FOR SELECT TO authenticated
  USING (
    public.is_active_user() AND (
      public.page_level('purchase_requisitions') <> 'hidden' OR
      public.page_level('procurement_po') <> 'hidden' OR
      public.page_level('purchase_approvals') <> 'hidden'
    )
  );

DROP POLICY IF EXISTS purchase_requisition_items_read ON purchase_requisition_items;
CREATE POLICY purchase_requisition_items_read ON purchase_requisition_items FOR SELECT TO authenticated
  USING (
    public.is_active_user() AND (
      public.page_level('purchase_requisitions') <> 'hidden' OR
      public.page_level('procurement_po') <> 'hidden' OR
      public.page_level('purchase_approvals') <> 'hidden'
    )
  );

DROP POLICY IF EXISTS rfqs_read ON rfqs;
CREATE POLICY rfqs_read ON rfqs FOR SELECT TO authenticated
  USING (
    public.is_active_user() AND (
      public.page_level('rfq') <> 'hidden' OR
      public.page_level('procurement_po') <> 'hidden' OR
      public.page_level('purchase_approvals') <> 'hidden'
    )
  );

DROP POLICY IF EXISTS rfq_suppliers_read ON rfq_suppliers;
CREATE POLICY rfq_suppliers_read ON rfq_suppliers FOR SELECT TO authenticated
  USING (
    public.is_active_user() AND (
      public.page_level('rfq') <> 'hidden' OR
      public.page_level('procurement_po') <> 'hidden' OR
      public.page_level('purchase_approvals') <> 'hidden'
    )
  );

DROP POLICY IF EXISTS supplier_quotations_read ON supplier_quotations;
CREATE POLICY supplier_quotations_read ON supplier_quotations FOR SELECT TO authenticated
  USING (
    public.is_active_user() AND (
      public.page_level('supplier_quotations') <> 'hidden' OR
      public.page_level('procurement_po') <> 'hidden' OR
      public.page_level('purchase_approvals') <> 'hidden'
    )
  );

DROP POLICY IF EXISTS supplier_quotation_items_read ON supplier_quotation_items;
CREATE POLICY supplier_quotation_items_read ON supplier_quotation_items FOR SELECT TO authenticated
  USING (
    public.is_active_user() AND (
      public.page_level('supplier_quotations') <> 'hidden' OR
      public.page_level('procurement_po') <> 'hidden' OR
      public.page_level('purchase_approvals') <> 'hidden'
    )
  );

ALTER VIEW v_supplier_comparison SET (security_invoker = on);

GRANT SELECT ON
  purchase_requisitions,
  purchase_requisition_items,
  rfqs,
  rfq_suppliers,
  supplier_quotations,
  supplier_quotation_items,
  v_supplier_comparison
TO authenticated;

REVOKE ALL ON
  purchase_requisitions,
  purchase_requisition_items,
  rfqs,
  rfq_suppliers,
  supplier_quotations,
  supplier_quotation_items
FROM anon, PUBLIC;
