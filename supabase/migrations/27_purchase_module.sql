-- 27_purchase_module.sql
-- Purchase cycle: Supplier master, PR, RFQ, Supplier Quotation, PO (multi-item, approval, release/lock, amendments), GRN link, performance views.
-- Follows existing conventions: snake_case, p_ args, next_doc_no(), SECURITY DEFINER RPCs, page_level() / _require_write().

-- ============ 0. ACCESS CONTROL REGISTRATION ============
INSERT INTO app_resources (key, label, section, sort, writable) VALUES
  ('procurement_po',    'Purchase Orders',    'Purchase & Procurement', 50, true),
  ('purchase_approvals', 'Purchase Approvals', 'Purchase & Procurement', 51, true),
  ('suppliers',          'Supplier Master',    'Purchase & Procurement', 52, true)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, section = EXCLUDED.section, writable = EXCLUDED.writable;

-- Helper to check write access cleanly
CREATE OR REPLACE FUNCTION has_write_access(p_res TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT page_level(p_res) = 'write';
$$;

-- ============ 1. SUPPLIER MASTER ============
CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL UNIQUE,
  gstin TEXT, pan TEXT, state TEXT,
  contact_person TEXT, phone TEXT, email TEXT, address TEXT,
  default_payment_terms TEXT,
  is_msme BOOLEAN DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill from free-text suppliers already used on inward lots in raw_material_lots
INSERT INTO suppliers (code, name)
SELECT 'SUP-' || LPAD((ROW_NUMBER() OVER (ORDER BY s))::TEXT, 4, '0'), s
FROM (SELECT DISTINCT TRIM(supplier) AS s FROM raw_material_lots WHERE supplier IS NOT NULL AND TRIM(supplier) <> '') x
ON CONFLICT (name) DO NOTHING;

-- ============ 2. PURCHASE REQUISITION ============
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id BIGSERIAL PRIMARY KEY,
  pr_no TEXT UNIQUE NOT NULL,
  pr_date DATE NOT NULL DEFAULT CURRENT_DATE,
  requested_by TEXT,
  department TEXT,
  urgency TEXT NOT NULL DEFAULT 'Normal' CHECK (urgency IN ('Normal','Urgent','Critical')),
  status TEXT NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft','Approval Pending','Approved','Rejected','Partially Ordered','Closed','Cancelled')),
  remarks TEXT,
  approved_by TEXT, approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS purchase_requisition_items (
  id BIGSERIAL PRIMARY KEY,
  pr_id BIGINT NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  item TEXT NOT NULL, material TEXT, grade TEXT, size TEXT,
  uom TEXT NOT NULL DEFAULT 'KG',
  qty NUMERIC NOT NULL CHECK (qty > 0),
  required_date DATE,
  ordered_qty NUMERIC NOT NULL DEFAULT 0,   -- rolled up from PO items
  UNIQUE (pr_id, line_no)
);

-- ============ 3. RFQ + SUPPLIER QUOTATION ============
CREATE TABLE IF NOT EXISTS rfqs (
  id BIGSERIAL PRIMARY KEY,
  rfq_no TEXT UNIQUE NOT NULL,
  rfq_date DATE NOT NULL DEFAULT CURRENT_DATE,
  pr_id BIGINT REFERENCES purchase_requisitions(id),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Quotes Received','Closed','Cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS rfq_suppliers (
  id BIGSERIAL PRIMARY KEY,
  rfq_id BIGINT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  sent_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,                 -- feeds "response time" metric
  UNIQUE (rfq_id, supplier_id)
);
CREATE TABLE IF NOT EXISTS supplier_quotations (
  id BIGSERIAL PRIMARY KEY,
  sq_no TEXT UNIQUE NOT NULL,
  sq_date DATE NOT NULL DEFAULT CURRENT_DATE,
  rfq_id BIGINT REFERENCES rfqs(id),
  pr_id BIGINT REFERENCES purchase_requisitions(id),
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  valid_till DATE, payment_terms TEXT, delivery_terms TEXT, lead_days INT,
  attachment_path TEXT,
  status TEXT NOT NULL DEFAULT 'Received' CHECK (status IN ('Received','Shortlisted','Selected','Rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS supplier_quotation_items (
  id BIGSERIAL PRIMARY KEY,
  sq_id BIGINT NOT NULL REFERENCES supplier_quotations(id) ON DELETE CASCADE,
  pr_item_id BIGINT REFERENCES purchase_requisition_items(id),
  item TEXT NOT NULL, material TEXT, grade TEXT, size TEXT,
  uom TEXT NOT NULL DEFAULT 'KG',
  qty NUMERIC NOT NULL CHECK (qty > 0),
  rate NUMERIC NOT NULL CHECK (rate >= 0)
);
-- Supplier Comparison = view (lowest rate per PR item, side by side)
CREATE OR REPLACE VIEW v_supplier_comparison AS
SELECT qi.pr_item_id, pri.pr_id, pri.item, pri.grade, pri.size, pri.qty AS required_qty,
       sq.id AS sq_id, sq.sq_no, s.name AS supplier, qi.rate, sq.lead_days, sq.payment_terms,
       RANK() OVER (PARTITION BY qi.pr_item_id ORDER BY qi.rate) AS rate_rank
FROM supplier_quotation_items qi
JOIN supplier_quotations sq ON sq.id = qi.sq_id
JOIN suppliers s ON s.id = sq.supplier_id
LEFT JOIN purchase_requisition_items pri ON pri.id = qi.pr_item_id
WHERE sq.status <> 'Rejected';

-- ============ 4. PURCHASE ORDER ============
CREATE TABLE IF NOT EXISTS purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  po_no TEXT UNIQUE NOT NULL,
  rev_no INT NOT NULL DEFAULT 0,
  po_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  pr_id BIGINT REFERENCES purchase_requisitions(id),
  sq_id BIGINT REFERENCES supplier_quotations(id),
  urgency TEXT NOT NULL DEFAULT 'Normal' CHECK (urgency IN ('Normal','Urgent','Critical')),
  delivery_date DATE,
  payment_terms TEXT, delivery_terms TEXT, other_terms TEXT,
  tax_type TEXT NOT NULL DEFAULT 'intra' CHECK (tax_type IN ('intra','inter')),  -- intra = CGST+SGST, inter = IGST
  taxable_amount NUMERIC NOT NULL DEFAULT 0,
  gst_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft','Approval Pending','Approved','Released','Sent to Supplier',
                      'Partially Received','Fully Received','Closed','Cancelled')),
  is_amendment BOOLEAN NOT NULL DEFAULT FALSE,
  attachments JSONB NOT NULL DEFAULT '[]',   -- [{name, path}] in storage bucket
  created_by TEXT, submitted_at TIMESTAMPTZ,
  approved_by TEXT, approved_at TIMESTAMPTZ,
  released_by TEXT, released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_urgency ON purchase_orders(urgency) WHERE urgency <> 'Normal';

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id BIGSERIAL PRIMARY KEY,
  po_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  pr_item_id BIGINT REFERENCES purchase_requisition_items(id),
  item TEXT NOT NULL, material TEXT, grade TEXT, size TEXT, hsn TEXT,
  uom TEXT NOT NULL DEFAULT 'KG',
  qty NUMERIC NOT NULL CHECK (qty > 0),
  rate NUMERIC NOT NULL CHECK (rate >= 0),
  gst_pct NUMERIC NOT NULL DEFAULT 18,
  delivery_date DATE,
  amount NUMERIC GENERATED ALWAYS AS (qty * rate) STORED,
  received_qty NUMERIC NOT NULL DEFAULT 0,   -- rolled up from GRN
  accepted_qty NUMERIC NOT NULL DEFAULT 0,   -- after QC
  rejected_qty NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (po_id, line_no)
);

CREATE TABLE IF NOT EXISTS po_approvals (          -- audit of every approval action
  id BIGSERIAL PRIMARY KEY,
  po_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  rev_no INT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('Submitted','Approved','Rejected','Released','Sent','Amendment Started','Cancelled')),
  actor TEXT, note TEXT, acted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS po_revisions (          -- full snapshot taken BEFORE each amendment
  id BIGSERIAL PRIMARY KEY,
  po_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  rev_no INT NOT NULL,
  reason TEXT NOT NULL,
  snapshot JSONB NOT NULL,                         -- header + items as they were
  amended_by TEXT, amended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (po_id, rev_no)
);
CREATE TABLE IF NOT EXISTS po_email_log (          -- PO Sent Date/Time/User/Supplier Email
  id BIGSERIAL PRIMARY KEY,
  po_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  rev_no INT NOT NULL,
  sent_to TEXT NOT NULL, sent_by TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_status TEXT NOT NULL DEFAULT 'Queued' CHECK (delivery_status IN ('Queued','Sent','Failed')),
  error TEXT
);

-- ============ 5. LOCK: no edits to content once past Draft ============
CREATE OR REPLACE FUNCTION trg_po_items_locked() RETURNS TRIGGER AS $$
DECLARE v_status TEXT; v_po BIGINT := COALESCE(NEW.po_id, OLD.po_id);
BEGIN
  SELECT status INTO v_status FROM purchase_orders WHERE id = v_po;
  -- received/accepted/rejected roll-ups are system fields; allow those updates only
  IF TG_OP = 'UPDATE' AND v_status NOT IN ('Draft')
     AND (NEW.qty, NEW.rate, NEW.gst_pct, NEW.item, NEW.grade, NEW.size)
         IS DISTINCT FROM (OLD.qty, OLD.rate, OLD.gst_pct, OLD.item, OLD.grade, OLD.size) THEN
    RAISE EXCEPTION 'PO is % and locked. Use PO Amendment to change items.', v_status;
  END IF;
  IF TG_OP IN ('INSERT','DELETE') AND v_status NOT IN ('Draft') THEN
    RAISE EXCEPTION 'PO is % and locked. Use PO Amendment to change items.', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS po_items_locked ON purchase_order_items;
CREATE TRIGGER po_items_locked BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION trg_po_items_locked();

-- ============ 6. RPCs ============
-- helper: recalc totals
CREATE OR REPLACE FUNCTION recalc_po(p_id BIGINT) RETURNS VOID AS $$
  UPDATE purchase_orders po SET
    taxable_amount = COALESCE(t.tx,0),
    gst_amount     = COALESCE(t.gst,0),
    total_amount   = COALESCE(t.tx,0) + COALESCE(t.gst,0)
  FROM (SELECT SUM(amount) tx, SUM(ROUND(amount * gst_pct / 100, 2)) gst
        FROM purchase_order_items WHERE po_id = p_id) t
  WHERE po.id = p_id;
$$ LANGUAGE sql;

-- create / update a Draft PO. p_items = [{pr_item_id,item,material,grade,size,hsn,uom,qty,rate,gst_pct,delivery_date}]
CREATE OR REPLACE FUNCTION save_po(p_id BIGINT, p_header JSONB, p_items JSONB, p_user TEXT)
RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT := p_id;
  v_status TEXT;
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_po_no TEXT;
  i INT := 0;
  it JSONB;
BEGIN
  IF NOT has_write_access('procurement_po') THEN
    RAISE EXCEPTION 'You do not have write access to Purchase Orders.';
  END IF;
  IF jsonb_array_length(COALESCE(p_items,'[]')) = 0 THEN
    RAISE EXCEPTION 'Add at least one item to the PO.';
  END IF;

  IF v_id IS NULL THEN
    v_po_no := 'PUR-' || v_year || '-' || LPAD(next_doc_no('PUR', v_year)::TEXT, 4, '0');
    INSERT INTO purchase_orders (po_no, supplier_id, pr_id, sq_id, urgency, delivery_date, payment_terms,
                                 delivery_terms, other_terms, tax_type, attachments, created_by)
    VALUES (v_po_no,
            (p_header->>'supplier_id')::BIGINT, NULLIF(p_header->>'pr_id','')::BIGINT, NULLIF(p_header->>'sq_id','')::BIGINT,
            COALESCE(p_header->>'urgency','Normal'), NULLIF(p_header->>'delivery_date','')::DATE,
            p_header->>'payment_terms', p_header->>'delivery_terms', p_header->>'other_terms',
            COALESCE(p_header->>'tax_type','intra'), COALESCE(p_header->'attachments','[]'), p_user)
    RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_status FROM purchase_orders WHERE id = v_id FOR UPDATE;
    IF v_status <> 'Draft' THEN RAISE EXCEPTION 'Only Draft POs can be edited (status: %).', v_status; END IF;
    UPDATE purchase_orders SET
      supplier_id = (p_header->>'supplier_id')::BIGINT,
      urgency = COALESCE(p_header->>'urgency','Normal'),
      delivery_date = NULLIF(p_header->>'delivery_date','')::DATE,
      payment_terms = p_header->>'payment_terms', delivery_terms = p_header->>'delivery_terms',
      other_terms = p_header->>'other_terms', tax_type = COALESCE(p_header->>'tax_type','intra'),
      attachments = COALESCE(p_header->'attachments','[]')
    WHERE id = v_id;
    DELETE FROM purchase_order_items WHERE po_id = v_id;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    i := i + 1;
    INSERT INTO purchase_order_items (po_id, line_no, pr_item_id, item, material, grade, size, hsn, uom, qty, rate, gst_pct, delivery_date)
    VALUES (v_id, i, NULLIF(it->>'pr_item_id','')::BIGINT, it->>'item', it->>'material', it->>'grade', it->>'size',
            it->>'hsn', COALESCE(it->>'uom','KG'), (it->>'qty')::NUMERIC, (it->>'rate')::NUMERIC,
            COALESCE((it->>'gst_pct')::NUMERIC,18), NULLIF(it->>'delivery_date','')::DATE);
  END LOOP;
  PERFORM recalc_po(v_id);
  RETURN v_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION submit_po(p_id BIGINT, p_user TEXT) RETURNS VOID AS $$
DECLARE r purchase_orders;
BEGIN
  IF NOT has_write_access('procurement_po') THEN RAISE EXCEPTION 'No write access to Purchase Orders.'; END IF;
  SELECT * INTO r FROM purchase_orders WHERE id = p_id FOR UPDATE;
  IF r.status <> 'Draft' THEN RAISE EXCEPTION 'Only Draft POs can be submitted.'; END IF;
  UPDATE purchase_orders SET status = 'Approval Pending', submitted_at = NOW() WHERE id = p_id;
  INSERT INTO po_approvals (po_id, rev_no, action, actor) VALUES (p_id, r.rev_no, 'Submitted', p_user);
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

-- approve / reject (Plant Head / Director -> give them write on 'purchase_approvals')
CREATE OR REPLACE FUNCTION decide_po(p_id BIGINT, p_approve BOOLEAN, p_note TEXT, p_user TEXT) RETURNS VOID AS $$
DECLARE r purchase_orders;
BEGIN
  IF NOT has_write_access('purchase_approvals') THEN RAISE EXCEPTION 'You are not authorised to approve Purchase Orders.'; END IF;
  SELECT * INTO r FROM purchase_orders WHERE id = p_id FOR UPDATE;
  IF r.status <> 'Approval Pending' THEN RAISE EXCEPTION 'PO is not pending approval.'; END IF;
  IF p_approve THEN
    UPDATE purchase_orders SET status = 'Approved', approved_by = p_user, approved_at = NOW() WHERE id = p_id;
  ELSE
    UPDATE purchase_orders SET status = 'Draft' WHERE id = p_id;   -- back to maker for correction
  END IF;
  INSERT INTO po_approvals (po_id, rev_no, action, actor, note)
  VALUES (p_id, r.rev_no, CASE WHEN p_approve THEN 'Approved' ELSE 'Rejected' END, p_user, p_note);
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION release_po(p_id BIGINT, p_user TEXT) RETURNS VOID AS $$
DECLARE r purchase_orders;
BEGIN
  IF NOT has_write_access('purchase_approvals') THEN RAISE EXCEPTION 'You are not authorised to release Purchase Orders.'; END IF;
  SELECT * INTO r FROM purchase_orders WHERE id = p_id FOR UPDATE;
  IF r.status <> 'Approved' THEN RAISE EXCEPTION 'Only Approved POs can be released.'; END IF;
  UPDATE purchase_orders SET status = 'Released', released_by = p_user, released_at = NOW() WHERE id = p_id;
  INSERT INTO po_approvals (po_id, rev_no, action, actor) VALUES (p_id, r.rev_no, 'Released', p_user);
  -- roll PR ordered_qty
  UPDATE purchase_requisition_items pri SET ordered_qty = pri.ordered_qty + poi.qty
  FROM purchase_order_items poi WHERE poi.po_id = p_id AND poi.pr_item_id = pri.id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

-- called by the email Edge Function after it sends (or fails)
CREATE OR REPLACE FUNCTION mark_po_sent(p_id BIGINT, p_email TEXT, p_user TEXT, p_ok BOOLEAN, p_error TEXT DEFAULT NULL) RETURNS VOID AS $$
DECLARE r purchase_orders;
BEGIN
  SELECT * INTO r FROM purchase_orders WHERE id = p_id FOR UPDATE;
  IF r.status NOT IN ('Released','Sent to Supplier') THEN RAISE EXCEPTION 'Release the PO before sending.'; END IF;
  INSERT INTO po_email_log (po_id, rev_no, sent_to, sent_by, delivery_status, error)
  VALUES (p_id, r.rev_no, p_email, p_user, CASE WHEN p_ok THEN 'Sent' ELSE 'Failed' END, p_error);
  IF p_ok THEN
    UPDATE purchase_orders SET status = 'Sent to Supplier' WHERE id = p_id;
    INSERT INTO po_approvals (po_id, rev_no, action, actor, note) VALUES (p_id, r.rev_no, 'Sent', p_user, p_email);
  END IF;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

-- amendment: snapshot current version, bump revision, reopen as Draft -> must be re-approved and re-released
CREATE OR REPLACE FUNCTION amend_po(p_id BIGINT, p_reason TEXT, p_user TEXT) RETURNS INT AS $$
DECLARE r purchase_orders; v_snap JSONB;
BEGIN
  IF NOT has_write_access('procurement_po') THEN RAISE EXCEPTION 'No write access to Purchase Orders.'; END IF;
  IF COALESCE(TRIM(p_reason),'') = '' THEN RAISE EXCEPTION 'Amendment reason is required.'; END IF;
  SELECT * INTO r FROM purchase_orders WHERE id = p_id FOR UPDATE;
  IF r.status NOT IN ('Released','Sent to Supplier','Partially Received') THEN
    RAISE EXCEPTION 'Only released POs can be amended (status: %).', r.status;
  END IF;
  SELECT to_jsonb(r) || jsonb_build_object('items',
         (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no) FROM purchase_order_items i WHERE i.po_id = p_id))
    INTO v_snap;
  INSERT INTO po_revisions (po_id, rev_no, reason, snapshot, amended_by) VALUES (p_id, r.rev_no, p_reason, v_snap, p_user);
  -- release the PR quantity again; it is re-added when the revision is released
  UPDATE purchase_requisition_items pri SET ordered_qty = GREATEST(pri.ordered_qty - poi.qty, 0)
  FROM purchase_order_items poi WHERE poi.po_id = p_id AND poi.pr_item_id = pri.id;
  UPDATE purchase_orders SET status = 'Draft', rev_no = rev_no + 1, is_amendment = TRUE WHERE id = p_id;
  INSERT INTO po_approvals (po_id, rev_no, action, actor, note) VALUES (p_id, r.rev_no + 1, 'Amendment Started', p_user, p_reason);
  RETURN r.rev_no + 1;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============ 7. GRN / QC / INVOICE LINKS ============
ALTER TABLE raw_material_lots
  ADD COLUMN IF NOT EXISTS po_id BIGINT REFERENCES purchase_orders(id),
  ADD COLUMN IF NOT EXISTS po_item_id BIGINT REFERENCES purchase_order_items(id),
  ADD COLUMN IF NOT EXISTS supplier_id BIGINT REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS qc_status TEXT DEFAULT 'Pending' CHECK (qc_status IN ('Pending','Accepted','Rejected','Partial')),
  ADD COLUMN IF NOT EXISTS accepted_weight NUMERIC,
  ADD COLUMN IF NOT EXISTS rejected_weight NUMERIC;
-- NOTE: PO qty is in KG for bars; inward qty is bar count. Receipts roll up by `inward_weight` (KG) into purchase_order_items.received_qty.

-- keep PO item roll-ups + PO status in sync with GRN
CREATE OR REPLACE FUNCTION trg_inward_rollup() RETURNS TRIGGER AS $$
DECLARE v_po BIGINT := COALESCE(NEW.po_id, OLD.po_id); v_item BIGINT := COALESCE(NEW.po_item_id, OLD.po_item_id);
BEGIN
  IF v_item IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  UPDATE purchase_order_items i SET
    received_qty = COALESCE((SELECT SUM(inward_weight) FROM raw_material_lots WHERE po_item_id = v_item), 0),
    accepted_qty = COALESCE((SELECT SUM(COALESCE(accepted_weight, CASE WHEN qc_status = 'Accepted' THEN inward_weight END)) FROM raw_material_lots WHERE po_item_id = v_item), 0),
    rejected_qty = COALESCE((SELECT SUM(COALESCE(rejected_weight, CASE WHEN qc_status = 'Rejected' THEN inward_weight END)) FROM raw_material_lots WHERE po_item_id = v_item), 0)
  WHERE i.id = v_item;
  UPDATE purchase_orders po SET status = CASE
      WHEN (SELECT bool_and(received_qty >= qty) FROM purchase_order_items WHERE po_id = v_po) THEN 'Fully Received'
      WHEN (SELECT SUM(received_qty) FROM purchase_order_items WHERE po_id = v_po) > 0 THEN 'Partially Received'
      ELSE po.status END
  WHERE po.id = v_po AND po.status IN ('Released','Sent to Supplier','Partially Received','Fully Received');
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inward_rollup ON raw_material_lots;
CREATE TRIGGER inward_rollup AFTER INSERT OR UPDATE OR DELETE ON raw_material_lots
  FOR EACH ROW EXECUTE FUNCTION trg_inward_rollup();

-- Purchase invoice + payment (phase 2 placeholders so pending balances can trace to the PO)
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id BIGSERIAL PRIMARY KEY,
  pinv_no TEXT UNIQUE NOT NULL, supplier_inv_no TEXT NOT NULL,
  inv_date DATE NOT NULL, supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  po_id BIGINT REFERENCES purchase_orders(id),
  taxable_amount NUMERIC NOT NULL, gst_amount NUMERIC NOT NULL DEFAULT 0, total_amount NUMERIC NOT NULL,
  due_date DATE, status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid','Partially Paid','Paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS purchase_payments (
  id BIGSERIAL PRIMARY KEY,
  pay_no TEXT UNIQUE NOT NULL, pay_date DATE NOT NULL,
  pinv_id BIGINT NOT NULL REFERENCES purchase_invoices(id),
  amount NUMERIC NOT NULL CHECK (amount > 0), mode TEXT, reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ 8. DASHBOARD + REPORT VIEWS ============
CREATE OR REPLACE VIEW v_po_register AS
SELECT po.*, s.name AS supplier_name, s.email AS supplier_email,
  (SELECT COALESCE(SUM(qty),0) FROM purchase_order_items WHERE po_id = po.id) AS ordered_qty,
  (SELECT COALESCE(SUM(received_qty),0) FROM purchase_order_items WHERE po_id = po.id) AS received_qty,
  (SELECT COALESCE(SUM(GREATEST(qty - received_qty,0)),0) FROM purchase_order_items WHERE po_id = po.id) AS pending_qty,
  (po.delivery_date IS NOT NULL AND po.delivery_date < CURRENT_DATE
     AND po.status IN ('Released','Sent to Supplier','Partially Received')) AS is_overdue
FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id;

-- Urgent/Critical open POs for the separate dashboard panel
CREATE OR REPLACE VIEW v_po_urgent AS
SELECT * FROM v_po_register
WHERE urgency IN ('Urgent','Critical') AND status NOT IN ('Fully Received','Closed','Cancelled');

CREATE OR REPLACE VIEW v_po_pending_balance AS      -- PO -> GRN -> Invoice -> Payment trace
SELECT po.id AS po_id, po.po_no, s.name AS supplier, po.total_amount,
  COALESCE((SELECT SUM(total_amount) FROM purchase_invoices WHERE po_id = po.id),0) AS invoiced,
  COALESCE((SELECT SUM(p.amount) FROM purchase_payments p JOIN purchase_invoices i ON i.id = p.pinv_id WHERE i.po_id = po.id),0) AS paid
FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
WHERE po.status NOT IN ('Draft','Cancelled');

CREATE OR REPLACE VIEW v_supplier_performance AS
WITH items AS (
  SELECT po.supplier_id,
    SUM(i.received_qty) rec, SUM(i.accepted_qty) acc, SUM(i.rejected_qty) rej, SUM(GREATEST(i.qty - i.received_qty,0)) short
  FROM purchase_orders po JOIN purchase_order_items i ON i.po_id = po.id
  WHERE po.status NOT IN ('Draft','Approval Pending','Approved','Cancelled') GROUP BY po.supplier_id
), ontime AS (
  SELECT po.supplier_id,
    COUNT(*) FILTER (WHERE g.first_in <= po.delivery_date)::NUMERIC / NULLIF(COUNT(*),0) * 100 AS on_time_pct
  FROM purchase_orders po
  JOIN LATERAL (SELECT MIN(inward_date) first_in FROM raw_material_lots WHERE po_id = po.id) g ON g.first_in IS NOT NULL
  WHERE po.delivery_date IS NOT NULL GROUP BY po.supplier_id
), resp AS (
  SELECT supplier_id, AVG(EXTRACT(EPOCH FROM (responded_at - sent_at)) / 3600) AS avg_response_hrs
  FROM rfq_suppliers WHERE responded_at IS NOT NULL AND sent_at IS NOT NULL GROUP BY supplier_id
), price AS (   -- price competitiveness: avg of (PO rate / lowest quoted rate for same item); 1.00 = best
  SELECT po.supplier_id, AVG(i.rate / NULLIF(m.min_rate,0)) AS price_index
  FROM purchase_orders po JOIN purchase_order_items i ON i.po_id = po.id
  JOIN LATERAL (SELECT MIN(rate) min_rate FROM purchase_order_items i2 JOIN purchase_orders p2 ON p2.id = i2.po_id
                WHERE i2.item = i.item AND COALESCE(i2.grade,'') = COALESCE(i.grade,'') AND p2.status NOT IN ('Draft','Cancelled')) m ON TRUE
  GROUP BY po.supplier_id
)
SELECT s.id AS supplier_id, s.name,
  ROUND(COALESCE(ot.on_time_pct, 0), 1) AS on_time_delivery_pct,
  ROUND(COALESCE(it.acc / NULLIF(it.rec,0) * 100, 0), 1) AS quality_acceptance_pct,
  ROUND(COALESCE(it.rej / NULLIF(it.rec,0) * 100, 0), 1) AS rejection_pct,
  ROUND(COALESCE(pr.price_index, 1), 2) AS price_index,
  COALESCE(it.short, 0) AS quantity_shortage,
  ROUND(COALESCE(rs.avg_response_hrs, 0), 1) AS avg_response_hrs,
  s.default_payment_terms AS payment_terms
FROM suppliers s
LEFT JOIN items it ON it.supplier_id = s.id LEFT JOIN ontime ot ON ot.supplier_id = s.id
LEFT JOIN resp rs ON rs.supplier_id = s.id LEFT JOIN price pr ON pr.supplier_id = s.id;
