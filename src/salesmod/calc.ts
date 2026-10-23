import type { QuotationLine } from './types';

const n = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : v);

/** Same arithmetic as the database: net rate = rate − discount; margin % = (net − cost) ÷ net × 100 (on the selling price). */
export function lineCalc(l: QuotationLine) {
  const rate = n(l.rate) ?? 0;
  const net = rate * (1 - (n(l.discountPct) ?? 0) / 100);
  const qty = n(l.qty) ?? 0;
  const unitCost = l.materialCost == null ? null : l.materialCost + (l.processingCost ?? 0) + (l.otherCost ?? 0);
  return {
    net,
    amount: net * qty,
    unitCost,
    cost: unitCost == null ? null : unitCost * qty,
    marginPct: unitCost == null || net <= 0 ? null : ((net - unitCost) / net) * 100,
  };
}

export function totalsCalc(lines: QuotationLine[]) {
  let amount = 0;
  let cost = 0;
  let full = lines.length > 0;
  let discount = 0;
  for (const l of lines) {
    const c = lineCalc(l);
    amount += c.amount;
    discount += (n(l.qty) ?? 0) * (n(l.rate) ?? 0) - c.amount;
    if (c.cost == null) full = false;
    else cost += c.cost;
  }
  return { amount, discount, cost: full ? cost : null, profit: full ? amount - cost : null, marginPct: full && amount > 0 ? ((amount - cost) / amount) * 100 : null };
}

export const inr = (v: number | null | undefined, d = 2) => (v == null ? '—' : '₹ ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: d }));
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`);

/** a date n days from today, as yyyy-mm-dd */
export const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
