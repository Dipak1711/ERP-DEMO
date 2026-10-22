import { dbMessage, supabase } from '../../db/client';
import { mapSQItem, mapSupplierComparisonRow, mapSupplierQuotation } from '../mappers';
import type {
  ComparisonMatrix,
  ComparisonSupplierSummary,
  SaveSQHeaderInput,
  SaveSQItemInput,
  SQDetail,
  SQStatus,
  SupplierQuotation,
} from '../types';

export async function fetchQuotations(): Promise<SupplierQuotation[]> {
  const { data, error } = await supabase
    .from('supplier_quotations')
    .select(`
      *,
      suppliers (name),
      rfqs (rfq_no),
      purchase_requisitions (pr_no),
      supplier_quotation_items (qty, rate)
    `)
    .order('created_at', { ascending: false });

  if (error) throw new Error(dbMessage(error));

  return (data || []).map((row: any) => {
    const sq = mapSupplierQuotation(row);
    if (row.suppliers?.name) sq.supplierName = row.suppliers.name;
    if (row.rfqs?.rfq_no) sq.rfqNo = row.rfqs.rfq_no;
    if (row.purchase_requisitions?.pr_no) sq.prNo = row.purchase_requisitions.pr_no;

    const items = row.supplier_quotation_items || [];
    sq.itemCount = items.length;
    sq.totalAmount = items.reduce((sum: number, it: any) => sum + Number(it.qty || 0) * Number(it.rate || 0), 0);
    return sq;
  });
}

export async function fetchQuotationDetail(id: number): Promise<SQDetail> {
  const [sqRes, itemsRes] = await Promise.all([
    supabase
      .from('supplier_quotations')
      .select(`
        *,
        suppliers (name),
        rfqs (rfq_no),
        purchase_requisitions (pr_no)
      `)
      .eq('id', id)
      .single(),
    supabase
      .from('supplier_quotation_items')
      .select('*')
      .eq('sq_id', id),
  ]);

  if (sqRes.error || !sqRes.data) throw new Error(dbMessage(sqRes.error));
  if (itemsRes.error) throw new Error(dbMessage(itemsRes.error));

  const sq = mapSupplierQuotation(sqRes.data);
  if (sqRes.data.suppliers?.name) sq.supplierName = sqRes.data.suppliers.name;
  if (sqRes.data.rfqs?.rfq_no) sq.rfqNo = sqRes.data.rfqs.rfq_no;
  if (sqRes.data.purchase_requisitions?.pr_no) sq.prNo = sqRes.data.purchase_requisitions.pr_no;

  const items = (itemsRes.data || []).map(mapSQItem);
  sq.itemCount = items.length;
  sq.totalAmount = items.reduce((sum, it) => sum + it.amount, 0);

  return {
    ...sq,
    items,
  };
}

export async function saveQuotation(
  id: number | null,
  header: SaveSQHeaderInput,
  items: SaveSQItemInput[],
  user: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('save_sq', {
    p_id: id,
    p_header: header,
    p_items: items,
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
  return Number(data);
}

export async function setQuotationStatus(id: number, status: SQStatus, user: string): Promise<void> {
  const { error } = await supabase.rpc('set_sq_status', {
    p_id: id,
    p_status: status,
    p_user: user,
  });
  if (error) throw new Error(dbMessage(error));
}

export async function fetchComparison(prId?: number, rfqId?: number): Promise<ComparisonMatrix> {
  let q = supabase.from('v_supplier_comparison').select('*');
  if (prId) q = q.eq('pr_id', prId);

  const { data, error } = await q;
  if (error) throw new Error(dbMessage(error));

  const rows = (data || []).map(mapSupplierComparisonRow);

  // If rfqId was specified but not prId, find PR id from RFQ
  let prNo: string | undefined;
  let rfqNo: string | undefined;

  if (prId) {
    const { data: prData } = await supabase.from('purchase_requisitions').select('pr_no').eq('id', prId).single();
    if (prData) prNo = prData.pr_no;
  }
  if (rfqId) {
    const { data: rfqData } = await supabase.from('rfqs').select('rfq_no, pr_id').eq('id', rfqId).single();
    if (rfqData) {
      rfqNo = rfqData.rfq_no;
      if (!prId && rfqData.pr_id) {
        return fetchComparison(rfqData.pr_id, rfqId);
      }
    }
  }

  // Also fetch full SQ details for these SQ IDs to get status, payment_terms, delivery_terms
  const sqIds = [...new Set(rows.map((r) => r.sqId))];
  const sqMap = new Map<number, { status: SQStatus; deliveryTerms?: string }>();
  if (sqIds.length > 0) {
    const { data: sqDetails } = await supabase
      .from('supplier_quotations')
      .select('id, status, delivery_terms')
      .in('id', sqIds);
    (sqDetails || []).forEach((d: any) => {
      sqMap.set(d.id, { status: d.status as SQStatus, deliveryTerms: d.delivery_terms });
    });
  }

  // Build supplier summaries
  const supplierSummaryMap = new Map<number, ComparisonSupplierSummary>();
  for (const r of rows) {
    const extra = sqMap.get(r.sqId);
    if (!supplierSummaryMap.has(r.sqId)) {
      supplierSummaryMap.set(r.sqId, {
        supplierName: r.supplier,
        sqId: r.sqId,
        sqNo: r.sqNo,
        status: extra?.status || 'Received',
        leadDays: r.leadDays,
        paymentTerms: r.paymentTerms,
        deliveryTerms: extra?.deliveryTerms,
        totalAmount: 0,
        itemsQuotedCount: 0,
      });
    }
    const sup = supplierSummaryMap.get(r.sqId)!;
    sup.totalAmount += r.rate * r.requiredQty;
    sup.itemsQuotedCount += 1;
  }

  // Group items by prItemId
  const itemMap = new Map<number, {
    prItemId: number;
    item: string;
    grade?: string;
    size?: string;
    requiredQty: number;
    uom: string;
    quotes: Record<number, { rate: number; sqId: number; isLowest: boolean }>;
  }>();

  for (const r of rows) {
    if (!itemMap.has(r.prItemId)) {
      itemMap.set(r.prItemId, {
        prItemId: r.prItemId,
        item: r.item,
        grade: r.grade,
        size: r.size,
        requiredQty: r.requiredQty,
        uom: 'KG',
        quotes: {},
      });
    }
    const it = itemMap.get(r.prItemId)!;
    it.quotes[r.sqId] = {
      rate: r.rate,
      sqId: r.sqId,
      isLowest: r.rateRank === 1,
    };
  }

  const items = Array.from(itemMap.values()).map((it) => {
    const rates = Object.values(it.quotes).map((q) => q.rate);
    const lowestRate = rates.length ? Math.min(...rates) : undefined;
    return {
      ...it,
      lowestRate,
    };
  });

  return {
    prId,
    prNo,
    rfqId,
    rfqNo,
    suppliers: Array.from(supplierSummaryMap.values()),
    items,
  };
}

export async function uploadQuotationAttachment(file: File): Promise<{ name: string; path: string }> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const path = `sq_${Date.now()}_${cleanName}`;

  const { error } = await supabase.storage.from('po-attachments').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) throw new Error(dbMessage(error));
  return { name: file.name, path };
}

export async function getQuotationAttachmentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('po-attachments').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    throw new Error(dbMessage(error) || 'Could not generate download URL');
  }
  return data.signedUrl;
}
