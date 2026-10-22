import type {
  Supplier,
  PurchaseOrder,
  PurchaseOrderItem,
  POApproval,
  PORevision,
  POEmailLog,
  POAttachment,
  Urgency,
  POStatus,
  TaxType,
} from './types';

type Row = Record<string, unknown>;

const s = (v: unknown): string => (v == null ? '' : String(v));
const optS = (v: unknown): string | undefined => (v == null || v === '' ? undefined : String(v));
const n = (v: unknown, fallback = 0): number => {
  if (v == null || v === '') return fallback;
  const num = Number(v);
  return Number.isNaN(num) ? fallback : num;
};
const optN = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const num = Number(v);
  return Number.isNaN(num) ? null : num;
};
const b = (v: unknown): boolean => !!v;

export function mapSupplier(r: Row): Supplier {
  return {
    id: Number(r.id),
    code: s(r.code),
    name: s(r.name),
    gstin: optS(r.gstin),
    pan: optS(r.pan),
    state: optS(r.state),
    contactPerson: optS(r.contact_person),
    phone: optS(r.phone),
    email: optS(r.email),
    address: optS(r.address),
    defaultPaymentTerms: optS(r.default_payment_terms),
    isMsme: b(r.is_msme),
    active: r.active !== false,
    createdAt: s(r.created_at),
  };
}

export function mapPOItem(r: Row): PurchaseOrderItem {
  return {
    id: Number(r.id),
    poId: Number(r.po_id),
    lineNo: n(r.line_no),
    prItemId: optN(r.pr_item_id),
    item: s(r.item),
    material: optS(r.material),
    grade: optS(r.grade),
    size: optS(r.size),
    hsn: optS(r.hsn),
    uom: s(r.uom) || 'KG',
    qty: n(r.qty),
    rate: n(r.rate),
    gstPct: n(r.gst_pct, 18),
    deliveryDate: optS(r.delivery_date),
    amount: n(r.amount, n(r.qty) * n(r.rate)),
    receivedQty: n(r.received_qty),
    acceptedQty: n(r.accepted_qty),
    rejectedQty: n(r.rejected_qty),
  };
}

export function mapPOApproval(r: Row): POApproval {
  return {
    id: Number(r.id),
    poId: Number(r.po_id),
    revNo: n(r.rev_no),
    action: s(r.action) as POApproval['action'],
    actor: optS(r.actor),
    note: optS(r.note),
    actedAt: s(r.acted_at),
  };
}

export function mapPORevision(r: Row): PORevision {
  return {
    id: Number(r.id),
    poId: Number(r.po_id),
    revNo: n(r.rev_no),
    reason: s(r.reason),
    snapshot: (r.snapshot as Record<string, unknown>) || {},
    amendedBy: optS(r.amended_by),
    amendedAt: s(r.amended_at),
  };
}

export function mapPOEmailLog(r: Row): POEmailLog {
  return {
    id: Number(r.id),
    poId: Number(r.po_id),
    revNo: n(r.rev_no),
    sentTo: s(r.sent_to),
    sentBy: optS(r.sent_by),
    sentAt: s(r.sent_at),
    deliveryStatus: (s(r.delivery_status) || 'Queued') as POEmailLog['deliveryStatus'],
    error: optS(r.error),
    cc: optS(r.cc),
    note: optS(r.note),
    pdfPath: optS(r.pdf_path),
  };
}

export function mapPurchaseOrder(r: Row): PurchaseOrder {
  let attachments: POAttachment[] = [];
  if (Array.isArray(r.attachments)) {
    attachments = r.attachments as POAttachment[];
  } else if (typeof r.attachments === 'string') {
    try {
      attachments = JSON.parse(r.attachments);
    } catch {
      attachments = [];
    }
  }

  return {
    id: Number(r.id),
    poNo: s(r.po_no),
    revNo: n(r.rev_no),
    poDate: s(r.po_date),
    supplierId: Number(r.supplier_id),
    supplierName: optS(r.supplier_name),
    supplierEmail: optS(r.supplier_email),
    prId: optN(r.pr_id),
    sqId: optN(r.sq_id),
    urgency: (s(r.urgency) || 'Normal') as Urgency,
    deliveryDate: optS(r.delivery_date),
    paymentTerms: optS(r.payment_terms),
    deliveryTerms: optS(r.delivery_terms),
    otherTerms: optS(r.other_terms),
    taxType: (s(r.tax_type) || 'intra') as TaxType,
    taxableAmount: n(r.taxable_amount),
    gstAmount: n(r.gst_amount),
    totalAmount: n(r.total_amount),
    status: (s(r.status) || 'Draft') as POStatus,
    isAmendment: b(r.is_amendment),
    attachments,
    createdBy: optS(r.created_by),
    submittedAt: optS(r.submitted_at),
    approvedBy: optS(r.approved_by),
    approvedAt: optS(r.approved_at),
    releasedBy: optS(r.released_by),
    releasedAt: optS(r.released_at),
    createdAt: s(r.created_at),
    orderedQty: optN(r.ordered_qty) ?? undefined,
    receivedQty: optN(r.received_qty) ?? undefined,
    pendingQty: optN(r.pending_qty) ?? undefined,
    isOverdue: r.is_overdue != null ? b(r.is_overdue) : undefined,
  };
}

// -------------------------------------------------- Purchase Requisition ---
export function mapPRItem(r: Row): import('./types').PurchaseRequisitionItem {
  const qty = n(r.qty);
  const orderedQty = n(r.ordered_qty);
  return {
    id: Number(r.id),
    prId: Number(r.pr_id),
    lineNo: n(r.line_no),
    item: s(r.item),
    material: optS(r.material),
    grade: optS(r.grade),
    size: optS(r.size),
    uom: s(r.uom) || 'KG',
    qty,
    requiredDate: optS(r.required_date),
    orderedQty,
    remainingQty: Math.max(0, qty - orderedQty),
  };
}

export function mapPurchaseRequisition(r: Row): import('./types').PurchaseRequisition {
  return {
    id: Number(r.id),
    prNo: s(r.pr_no),
    prDate: s(r.pr_date),
    requestedBy: optS(r.requested_by),
    department: optS(r.department),
    urgency: (s(r.urgency) || 'Normal') as Urgency,
    status: (s(r.status) || 'Draft') as import('./types').PRStatus,
    remarks: optS(r.remarks),
    approvedBy: optS(r.approved_by),
    approvedAt: optS(r.approved_at),
    createdAt: s(r.created_at),
    itemCount: optN(r.item_count) ?? undefined,
    totalQty: optN(r.total_qty) ?? undefined,
    totalOrderedQty: optN(r.total_ordered_qty) ?? undefined,
  };
}

// ------------------------------------------------------------------ RFQ ---
export function mapRFQSupplier(r: Row): import('./types').RFQSupplier {
  return {
    id: Number(r.id),
    rfqId: Number(r.rfq_id),
    supplierId: Number(r.supplier_id),
    supplierName: optS(r.supplier_name),
    supplierEmail: optS(r.supplier_email),
    supplierPhone: optS(r.supplier_phone),
    sentAt: optS(r.sent_at),
    respondedAt: optS(r.responded_at),
  };
}

export function mapRFQ(r: Row): import('./types').RFQ {
  return {
    id: Number(r.id),
    rfqNo: s(r.rfq_no),
    rfqDate: s(r.rfq_date),
    prId: optN(r.pr_id),
    prNo: optS(r.pr_no),
    dueDate: optS(r.due_date),
    status: (s(r.status) || 'Open') as import('./types').RFQStatus,
    createdAt: s(r.created_at),
    supplierCount: optN(r.supplier_count) ?? undefined,
    responseCount: optN(r.response_count) ?? undefined,
  };
}

// --------------------------------------------------- Supplier Quotation ---
export function mapSQItem(r: Row): import('./types').SupplierQuotationItem {
  const qty = n(r.qty);
  const rate = n(r.rate);
  return {
    id: Number(r.id),
    sqId: Number(r.sq_id),
    prItemId: optN(r.pr_item_id),
    item: s(r.item),
    material: optS(r.material),
    grade: optS(r.grade),
    size: optS(r.size),
    uom: s(r.uom) || 'KG',
    qty,
    rate,
    amount: n(r.amount, qty * rate),
  };
}

export function mapSupplierQuotation(r: Row): import('./types').SupplierQuotation {
  return {
    id: Number(r.id),
    sqNo: s(r.sq_no),
    sqDate: s(r.sq_date),
    rfqId: optN(r.rfq_id),
    rfqNo: optS(r.rfq_no),
    prId: optN(r.pr_id),
    prNo: optS(r.pr_no),
    supplierId: Number(r.supplier_id),
    supplierName: optS(r.supplier_name),
    validTill: optS(r.valid_till),
    paymentTerms: optS(r.payment_terms),
    deliveryTerms: optS(r.delivery_terms),
    leadDays: optN(r.lead_days),
    attachmentPath: optS(r.attachment_path),
    status: (s(r.status) || 'Received') as import('./types').SQStatus,
    createdAt: s(r.created_at),
    totalAmount: optN(r.total_amount) ?? undefined,
    itemCount: optN(r.item_count) ?? undefined,
  };
}

// --------------------------------------------------- Comparison Row ---
export function mapSupplierComparisonRow(r: Row): import('./types').SupplierComparisonRow {
  return {
    prItemId: Number(r.pr_item_id),
    prId: Number(r.pr_id),
    item: s(r.item),
    grade: optS(r.grade),
    size: optS(r.size),
    requiredQty: n(r.required_qty),
    sqId: Number(r.sq_id),
    sqNo: s(r.sq_no),
    supplier: s(r.supplier),
    rate: n(r.rate),
    leadDays: optN(r.lead_days),
    paymentTerms: optS(r.payment_terms),
    rateRank: n(r.rate_rank, 1),
  };
}
