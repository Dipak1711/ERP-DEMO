// How a supplier's numbers are judged. Everything a manager might want to tune is in this file.
import type { SupplierPerformance } from '../types';

export type Band = 'good' | 'warn' | 'poor' | 'none';

/** Share of the overall score each measure carries (adds up to 100). */
export const SCORE_WEIGHTS = { onTime: 30, quality: 30, price: 20, response: 10, shortage: 10 } as const;

/** Colour thresholds. "higher" measures are good when high (percent); "lower" ones are good when low. */
export const THRESHOLDS = {
  onTimePct: { good: 90, warn: 75, better: 'higher' },
  qualityPct: { good: 95, warn: 85, better: 'higher' },
  rejectionPct: { good: 2, warn: 5, better: 'lower' },
  priceIndex: { good: 1.05, warn: 1.15, better: 'lower' },
  responseHrs: { good: 24, warn: 72, better: 'lower' },
  shortagePct: { good: 2, warn: 5, better: 'lower' },
  score: { good: 85, warn: 70, better: 'higher' },
} as const;

export function band(key: keyof typeof THRESHOLDS, v: number | null | undefined): Band {
  if (v == null) return 'none';
  const t = THRESHOLDS[key];
  if (t.better === 'higher') return v >= t.good ? 'good' : v >= t.warn ? 'warn' : 'poor';
  return v <= t.good ? 'good' : v <= t.warn ? 'warn' : 'poor';
}

export const BAND_BADGE: Record<Band, string> = { good: 'b-green', warn: 'b-amber', poor: 'b-red', none: 'b-neutral' };

export const shortagePct = (p: SupplierPerformance): number | null => (p.shortageBase > 0 ? (p.shortage / p.shortageBase) * 100 : null);

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** Each measure turned into 0–100. null = no data yet (left out of the score instead of counting as zero). */
export function partScores(p: SupplierPerformance): Record<keyof typeof SCORE_WEIGHTS, number | null> {
  const sh = shortagePct(p);
  return {
    onTime: p.onTimePct,
    quality: p.qualityPct,
    price: p.priceIndex == null ? null : clamp(100 - (p.priceIndex - 1) * 200), // 1.00 → 100, 1.50 → 0
    response: p.avgResponseHrs == null ? null : clamp(100 - Math.max(0, p.avgResponseHrs - 24) * (100 / 96)), // ≤ 24 h → 100, ≥ 120 h → 0
    shortage: sh == null ? null : clamp(100 - sh * 10), // 0 % → 100, 10 % → 0
  };
}

/**
 * Weighted score out of 100 over the measures that have data. A supplier is scored only once there is delivery or quality history:
 * price and response alone would make a brand-new supplier look perfect.
 */
export function supplierScore(p: SupplierPerformance): number | null {
  if (p.onTimePct == null && p.qualityPct == null) return null;
  const parts = partScores(p);
  let sum = 0;
  let w = 0;
  for (const k of Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]) {
    const v = parts[k];
    if (v != null) {
      sum += v * SCORE_WEIGHTS[k];
      w += SCORE_WEIGHTS[k];
    }
  }
  return w === 0 ? null : Math.round(sum / w);
}

export const SCORE_TIP = `Score = on-time ${SCORE_WEIGHTS.onTime} + quality ${SCORE_WEIGHTS.quality} + price ${SCORE_WEIGHTS.price} + response ${SCORE_WEIGHTS.response} + shortage ${SCORE_WEIGHTS.shortage} (weights out of 100). A measure with no data yet is left out and the rest are re-weighted. No score is shown until the supplier has delivery or quality history.`;
