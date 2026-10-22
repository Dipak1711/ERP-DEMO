import { dbMessage, supabase } from '../../db/client';
import { mapRFQ, mapRFQSupplier, mapPurchaseRequisition, mapPRItem } from '../mappers';
import type { RFQ, RFQDetail, SaveRFQInput } from '../types';

export async function fetchRFQs(): Promise<RFQ[]> {
  const { data, error } = await supabase
    .from('rfqs')
    .select(`
      *,
      purchase_requisitions (pr_no),
      rfq_suppliers (id, sent_at, responded_at)
    `)
    .order('created_at', { ascending: false });

  if (error) throw new Error(dbMessage(error));

  return (data || []).map((row: any) => {
    const rfq = mapRFQ(row);
    if (row.purchase_requisitions?.pr_no) {
      rfq.prNo = row.purchase_requisitions.pr_no;
    }
    const sups = row.rfq_suppliers || [];
    rfq.supplierCount = sups.length;
    rfq.responseCount = sups.filter((s: any) => s.responded_at != null).length;
    return rfq;
  });
}

export async function fetchRFQDetail(id: number): Promise<RFQDetail> {
  const { data, error } = await supabase
    .from('rfqs')
    .select(`
      *,
      purchase_requisitions (
        *,
        purchase_requisition_items (*)
      ),
      rfq_suppliers (
        id,
        rfq_id,
        supplier_id,
        sent_at,
        responded_at,
        suppliers (id, name, email, phone)
      )
    `)
    .eq('id', id)
    .single();

  if (error || !data) throw new Error(dbMessage(error));

  const rfq = mapRFQ(data);
  if (data.purchase_requisitions) {
    const prData = data.purchase_requisitions;
    rfq.prNo = prData.pr_no;
    const pr = mapPurchaseRequisition(prData);
    pr.items = (prData.purchase_requisition_items || []).map(mapPRItem);
    (rfq as RFQDetail).pr = pr;
  }

  const suppliers = (data.rfq_suppliers || []).map((row: any) => {
    const s = mapRFQSupplier(row);
    if (row.suppliers) {
      s.supplierName = row.suppliers.name;
      s.supplierEmail = row.suppliers.email;
      s.supplierPhone = row.suppliers.phone;
    }
    return s;
  });

  rfq.supplierCount = suppliers.length;
  rfq.responseCount = suppliers.filter((s: import('../types').RFQSupplier) => s.respondedAt != null).length;

  return {
    ...rfq,
    suppliers,
    pr: (rfq as RFQDetail).pr ?? null,
  };
}

export async function saveRFQ(id: number | null, input: SaveRFQInput, user: string): Promise<number> {
  const { data, error } = await supabase.rpc('save_rfq', {
    p_id: id,
    p_pr_id: input.pr_id || null,
    p_due_date: input.due_date || null,
    p_supplier_ids: input.supplier_ids || [],
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
  return Number(data);
}

export async function markRFQSent(rfqId: number, supplierId: number, user: string): Promise<void> {
  const { error } = await supabase.rpc('mark_rfq_sent', {
    p_rfq_id: rfqId,
    p_supplier_id: supplierId,
    p_user: user,
  });
  if (error) throw new Error(dbMessage(error));
}
