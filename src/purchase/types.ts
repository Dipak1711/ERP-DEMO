export type Urgency = 'Normal' | 'Urgent' | 'Critical';

export type POStatus =
  | 'Draft'
  | 'Approval Pending'
  | 'Approved'
  | 'Released'
  | 'Sent to Supplier'
  | 'Partially Received'
  | 'Fully Received'
  | 'Closed'
  | 'Cancelled';

export type TaxType = 'intra' | 'inter';

export interface POAttachment {
  name: string;
  path: string;
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
  gstin?: string;
  pan?: string;
  state?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  defaultPaymentTerms?: string;
  isMsme: boolean;
  active: boolean;
  createdAt: string;
}

export interface PurchaseOrderItem {
  id: number;
  poId: number;
  lineNo: number;
  prItemId?: number | null;
  item: string;
  material?: string;
  grade?: string;
  size?: string;
  hsn?: string;
  uom: string;
  qty: number;
  rate: number;
  gstPct: number;
  deliveryDate?: string | null;
  amount: number;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
}

export interface POApproval {
  id: number;
  poId: number;
  revNo: number;
  action: 'Submitted' | 'Approved' | 'Rejected' | 'Released' | 'Sent' | 'Amendment Started' | 'Cancelled';
  actor?: string;
  note?: string;
  actedAt: string;
}

export interface PORevision {
  id: number;
  poId: number;
  revNo: number;
  reason: string;
  snapshot: Record<string, unknown>;
  amendedBy?: string;
  amendedAt: string;
}

export interface POEmailLog {
  id: number;
  poId: number;
  revNo: number;
  sentTo: string;
  sentBy?: string;
  sentAt: string;
  deliveryStatus: 'Queued' | 'Sent' | 'Failed';
  error?: string;
  cc?: string;
  note?: string;
  /** po-pdfs path of the PDF that was attached (po/<po no>/rev<n>.pdf) */
  pdfPath?: string;
}

export interface PurchaseOrder {
  id: number;
  poNo: string;
  revNo: number;
  poDate: string;
  supplierId: number;
  supplierName?: string;
  supplierEmail?: string;
  prId?: number | null;
  sqId?: number | null;
  urgency: Urgency;
  deliveryDate?: string | null;
  paymentTerms?: string;
  deliveryTerms?: string;
  otherTerms?: string;
  taxType: TaxType;
  taxableAmount: number;
  gstAmount: number;
  totalAmount: number;
  status: POStatus;
  isAmendment: boolean;
  attachments: POAttachment[];
  createdBy?: string;
  submittedAt?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  releasedBy?: string | null;
  releasedAt?: string | null;
  createdAt: string;
  // view rollups
  orderedQty?: number;
  receivedQty?: number;
  pendingQty?: number;
  isOverdue?: boolean;
}

export interface PODetail extends PurchaseOrder {
  items: PurchaseOrderItem[];
  approvals: POApproval[];
  revisions: PORevision[];
  emailLogs: POEmailLog[];
}

export interface SavePOHeaderInput {
  supplier_id: number;
  pr_id?: number | null;
  sq_id?: number | null;
  urgency: Urgency;
  delivery_date?: string | null;
  payment_terms?: string;
  delivery_terms?: string;
  other_terms?: string;
  tax_type: TaxType;
  attachments: POAttachment[];
}

export interface SavePOItemInput {
  pr_item_id?: number | null;
  item: string;
  material?: string;
  grade?: string;
  size?: string;
  hsn?: string;
  uom: string;
  qty: number;
  rate: number;
  gst_pct: number;
  delivery_date?: string | null;
}

// ============================================================
// Purchase Requisition (PR)
// ============================================================
export type PRStatus =
  | 'Draft'
  | 'Approval Pending'
  | 'Approved'
  | 'Rejected'
  | 'Partially Ordered'
  | 'Closed'
  | 'Cancelled';

export interface PurchaseRequisitionItem {
  id: number;
  prId: number;
  lineNo: number;
  item: string;
  material?: string;
  grade?: string;
  size?: string;
  uom: string;
  qty: number;
  requiredDate?: string | null;
  orderedQty: number;
  remainingQty?: number;
}

export interface PurchaseRequisition {
  id: number;
  prNo: string;
  prDate: string;
  requestedBy?: string;
  department?: string;
  urgency: Urgency;
  status: PRStatus;
  remarks?: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  items?: PurchaseRequisitionItem[];
  itemCount?: number;
  totalQty?: number;
  totalOrderedQty?: number;
}

export interface PRDetail extends PurchaseRequisition {
  items: PurchaseRequisitionItem[];
}

export interface SavePRHeaderInput {
  pr_date?: string;
  requested_by?: string;
  department?: string;
  urgency: Urgency;
  remarks?: string;
}

export interface SavePRItemInput {
  item: string;
  material?: string;
  grade?: string;
  size?: string;
  uom: string;
  qty: number;
  required_date?: string | null;
}

// ============================================================
// Request for Quotation (RFQ)
// ============================================================
export type RFQStatus = 'Open' | 'Quotes Received' | 'Closed' | 'Cancelled';

export interface RFQSupplier {
  id: number;
  rfqId: number;
  supplierId: number;
  supplierName?: string;
  supplierEmail?: string;
  supplierPhone?: string;
  sentAt?: string | null;
  respondedAt?: string | null;
}

export interface RFQ {
  id: number;
  rfqNo: string;
  rfqDate: string;
  prId?: number | null;
  prNo?: string;
  dueDate?: string | null;
  status: RFQStatus;
  createdAt: string;
  suppliers?: RFQSupplier[];
  supplierCount?: number;
  responseCount?: number;
}

export interface RFQDetail extends RFQ {
  suppliers: RFQSupplier[];
  pr?: PurchaseRequisition | null;
}

export interface SaveRFQInput {
  pr_id?: number | null;
  due_date?: string | null;
  supplier_ids: number[];
}

// ============================================================
// Supplier Quotation (SQ)
// ============================================================
export type SQStatus = 'Received' | 'Shortlisted' | 'Selected' | 'Rejected';

export interface SupplierQuotationItem {
  id: number;
  sqId: number;
  prItemId?: number | null;
  item: string;
  material?: string;
  grade?: string;
  size?: string;
  uom: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface SupplierQuotation {
  id: number;
  sqNo: string;
  sqDate: string;
  rfqId?: number | null;
  rfqNo?: string;
  prId?: number | null;
  prNo?: string;
  supplierId: number;
  supplierName?: string;
  validTill?: string | null;
  paymentTerms?: string;
  deliveryTerms?: string;
  leadDays?: number | null;
  attachmentPath?: string | null;
  status: SQStatus;
  createdAt: string;
  totalAmount?: number;
  itemCount?: number;
  items?: SupplierQuotationItem[];
}

export interface SQDetail extends SupplierQuotation {
  items: SupplierQuotationItem[];
}

export interface SaveSQHeaderInput {
  supplier_id: number;
  rfq_id?: number | null;
  pr_id?: number | null;
  sq_date?: string;
  valid_till?: string | null;
  payment_terms?: string;
  delivery_terms?: string;
  lead_days?: number | null;
  attachment_path?: string | null;
  status?: SQStatus;
}

export interface SaveSQItemInput {
  pr_item_id?: number | null;
  item: string;
  material?: string;
  grade?: string;
  size?: string;
  uom: string;
  qty: number;
  rate: number;
}

// ============================================================
// Supplier Comparison Matrix
// ============================================================
export interface SupplierComparisonRow {
  prItemId: number;
  prId: number;
  item: string;
  grade?: string;
  size?: string;
  requiredQty: number;
  sqId: number;
  sqNo: string;
  supplier: string;
  rate: number;
  leadDays?: number | null;
  paymentTerms?: string;
  rateRank: number;
}

export interface ComparisonSupplierSummary {
  supplierId?: number;
  supplierName: string;
  sqId: number;
  sqNo: string;
  status: SQStatus;
  leadDays?: number | null;
  paymentTerms?: string;
  deliveryTerms?: string;
  totalAmount: number;
  itemsQuotedCount: number;
}

export interface ComparisonMatrix {
  prId?: number;
  prNo?: string;
  rfqId?: number;
  rfqNo?: string;
  suppliers: ComparisonSupplierSummary[];
  items: {
    prItemId: number;
    item: string;
    grade?: string;
    size?: string;
    requiredQty: number;
    uom: string;
    lowestRate?: number;
    quotes: Record<number, { rate: number; sqId: number; isLowest: boolean }>;
  }[];
}

// ---------------------------------------------------------------------------------------------
// Phase 3: goods receipt, supplier performance and reports
// ---------------------------------------------------------------------------------------------
/** One raw-material inward lot booked against a PO line (view v_po_receipts). */
export interface POReceipt {
  poId: number;
  poItemId: number;
  lotId: string;
  inwardDate: string;
  heatNo?: string;
  invoiceNo?: string;
  material?: string;
  grade?: string;
  od?: number;
  inwardQty: number;
  inwardWeight: number;
  qcStatus: 'Pending' | 'Accepted' | 'Rejected' | 'Partial';
  acceptedWeight: number | null;
  rejectedWeight: number | null;
}

/** One supplier's scorecard (view v_supplier_performance). A null percentage means there is nothing to judge yet. */
export interface SupplierPerformance {
  supplierId: number;
  name: string;
  code: string;
  poCount: number;
  totalPurchaseValue: number;
  onTimePct: number | null;
  onTimeCount: number;
  lateCount: number;
  qualityPct: number | null;
  rejectionPct: number | null;
  priceIndex: number | null;
  shortage: number;
  shortageBase: number;
  avgResponseHrs: number | null;
  paymentTerms?: string;
}

/** A PO that can still receive material, for the inward form's "Against Purchase Order" picker. */
export interface ReceivablePO {
  id: number;
  poNo: string;
  supplierId: number;
  supplierName: string;
  status: string;
  deliveryDate?: string | null;
  items: ReceivablePOItem[];
}

export interface ReceivablePOItem {
  id: number;
  lineNo: number;
  item: string;
  material?: string;
  grade?: string;
  size?: string;
  uom: string;
  qty: number;
  receivedQty: number;
  rate: number;
}

// ---------------------------------------------------------------------------------------------
// Phase 4: purchase invoices, payments, payables, PO e-mail
// ---------------------------------------------------------------------------------------------
/** UI hint only: how far an invoice rate may differ from the PO rate before a variance note is needed. The database decides (invoice_rate_tolerance_pct(), migration 33). */
export const INVOICE_RATE_TOLERANCE_PCT = 2;

export type InvoiceStatus = 'Draft' | 'Posted' | 'Cancelled';
export type PayStatus = 'Unpaid' | 'Partially Paid' | 'Paid';

/** One row of v_purchase_invoice_register. */
export interface PurchaseInvoice {
  invoiceId: number;
  pinvNo: string;
  supplierInvNo: string;
  invDate: string;
  dueDate?: string | null;
  supplierId: number;
  supplierName: string;
  poId?: number | null;
  poNo?: string;
  status: InvoiceStatus;
  payStatus: PayStatus;
  taxableAmount: number;
  gstAmount: number;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  isOverdue: boolean;
  daysOverdue: number;
  varianceNote?: string;
  createdBy?: string;
  postedBy?: string;
  postedAt?: string;
}

export interface InvoiceLine {
  id: number;
  lineNo: number;
  poItemId: number;
  item: string;
  qty: number;
  rate: number;
  gstPct: number;
  amount: number;
}

/** A PO line with its three-way match figures (ordered / received / accepted / invoiced). */
export interface POInvoiceLine {
  poItemId: number;
  lineNo: number;
  item: string;
  uom: string;
  ordered: number;
  received: number;
  accepted: number;
  /** on POSTED invoices */
  invoiced: number;
  poRate: number;
  gstPct: number;
  /** true when incoming QC has been recorded on the line (then the accepted quantity is the basis) */
  qcRecorded: boolean;
  /** what can still be invoiced: basis (accepted if QC recorded, else received; ordered for non-KG lines) less what is invoiced */
  billable: number;
}

export interface PurchasePayment {
  paymentId: number;
  payNo: string;
  payDate: string;
  amount: number;
  mode: string;
  reference?: string;
  notes?: string;
  createdBy?: string;
  invoiceId: number;
  pinvNo: string;
  supplierInvNo: string;
  supplierName: string;
  poNo?: string;
}

export interface InvoiceDetail extends PurchaseInvoice {
  taxType: TaxType;
  items: InvoiceLine[];
  payments: PurchasePayment[];
  match: POInvoiceLine[];
  cancelReason?: string;
}

export interface SupplierPayable {
  supplierId: number;
  supplierName: string;
  supplierCode: string;
  openInvoices: number;
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  overdueAmount: number;
  b0to30: number;
  b31to60: number;
  b61to90: number;
  b90plus: number;
}

export interface POBalance {
  poId: number;
  totalAmount: number;
  invoiced: number;
  paid: number;
  balanceToInvoice: number;
  payable: number;
}

export interface InvoiceablePO {
  id: number;
  poNo: string;
  supplierId: number;
  supplierName: string;
  status: string;
  paymentTerms?: string;
}

export interface SendPOResult {
  ok: boolean;
  status?: string;
  sentTo?: string;
  sentAt?: string;
  logId?: number;
  pdfPath?: string;
}
