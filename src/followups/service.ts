// Collects everything that needs following up, from the parts of the system the signed-in person may open.
// A source that is hidden for the person (or not installed yet) simply contributes nothing.
import { supabase } from '../db/client';
import { fetchQuotations } from '../salesmod/service';
import { fetchOrders } from '../salesmod/service';
import { fetchPORegister } from '../purchase/services/poService';
import { fetchRFQs } from '../purchase/services/rfqService';
import { fetchInvoices } from '../purchase/services/invoiceService';
import { daysUntil, type FollowupItem, type FollowupKind } from './types';

const inr = (v: number) => `₹ ${Math.round(v).toLocaleString('en-IN')}`;
const day = (v?: string | null) => (v ? String(v).slice(0, 10) : null);

async function quotations(): Promise<FollowupItem[]> {
  const out: FollowupItem[] = [];
  for (const q of await fetchQuotations()) {
    if (q.status !== 'Approved' && q.status !== 'Sent') continue;
    const route = `sales-quotation?id=${q.id}`;
    out.push({
      key: `qt-${q.id}`, kind: 'quotation', ref: q.docNo, party: q.customer,
      what: q.status === 'Sent' ? 'Follow up with the customer' : 'Approved: send it to the customer',
      detail: q.status === 'Sent'
        ? `Sent ${q.daysPending ?? 0} day(s) ago${q.lastFollowup ? ` · last follow-up ${q.lastFollowup}` : ''}`
        : 'Waiting to be sent',
      due: day(q.nextFollowup), amount: q.amount, route,
    });
    // a quotation that is about to run out (or has) without an answer
    if (q.validUntil && daysUntil(q.validUntil) <= 7) {
      out.push({
        key: `qtv-${q.id}`, kind: 'quotation', ref: q.docNo, party: q.customer, what: 'Quotation validity ends',
        detail: q.isExpired ? 'The validity has passed: renew it or close it' : 'Get the customer\'s answer before it expires',
        due: day(q.validUntil), amount: q.amount, route,
      });
    }
  }
  return out;
}

async function orders(): Promise<FollowupItem[]> {
  return (await fetchOrders())
    .filter((o) => ['Draft', 'Confirmed', 'In Production'].includes(o.status))
    .map((o) => ({
      key: `so-${o.id}`, kind: 'order' as const, ref: o.soNo, party: o.customer, what: 'Delivery due',
      detail: `${o.status}${o.products ? ' · ' + o.products : ''}`, due: day(o.deliveryDate), amount: o.amount, route: `sales-order?id=${o.id}`,
    }));
}

async function tasks(): Promise<FollowupItem[]> {
  const { data, error } = await supabase.from('v_sales_records').select('kind, doc_no, party, title, product, due_date, status, assignee').in('kind', ['task', 'inquiry']);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[])
    .filter((r) => (r.kind === 'task' ? ['Open', 'In Progress'] : ['Open']).includes(String(r.status)))
    .map((r) => ({
      key: `${r.kind}-${r.doc_no}`, kind: 'task' as const, ref: String(r.doc_no), party: String(r.party ?? ''),
      what: r.kind === 'task' ? String(r.title || 'Task') : 'Inquiry: send the quotation',
      detail: r.kind === 'task' ? `Assigned to ${r.assignee || '—'} · ${r.status}` : `${r.product || 'Inquiry'} · required by this date`,
      due: day(r.due_date as string | null), amount: null, route: r.kind === 'task' ? 'task-assignment' : 'inquiry',
    }));
}

async function purchaseOrders(): Promise<FollowupItem[]> {
  return (await fetchPORegister())
    .filter((o) => ['Released', 'Sent to Supplier', 'Partially Received'].includes(o.status))
    .map((o) => ({
      key: `po-${o.id}`, kind: 'po' as const, ref: o.poNo, party: o.supplierName ?? '', what: 'Delivery from the supplier',
      detail: `${o.status}${o.pendingQty != null ? ` · ${Math.round(o.pendingQty)} still to receive` : ''}${o.urgency !== 'Normal' ? ` · ${o.urgency}` : ''}`,
      due: day(o.deliveryDate), amount: o.totalAmount ?? null, route: `purchase-orders?id=${o.id}`,
    }));
}

async function rfqs(): Promise<FollowupItem[]> {
  return (await fetchRFQs())
    .filter((r) => r.status === 'Open' || r.status === 'Quotes Received')
    .map((r) => ({
      key: `rfq-${r.id}`, kind: 'rfq' as const, ref: r.rfqNo, party: '', what: 'Supplier quotations due',
      detail: `${r.responseCount ?? 0} of ${r.supplierCount ?? 0} suppliers replied${r.prNo ? ' · ' + r.prNo : ''}`, due: day(r.dueDate), amount: null, route: 'rfqs',
    }));
}

async function payments(): Promise<FollowupItem[]> {
  return (await fetchInvoices())
    .filter((i) => i.status === 'Posted' && i.balance > 0.004)
    .map((i) => ({
      key: `pinv-${i.invoiceId}`, kind: 'payment' as const, ref: i.pinvNo, party: i.supplierName, what: 'Payment due to the supplier',
      detail: `Balance ${inr(i.balance)}${i.poNo ? ' · ' + i.poNo : ''}`, due: day(i.dueDate), amount: i.balance, route: `purchase-invoices?id=${i.invoiceId}`,
    }));
}

const SOURCES: Record<FollowupKind, () => Promise<FollowupItem[]>> = { quotation: quotations, order: orders, task: tasks, po: purchaseOrders, rfq: rfqs, payment: payments };

export async function fetchFollowups(kinds: FollowupKind[]): Promise<FollowupItem[]> {
  const parts = await Promise.allSettled(kinds.map((k) => SOURCES[k]()));
  return parts.flatMap((p) => (p.status === 'fulfilled' ? p.value : []));
}
