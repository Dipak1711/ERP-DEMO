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
