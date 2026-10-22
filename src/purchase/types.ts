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
