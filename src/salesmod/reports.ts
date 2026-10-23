// The 15 sales reports as data. Each says which columns it shows, who may see them, and how its rows are built from the
// quotation / line / price-history data the page has loaded. The filters (date, customer, salesperson, product, status) are applied
// to that source data before a report builds its rows, so totals and groups always agree with what is on screen.
import type { FieldGroup } from '../auth/access';
import { AGE_BUCKETS, PIPELINE, bucketOf, daysBetween, monthKey, monthLabel, sum, weightedMargin } from './analytics';
import type { ItemRow, PriceHistoryRow, QuotationRow } from './types';

export type Row = Record<string, unknown>;
export type ColKind = 'text' | 'num' | 'money' | 'date' | 'pct' | 'badge';
export interface SalesCol {
  key: string;
  label: string;
  kind?: ColKind;
  /** left out for people who may not see this kind of information */
  secret?: FieldGroup;
  total?: boolean;
}
export interface Source {
  q: QuotationRow[];
  items: ItemRow[];
  history: PriceHistoryRow[];
}
export interface SalesReportDef {
  id: string;
  title: string;
  group: string;
  note?: string;
  cols: SalesCol[];
  /** the report is meaningless without this kind of information (e.g. customer-wise needs customer names) */
  needs?: FieldGroup[];
  /** which source the filters touch */
  uses: 'q' | 'items' | 'history';
  chart?: 'monthly';
  build: (s: Source) => Row[];
}

export const REPORT_GROUPS = ['Management', 'Sales', 'Customer', 'Product', 'Profitability'] as const;

const r2 = (x: number) => Math.round(x * 100) / 100;
const resp = (q: QuotationRow) => (q.status === 'Won' || q.status === 'Lost' ? q.status : q.status === 'Sent' ? 'Pending' : '');
const today = () => new Date().toISOString().slice(0, 10);

const C = {
  doc: { key: 'doc_no', label: 'Quotation No' } as SalesCol,
  date: { key: 'date', label: 'Date', kind: 'date' } as SalesCol,
  customer: { key: 'customer', label: 'Customer', secret: 'party_names' } as SalesCol,
  products: { key: 'products', label: 'Products' } as SalesCol,
  sp: { key: 'salesperson', label: 'Salesperson' } as SalesCol,
  status: { key: 'status', label: 'Status', kind: 'badge' } as SalesCol,
  amount: { key: 'amount', label: 'Value (₹)', kind: 'money', secret: 'sales_rates', total: true } as SalesCol,
  margin: { key: 'margin', label: 'Margin %', kind: 'pct', secret: 'margins' } as SalesCol,
};

function base(q: QuotationRow): Row {
  return { doc_no: q.docNo, date: q.qtDate, customer: q.customer, products: q.products, salesperson: q.salesperson, status: q.displayStatus, amount: q.amount, margin: q.marginPct };
}

/** one row per value of `key`, with the counts every group report shares */
function groupQ(rows: QuotationRow[], key: (q: QuotationRow) => string, label: string): Row[] {
  const m = new Map<string, QuotationRow[]>();
  for (const q of rows) {
    const k = key(q) || '—';
    m.set(k, [...(m.get(k) ?? []), q]);
  }
  return [...m.entries()]
    .map(([k, qs]) => {
      const won = qs.filter((q) => q.status === 'Won');
      const lost = qs.filter((q) => q.status === 'Lost');
      const submitted = qs.filter((q) => q.status !== 'Draft');
      return {
        [label]: k,
        quotations: qs.length,
        value: sum(qs.map((q) => q.amount)),
        won: won.length,
        won_value: sum(won.map((q) => q.amount)),
        lost: lost.length,
        pending: qs.filter((q) => ['Pending Approval', 'Approved', 'Sent'].includes(q.status)).length,
        conversion: submitted.length ? r2((won.length / submitted.length) * 100) : null,
        margin: (() => { const w = weightedMargin(qs.filter((q) => q.status !== 'Draft')); return w == null ? null : r2(w); })(),
      } as Row;
    })
    .sort((a, b) => Number(b.value) - Number(a.value));
}

const groupCols = (label: string, key: string, extra: SalesCol[] = []): SalesCol[] => [
  { key, label, ...(key === 'customer' ? { secret: 'party_names' as FieldGroup } : {}) },
  { key: 'quotations', label: 'Quotations', kind: 'num', total: true },
  { key: 'value', label: 'Value (₹)', kind: 'money', secret: 'sales_rates', total: true },
  { key: 'won', label: 'Won', kind: 'num', total: true },
  { key: 'won_value', label: 'Won Value (₹)', kind: 'money', secret: 'sales_rates', total: true },
  { key: 'lost', label: 'Lost', kind: 'num', total: true },
  { key: 'pending', label: 'Pending', kind: 'num', total: true },
  { key: 'conversion', label: 'Conversion %', kind: 'pct' },
  { key: 'margin', label: 'Avg Margin %', kind: 'pct', secret: 'margins' },
  ...extra,
];

export const SALES_REPORTS: SalesReportDef[] = [
  // ------------------------------------------------------------- Management
  {
    id: 'quotation-summary', title: 'Quotation Summary', group: 'Management', uses: 'q',
    note: 'Every quotation with its value, discount, margin, status and the customer response.',
    cols: [C.doc, C.date, C.customer, C.products, { key: 'qty', label: 'Qty', kind: 'num', total: true }, C.amount,
      { key: 'discount', label: 'Discount (₹)', kind: 'money', secret: 'sales_rates', total: true }, C.margin, C.status,
      { key: 'response', label: 'Response' }, { key: 'valid_until', label: 'Valid Until', kind: 'date' }, C.sp],
    build: ({ q }) => q.map((x) => ({ ...base(x), qty: x.totalQty, discount: x.discountValue, response: resp(x), valid_until: x.validUntil })),
  },
  {
    id: 'pending-quotations', title: 'Pending Quotations', group: 'Management', uses: 'q',
    note: 'Quotations that are not finished yet: drafts, waiting for approval, sent back, approved or sent without an answer.',
    cols: [C.doc, C.date, C.customer, C.products, C.amount, C.status, { key: 'age', label: 'Age (days)', kind: 'num' }, { key: 'valid_until', label: 'Valid Until', kind: 'date' }, C.sp],
    build: ({ q }) =>
      q.filter((x) => ['Draft', 'Pending Approval', 'Revision Required', 'Approved', 'Sent'].includes(x.status))
        .map((x) => ({ ...base(x), age: daysBetween(x.qtDate), valid_until: x.validUntil })),
  },
  {
    id: 'approval-report', title: 'Approval Report (Director)', group: 'Management', uses: 'q',
    note: 'What the Director was asked to approve, the margin at that time and the decision.',
    cols: [C.doc, C.customer, C.amount, { key: 'cost', label: 'Cost (₹)', kind: 'money', secret: 'margins', total: true }, C.margin,
      { key: 'below', label: 'Below Min?', secret: 'margins' }, { key: 'submitted', label: 'Submitted', kind: 'date' }, { key: 'decided_by', label: 'Decided By' },
      { key: 'decided_on', label: 'Decided On', kind: 'date' }, C.status, { key: 'note', label: 'Note' }],
    build: ({ q }) =>
      q.filter((x) => x.status !== 'Draft').map((x) => ({
        doc_no: x.docNo, customer: x.customer, amount: x.amount, cost: x.costTotal, margin: x.marginPct, below: x.belowMin == null ? '' : x.belowMin ? 'Yes' : 'No',
        submitted: x.submittedAt, decided_by: x.approvedBy ?? '', decided_on: x.approvedAt, status: x.displayStatus, note: x.decisionNote ?? '',
      })),
  },
  {
    id: 'expired-quotations', title: 'Expired Quotations', group: 'Management', uses: 'q',
    note: 'Approved or sent quotations whose validity date has passed without an answer.',
    cols: [C.doc, C.customer, C.products, C.amount, { key: 'valid_until', label: 'Expired On', kind: 'date' }, { key: 'days', label: 'Days Over', kind: 'num' }, { key: 'status', label: 'Status', kind: 'badge' }, C.sp],
    build: ({ q }) => q.filter((x) => x.isExpired).map((x) => ({ ...base(x), status: x.status, valid_until: x.validUntil, days: x.validUntil ? daysBetween(x.validUntil) : 0 })),
  },
  {
    id: 'quotation-ageing', title: 'Quotation Ageing', group: 'Management', uses: 'q',
    note: 'Quotations still waiting, by how long ago they were sent (or made, if not sent yet). Each amount sits in its age band.',
    cols: [C.doc, C.customer, C.status, { key: 'age', label: 'Age (days)', kind: 'num' },
      ...AGE_BUCKETS.map((b): SalesCol => ({ key: b.key, label: b.label + ' (₹)', kind: 'money', secret: 'sales_rates', total: true }))],
    build: ({ q }) =>
      q.filter((x) => ['Pending Approval', 'Approved', 'Sent'].includes(x.status)).map((x) => {
        const age = daysBetween(x.sentAt ?? x.qtDate);
        const b = bucketOf(age);
        return { doc_no: x.docNo, customer: x.customer, status: x.displayStatus, age, ...Object.fromEntries(AGE_BUCKETS.map((k) => [k.key, k.key === b.key ? x.amount : null])) };
      }).sort((a, b) => Number(b.age) - Number(a.age)),
  },
  {
    id: 'monthly-analysis', title: 'Monthly Analysis', group: 'Management', uses: 'q', chart: 'monthly',
    note: 'Quotations by month: how many were made, their value, and how many were won or lost.',
    cols: [{ key: 'month', label: 'Month' }, { key: 'quotations', label: 'Quotations', kind: 'num', total: true }, C.amount,
      { key: 'won_value', label: 'Won Value (₹)', kind: 'money', secret: 'sales_rates', total: true }, { key: 'lost_value', label: 'Lost Value (₹)', kind: 'money', secret: 'sales_rates', total: true },
      { key: 'pending_value', label: 'Pending Value (₹)', kind: 'money', secret: 'sales_rates', total: true },
      { key: 'won', label: 'Won', kind: 'num', total: true }, { key: 'lost', label: 'Lost', kind: 'num', total: true }, { key: 'pending', label: 'Pending', kind: 'num', total: true }, { key: 'conversion', label: 'Conversion %', kind: 'pct' },
      { key: 'margin', label: 'Avg Margin %', kind: 'pct', secret: 'margins' }],
    build: ({ q }) => {
      const m = new Map<string, QuotationRow[]>();
      for (const x of q.filter((r) => r.status !== 'Draft')) m.set(monthKey(x.qtDate), [...(m.get(monthKey(x.qtDate)) ?? []), x]);
      return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, qs]) => {
        const won = qs.filter((x) => x.status === 'Won').length;
        const w = weightedMargin(qs);
        return {
          month: monthLabel(k), quotations: qs.length, amount: sum(qs.map((x) => x.amount)), won, lost: qs.filter((x) => x.status === 'Lost').length,
          won_value: sum(qs.filter((x) => x.status === 'Won').map((x) => x.amount)), lost_value: sum(qs.filter((x) => x.status === 'Lost').map((x) => x.amount)),
          pending_value: sum(qs.filter((x) => ['Pending Approval', 'Approved', 'Sent'].includes(x.status)).map((x) => x.amount)),
          pending: qs.filter((x) => ['Pending Approval', 'Approved', 'Sent'].includes(x.status)).length, conversion: r2((won / qs.length) * 100), margin: w == null ? null : r2(w),
        };
      });
    },
  },

  // ------------------------------------------------------------------ Sales
  {
    id: 'followup-report', title: 'Follow-up Report', group: 'Sales', uses: 'q',
    note: 'Approved and sent quotations: when the customer was last contacted and when the next follow-up is due.',
    cols: [C.doc, C.customer, C.products, C.amount, { key: 'sent', label: 'Sent On', kind: 'date' }, { key: 'days', label: 'Days Waiting', kind: 'num' },
      { key: 'count', label: 'Follow-ups', kind: 'num' }, { key: 'last', label: 'Last Follow-up', kind: 'date' }, { key: 'next', label: 'Next Follow-up', kind: 'date' }, { key: 'due', label: 'Follow-up' }, C.sp],
    build: ({ q }) =>
      q.filter((x) => ['Approved', 'Sent'].includes(x.status)).map((x) => ({
        ...base(x), sent: x.sentAt, days: x.daysPending ?? 0, count: x.followupCount, last: x.lastFollowup, next: x.nextFollowup,
        due: x.nextFollowup ? (x.nextFollowup < today() ? 'Overdue' : 'Scheduled') : x.status === 'Sent' ? 'Not scheduled' : '',
      })),
  },
  {
    id: 'conversion-report', title: 'Quotation Conversion', group: 'Sales', uses: 'q',
    note: 'Sent quotations and what the customer decided, with the sales order created from a won one.',
    cols: [C.doc, C.customer, C.products, C.amount, { key: 'sent', label: 'Sent On', kind: 'date' }, { key: 'responded', label: 'Responded On', kind: 'date' },
      { key: 'response', label: 'Response' }, { key: 'days', label: 'Days to Respond', kind: 'num' }, { key: 'order', label: 'Sales Order' }, C.sp],
    build: ({ q }) =>
      q.filter((x) => ['Sent', 'Won', 'Lost'].includes(x.status)).map((x) => ({
        ...base(x), sent: x.sentAt, responded: x.responseDate, response: resp(x),
        days: x.responseDate && x.sentAt ? Math.max(0, daysBetween(x.sentAt, new Date(x.responseDate + 'T00:00:00'))) : null, order: x.orderNo ?? '',
      })),
  },
  {
    id: 'salesperson-wise', title: 'Salesperson-wise', group: 'Sales', uses: 'q',
    cols: groupCols('Salesperson', 'salesperson'),
    build: ({ q }) => groupQ(q.filter((x) => x.status !== 'Draft'), (x) => x.salesperson, 'salesperson'),
  },
  {
    id: 'lost-quotations', title: 'Lost Quotations', group: 'Sales', uses: 'q',
    note: 'Why quotations were lost.',
    cols: [C.doc, C.customer, C.products, C.amount, { key: 'reason', label: 'Reason Lost' }, { key: 'note', label: 'Note' }, { key: 'responded', label: 'Date', kind: 'date' }, C.sp],
    build: ({ q }) => q.filter((x) => x.status === 'Lost').map((x) => ({ ...base(x), reason: x.lostReason ?? '', note: x.responseNote ?? '', responded: x.responseDate })),
  },

  // --------------------------------------------------------------- Customer
  {
    id: 'customer-wise', title: 'Customer-wise', group: 'Customer', uses: 'q', needs: ['party_names'],
    cols: groupCols('Customer', 'customer'),
    build: ({ q }) => groupQ(q.filter((x) => x.status !== 'Draft'), (x) => x.customer, 'customer'),
  },
  {
    id: 'customer-price-history', title: 'Customer Price History', group: 'Customer', uses: 'history', needs: ['party_names', 'sales_rates'],
    note: 'The net rate each customer was quoted for each product, with the rate before it.',
    cols: [{ key: 'customer', label: 'Customer' }, { key: 'product', label: 'Product' }, { key: 'spec', label: 'Grade / Size' }, C.doc, C.date,
      { key: 'rate', label: 'Net Rate (₹)', kind: 'money' }, { key: 'previous', label: 'Previous Rate (₹)', kind: 'money' }, { key: 'change', label: 'Change %', kind: 'pct' }],
    build: ({ history }) =>
      [...history].sort((a, b) => a.customer.localeCompare(b.customer) || a.product.localeCompare(b.product) || b.qtDate.localeCompare(a.qtDate)).map((h) => ({
        customer: h.customer, product: h.product, spec: [h.grade, h.size].filter(Boolean).join(' • '), doc_no: h.docNo, date: h.qtDate, rate: h.rate, previous: h.previousRate,
        change: h.rate != null && h.previousRate ? r2(((h.rate - h.previousRate) / h.previousRate) * 100) : null,
      })),
  },

  // ---------------------------------------------------------------- Product
  {
    id: 'product-wise', title: 'Product-wise', group: 'Product', uses: 'items',
    note: 'Lines of submitted quotations, grouped by product.',
    cols: [{ key: 'product', label: 'Product' }, { key: 'quotations', label: 'Quotations', kind: 'num', total: true }, { key: 'qty', label: 'Qty Quoted', kind: 'num', total: true },
      { key: 'avg_rate', label: 'Avg Net Rate (₹)', kind: 'money', secret: 'sales_rates' }, { key: 'value', label: 'Value (₹)', kind: 'money', secret: 'sales_rates', total: true },
      { key: 'won_qty', label: 'Qty Won', kind: 'num', total: true }, { key: 'margin', label: 'Margin %', kind: 'pct', secret: 'margins' }],
    build: ({ items }) => {
      const m = new Map<string, ItemRow[]>();
      for (const i of items.filter((x) => x.status !== 'Draft')) m.set(i.product, [...(m.get(i.product) ?? []), i]);
      return [...m.entries()].map(([product, ls]) => {
        const qty = sum(ls.map((l) => l.qty));
        const value = sum(ls.map((l) => l.amount));
        const costed = ls.filter((l) => l.unitCost != null && l.amount != null);
        const cAmount = sum(costed.map((l) => l.amount));
        const cCost = sum(costed.map((l) => l.qty * (l.unitCost ?? 0)));
        return {
          product, quotations: new Set(ls.map((l) => l.quotationId)).size, qty, avg_rate: qty ? r2(value / qty) : null, value,
          won_qty: sum(ls.filter((l) => l.status === 'Won').map((l) => l.qty)), margin: cAmount > 0 ? r2(((cAmount - cCost) / cAmount) * 100) : null,
        };
      }).sort((a, b) => Number(b.value) - Number(a.value));
    },
  },
  {
    id: 'rate-comparison', title: 'Rate Comparison', group: 'Product', uses: 'history', needs: ['sales_rates'],
    note: 'For each product: the lowest, highest and average net rate quoted, and the latest one.',
    cols: [{ key: 'product', label: 'Product' }, { key: 'times', label: 'Times Quoted', kind: 'num', total: true }, { key: 'min', label: 'Lowest (₹)', kind: 'money' }, { key: 'max', label: 'Highest (₹)', kind: 'money' },
      { key: 'avg', label: 'Average (₹)', kind: 'money' }, { key: 'latest', label: 'Latest (₹)', kind: 'money' }, { key: 'latest_on', label: 'Latest On', kind: 'date' },
      { key: 'latest_customer', label: 'Latest Customer', secret: 'party_names' }],
    build: ({ history }) => {
      const m = new Map<string, PriceHistoryRow[]>();
      for (const h of history.filter((x) => x.rate != null)) m.set(h.product, [...(m.get(h.product) ?? []), h]);
      return [...m.entries()].map(([product, hs]) => {
        const rates = hs.map((h) => h.rate as number);
        const last = [...hs].sort((a, b) => b.qtDate.localeCompare(a.qtDate))[0];
        return { product, times: hs.length, min: Math.min(...rates), max: Math.max(...rates), avg: r2(sum(rates) / rates.length), latest: last.rate, latest_on: last.qtDate, latest_customer: last.customer };
      }).sort((a, b) => String(a.product).localeCompare(String(b.product)));
    },
  },

  // ---------------------------------------------------------- Profitability
  {
    id: 'margin-report', title: 'Profitability / Margin', group: 'Profitability', uses: 'q', needs: ['margins'],
    note: 'Gross margin % = (net rate − cost) ÷ net rate × 100. Red-flagged ones are below the minimum margin.',
    cols: [C.doc, C.date, C.customer, C.products, C.amount, { key: 'cost', label: 'Cost (₹)', kind: 'money', total: true }, { key: 'profit', label: 'Profit (₹)', kind: 'money', total: true }, C.margin,
      { key: 'min', label: 'Minimum %', kind: 'pct' }, { key: 'flag', label: 'Below Min?' }, C.status],
    build: ({ q }) =>
      q.filter((x) => PIPELINE.includes(x.status) || x.status === 'Rejected').map((x) => ({
        ...base(x), cost: x.costTotal, profit: x.profit, min: x.minMargin, flag: x.belowMin == null ? '' : x.belowMin ? 'Yes' : 'No',
      })),
  },
];

export const REPORT_BY_ID = Object.fromEntries(SALES_REPORTS.map((r) => [r.id, r])) as Record<string, SalesReportDef>;
