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
