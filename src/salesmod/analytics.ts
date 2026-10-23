import type { QuotationRow } from './types';

/** quotations that went through approval (the pipeline the Director tracks) */
export const PIPELINE = ['Pending Approval', 'Approved', 'Sent', 'Won', 'Lost'];

export const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

/** value-weighted gross margin of the quotations that have a cost; null when none has */
export function weightedMargin(rows: QuotationRow[]): number | null {
  const withCost = rows.filter((r) => r.marginPct != null && r.amount != null && r.profit != null && r.amount > 0);
  const amount = sum(withCost.map((r) => r.amount));
  return amount > 0 ? (sum(withCost.map((r) => r.profit)) / amount) * 100 : null;
}

export function dashboardStats(rows: QuotationRow[]) {
  const by = (s: string) => rows.filter((r) => r.status === s);
  const pipeline = rows.filter((r) => PIPELINE.includes(r.status));
  const submitted = rows.filter((r) => r.status !== 'Draft');
  const won = by('Won');
  const lost = by('Lost');
  return {
    pendingApproval: by('Pending Approval'),
    approved: rows.filter((r) => ['Approved', 'Sent', 'Won', 'Lost'].includes(r.status)),
    rejected: by('Rejected'),
    pendingResponse: by('Sent'),
    won,
    lost,
    expired: rows.filter((r) => r.isExpired),
    pipeline,
    submitted,
    totalValue: sum(pipeline.map((r) => r.amount)),
    /** quotations that are out with the customer (approved or sent, not expired): what could still be won */
    expected: sum(rows.filter((r) => (r.status === 'Approved' || r.status === 'Sent') && !r.isExpired).map((r) => r.amount)),
    avgMargin: weightedMargin(pipeline),
    conversion: submitted.length ? (won.length / submitted.length) * 100 : null,
  };
}

export const monthKey = (iso: string) => iso.slice(0, 7);
export const monthLabel = (key: string) => new Date(key + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
export const daysBetween = (fromIso: string, to = new Date()) => Math.floor((to.getTime() - new Date(fromIso.slice(0, 10) + 'T00:00:00').getTime()) / 86400000);

export const AGE_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: 'b0', label: '0–7 days', min: 0, max: 7 },
  { key: 'b1', label: '8–15 days', min: 8, max: 15 },
  { key: 'b2', label: '16–30 days', min: 16, max: 30 },
  { key: 'b3', label: '31–60 days', min: 31, max: 60 },
  { key: 'b4', label: '60+ days', min: 61, max: Infinity },
];
export const bucketOf = (days: number) => AGE_BUCKETS.find((b) => days >= b.min && days <= b.max) ?? AGE_BUCKETS[0];
