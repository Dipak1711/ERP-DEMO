import { dbMessage, supabase } from '../../db/client';
import type { POReceipt, ReceivablePO, SupplierPerformance } from '../types';

type Row = Record<string, unknown>;
const num = (v: unknown, d = 0) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const optNum = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v: unknown) => (v == null ? '' : String(v));
const optStr = (v: unknown) => (v == null || v === '' ? undefined : String(v));

/** Lots booked against one PO (for the "Receipts" section of the PO page). */
export async function fetchPOReceipts(poId: number): Promise<POReceipt[]> {
  const { data, error } = await supabase.from('v_po_receipts').select('*').eq('po_id', poId).order('inward_date', { ascending: false });
  if (error) throw new Error(dbMessage(error));
  return (data || []).map((r: Row) => ({
    poId: num(r.po_id),
    poItemId: num(r.po_item_id),
    lotId: str(r.lot_id),
    inwardDate: str(r.inward_date),
    heatNo: optStr(r.heat_no),
    invoiceNo: optStr(r.invoice_no),
    material: optStr(r.material),
    grade: optStr(r.material_type),
    od: optNum(r.od) ?? undefined,
    inwardQty: num(r.inward_qty),
    inwardWeight: num(r.inward_weight),
    qcStatus: (str(r.qc_status) || 'Pending') as POReceipt['qcStatus'],
    acceptedWeight: optNum(r.accepted_weight),
    rejectedWeight: optNum(r.rejected_weight),
  }));
}

/** Released POs that still have KG lines left to receive — what the inward form can book a lot against. */
export async function fetchReceivablePOs(): Promise<ReceivablePO[]> {
  const { data, error } = await supabase
    .from('v_po_item_register')
    .select('*')
    .in('status', ['Released', 'Sent to Supplier', 'Partially Received'])
    .eq('uom', 'KG')
    .order('po_no', { ascending: false })
    .order('line_no', { ascending: true });
  if (error) throw new Error(dbMessage(error));
  const byPO = new Map<number, ReceivablePO>();
  for (const r of (data || []) as Row[]) {
    if (num(r.received_qty) >= num(r.qty)) continue; // line already complete
    const id = num(r.po_id);
    let po = byPO.get(id);
    if (!po) {
      po = { id, poNo: str(r.po_no), supplierId: num(r.supplier_id), supplierName: str(r.supplier_name), status: str(r.status), deliveryDate: (r.delivery_date as string | null) ?? null, items: [] };
      byPO.set(id, po);
    }
    po.items.push({
      id: num(r.item_id),
      lineNo: num(r.line_no),
      item: str(r.item),
      material: optStr(r.material),
      grade: optStr(r.grade),
      size: optStr(r.size),
      uom: str(r.uom) || 'KG',
      qty: num(r.qty),
      receivedQty: num(r.received_qty),
      rate: num(r.rate),
    });
  }
  return [...byPO.values()];
}

export async function fetchSupplierPerformance(): Promise<SupplierPerformance[]> {
  const { data, error } = await supabase.from('v_supplier_performance').select('*').order('name', { ascending: true });
  if (error) throw new Error(dbMessage(error));
  return (data || []).map((r: Row) => ({
    supplierId: num(r.supplier_id),
    name: str(r.name),
    code: str(r.supplier_code),
    poCount: num(r.po_count),
    totalPurchaseValue: num(r.total_purchase_value),
    onTimePct: optNum(r.on_time_delivery_pct),
    onTimeCount: num(r.on_time_count),
    lateCount: num(r.late_count),
    qualityPct: optNum(r.quality_acceptance_pct),
    rejectionPct: optNum(r.rejection_pct),
    priceIndex: optNum(r.price_index),
    shortage: num(r.quantity_shortage),
    shortageBase: num(r.shortage_base_qty),
    avgResponseHrs: optNum(r.avg_response_hrs),
    paymentTerms: optStr(r.payment_terms),
  }));
}

/** Last POs of one supplier, for the scorecard drawer. */
export async function fetchSupplierPOs(supplierId: number, limit = 8): Promise<Row[]> {
  const { data, error } = await supabase
    .from('v_po_register')
    .select('id, po_no, po_date, status, delivery_date, total_amount, ordered_qty, received_qty, is_overdue')
    .eq('supplier_id', supplierId)
    .order('po_date', { ascending: false })
    .limit(limit);
  if (error) throw new Error(dbMessage(error));
  return (data || []) as Row[];
}

/** Rows of one report view, newest first where the view has a date. Filtering happens on the page; volumes are a plant's PO book, not millions. */
export async function fetchReportRows(view: string): Promise<Row[]> {
  const { data, error } = await supabase.from(view).select('*').limit(5000);
  if (error) throw new Error(dbMessage(error));
  return (data || []) as Row[];
}
