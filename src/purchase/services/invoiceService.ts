import { dbMessage, supabase } from '../../db/client';
import type {
  InvoiceDetail,
  InvoiceLine,
  InvoiceStatus,
  InvoiceablePO,
  PayStatus,
  POBalance,
  POInvoiceLine,
  PurchaseInvoice,
  PurchasePayment,
  SupplierPayable,
  TaxType,
} from '../types';

type Row = Record<string, unknown>;
const num = (v: unknown, d = 0) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const str = (v: unknown) => (v == null ? '' : String(v));
const opt = (v: unknown) => (v == null || v === '' ? undefined : String(v));

const toInvoice = (r: Row): PurchaseInvoice => ({
  invoiceId: num(r.invoice_id),
  pinvNo: str(r.pinv_no),
  supplierInvNo: str(r.supplier_inv_no),
  invDate: str(r.inv_date),
  dueDate: (r.due_date as string | null) ?? null,
  supplierId: num(r.supplier_id),
  supplierName: str(r.supplier_name),
  poId: r.po_id == null ? null : num(r.po_id),
  poNo: opt(r.po_no),
  status: (str(r.status) || 'Draft') as InvoiceStatus,
  payStatus: (str(r.pay_status) || 'Unpaid') as PayStatus,
  taxableAmount: num(r.taxable_amount),
  gstAmount: num(r.gst_amount),
  totalAmount: num(r.total_amount),
  paidAmount: num(r.paid_amount),
  balance: num(r.balance),
  isOverdue: r.is_overdue === true,
  daysOverdue: num(r.days_overdue),
  varianceNote: opt(r.variance_note),
  createdBy: opt(r.created_by),
  postedBy: opt(r.posted_by),
  postedAt: opt(r.posted_at),
});

const toPayment = (r: Row): PurchasePayment => ({
  paymentId: num(r.payment_id),
  payNo: str(r.pay_no),
  payDate: str(r.pay_date),
  amount: num(r.amount),
  mode: str(r.mode),
  reference: opt(r.reference),
  notes: opt(r.notes),
  createdBy: opt(r.created_by),
  invoiceId: num(r.invoice_id),
  pinvNo: str(r.pinv_no),
  supplierInvNo: str(r.supplier_inv_no),
  supplierName: str(r.supplier_name),
  poNo: opt(r.po_no),
});

const toMatch = (r: Row): POInvoiceLine => {
  const isKg = str(r.uom).trim().toUpperCase() === 'KG';
  const ordered = num(r.qty);
  const received = num(r.received_qty);
  const accepted = num(r.accepted_qty);
  const invoiced = num(r.invoiced_qty);
  // incoming QC has been recorded on the line when anything was accepted or rejected (same test the database applies to the lots)
  const qcRecorded = accepted > 0 || num(r.rejected_qty) > 0;
  const basis = !isKg ? ordered : qcRecorded ? accepted : received;
  return {
    poItemId: num(r.id),
    lineNo: num(r.line_no),
    item: str(r.item),
    uom: str(r.uom) || 'KG',
    ordered,
    received,
    accepted,
    invoiced,
    poRate: num(r.rate),
    gstPct: num(r.gst_pct, 18),
    qcRecorded,
    billable: Math.max(Math.round((basis - invoiced) * 1000) / 1000, 0),
  };
};

export async function fetchInvoices(): Promise<PurchaseInvoice[]> {
  const { data, error } = await supabase.from('v_purchase_invoice_register').select('*').order('inv_date', { ascending: false }).order('invoice_id', { ascending: false });
  if (error) throw new Error(dbMessage(error));
  return (data || []).map((r) => toInvoice(r as Row));
}

/** The PO's lines with the three-way match figures; the invoice form is prefilled from these. */
export async function fetchPOInvoiceLines(poId: number): Promise<POInvoiceLine[]> {
  const { data, error } = await supabase
    .from('purchase_order_items')
    .select('id, line_no, item, uom, qty, rate, gst_pct, received_qty, accepted_qty, rejected_qty, invoiced_qty')
    .eq('po_id', poId)
    .order('line_no', { ascending: true });
  if (error) throw new Error(dbMessage(error));
  return (data || []).map((r) => toMatch(r as Row));
}

export async function fetchInvoiceDetail(id: number): Promise<InvoiceDetail> {
  const { data: h, error } = await supabase.from('v_purchase_invoice_register').select('*').eq('invoice_id', id).single();
  if (error || !h) throw new Error(dbMessage(error));
  const inv = toInvoice(h as Row);
  const [lines, pays, hdr] = await Promise.all([
    supabase.from('purchase_invoice_items').select('*').eq('invoice_id', id).order('line_no', { ascending: true }),
    supabase.from('v_purchase_payment_register').select('*').eq('invoice_id', id).order('pay_date', { ascending: false }),
    supabase.from('purchase_invoices').select('tax_type, cancel_reason').eq('id', id).maybeSingle(),
  ]);
  if (lines.error) throw new Error(dbMessage(lines.error));
  const items: InvoiceLine[] = (lines.data || []).map((r) => ({
    id: num((r as Row).id),
    lineNo: num((r as Row).line_no),
    poItemId: num((r as Row).po_item_id),
    item: str((r as Row).item),
    qty: num((r as Row).qty),
    rate: num((r as Row).rate),
    gstPct: num((r as Row).gst_pct, 18),
    amount: num((r as Row).amount),
  }));
  const match = inv.poId ? await fetchPOInvoiceLines(inv.poId) : [];
  const hd = (hdr.data ?? {}) as Row;
  return {
    ...inv,
    taxType: (str(hd.tax_type) === 'inter' ? 'inter' : 'intra') as TaxType,
    cancelReason: opt(hd.cancel_reason),
    items,
    payments: (pays.data || []).map((r) => toPayment(r as Row)),
    match,
  };
}

/** Released (or later) purchase orders an invoice can be entered against. */
export async function fetchInvoiceablePOs(): Promise<InvoiceablePO[]> {
  const { data, error } = await supabase
    .from('v_po_register')
    .select('id, po_no, supplier_id, supplier_name, status, payment_terms')
    .in('status', ['Released', 'Sent to Supplier', 'Partially Received', 'Fully Received', 'Closed'])
    .order('po_no', { ascending: false });
  if (error) throw new Error(dbMessage(error));
  return (data || []).map((r) => ({ id: num((r as Row).id), poNo: str((r as Row).po_no), supplierId: num((r as Row).supplier_id), supplierName: str((r as Row).supplier_name), status: str((r as Row).status), paymentTerms: opt((r as Row).payment_terms) }));
}

export interface SaveInvoiceHeader {
  po_id: number;
  supplier_inv_no: string;
  inv_date: string;
  due_date?: string | null;
  variance_note?: string | null;
}
export interface SaveInvoiceItem {
  po_item_id: number;
  qty: number;
  rate: number;
  gst_pct: number;
}

export async function saveInvoice(id: number | null, header: SaveInvoiceHeader, items: SaveInvoiceItem[], user: string): Promise<number> {
  const { data, error } = await supabase.rpc('save_purchase_invoice', { p_id: id, p_header: header, p_items: items, p_user: user });
  if (error) throw new Error(error.message);
  return Number(data);
}

export async function postInvoice(id: number, user: string): Promise<void> {
  const { error } = await supabase.rpc('post_purchase_invoice', { p_id: id, p_user: user });
  if (error) throw new Error(error.message);
}

export async function cancelInvoice(id: number, reason: string, user: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_purchase_invoice', { p_id: id, p_reason: reason, p_user: user });
  if (error) throw new Error(error.message);
}

export async function fetchPayments(): Promise<PurchasePayment[]> {
  const { data, error } = await supabase.from('v_purchase_payment_register').select('*').order('pay_date', { ascending: false }).order('payment_id', { ascending: false });
  if (error) throw new Error(dbMessage(error));
  return (data || []).map((r) => toPayment(r as Row));
}

export interface SavePaymentHeader {
  pinv_id?: number;
  pay_date: string;
  amount: number;
  mode: string;
  reference?: string | null;
  notes?: string | null;
}

export async function savePayment(id: number | null, header: SavePaymentHeader, user: string): Promise<number> {
  const { data, error } = await supabase.rpc('save_purchase_payment', { p_id: id, p_header: header, p_user: user });
  if (error) throw new Error(error.message);
  return Number(data);
}

export async function fetchSupplierPayables(): Promise<SupplierPayable[]> {
  const { data, error } = await supabase.from('v_supplier_payables').select('*').order('outstanding', { ascending: false });
  if (error) throw new Error(dbMessage(error));
  return (data || []).map((r) => {
    const x = r as Row;
    return {
      supplierId: num(x.supplier_id),
      supplierName: str(x.supplier_name),
      supplierCode: str(x.supplier_code),
      openInvoices: num(x.open_invoices),
      totalInvoiced: num(x.total_invoiced),
      totalPaid: num(x.total_paid),
      outstanding: num(x.outstanding),
      overdueAmount: num(x.overdue_amount),
      b0to30: num(x.bucket_0_30),
      b31to60: num(x.bucket_31_60),
      b61to90: num(x.bucket_61_90),
      b90plus: num(x.bucket_90_plus),
    };
  });
}

/** Invoiced / paid / still to pay for one PO (view v_po_pending_balance: posted invoices and their payments only). */
export async function fetchPOBalance(poId: number): Promise<POBalance | null> {
  const { data, error } = await supabase.from('v_po_pending_balance').select('*').eq('po_id', poId).maybeSingle();
  if (error) throw new Error(dbMessage(error));
  if (!data) return null;
  const r = data as Row;
  return { poId, totalAmount: num(r.total_amount), invoiced: num(r.invoiced), paid: num(r.paid), balanceToInvoice: num(r.balance_to_invoice), payable: num(r.payable) };
}

/** Dashboard figures: what is still owed on posted invoices, and what is past its due date. */
export async function fetchPayablesKpi(): Promise<{ outstanding: number; openInvoices: number; overdueInvoices: number; overdueAmount: number }> {
  const { data, error } = await supabase.from('v_purchase_invoice_register').select('status, balance, is_overdue').eq('status', 'Posted');
  if (error) throw new Error(dbMessage(error));
  const rows = (data || []) as Row[];
  const open = rows.filter((r) => num(r.balance) > 0.004);
  return {
    outstanding: open.reduce((a, r) => a + num(r.balance), 0),
    openInvoices: open.length,
    overdueInvoices: open.filter((r) => r.is_overdue === true).length,
    overdueAmount: open.filter((r) => r.is_overdue === true).reduce((a, r) => a + num(r.balance), 0),
  };
}
