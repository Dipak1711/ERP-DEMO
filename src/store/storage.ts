// ---------------------------------------------------------------------------
// localStorage persistence. Each collection lives under its own key:
//
//   forgeflow.v1.products        forgeflow.v1.qc
//   forgeflow.v1.rawMaterials    forgeflow.v1.finishedGoods
//   forgeflow.v1.rawInwards      forgeflow.v1.dispatches
//   forgeflow.v1.jobs            forgeflow.v1.movements
//   forgeflow.v1.cutting         forgeflow.v1.activity
//   forgeflow.v1.forging         forgeflow.v1.counters
//   forgeflow.v1.trimming        forgeflow.v1.meta   ({ seededAt, version })
//   forgeflow.v1.heatTreatment
//
// VERSION 4 opens with the presentation sample (see sample.ts). A browser still
// holding older data is switched to it automatically. "Clear all data" empties
// everything except the masters; "Load sample data" brings the sample back.
// ---------------------------------------------------------------------------
import { buildSeed, emptyState } from './seed';
import { buildSample } from './sample';
import type { CollectionKey, ERPState } from './types';

const PREFIX = 'forgeflow.v1.';
const VERSION = 4;
const KEYS = Object.keys(emptyState()) as CollectionKey[];

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode — app keeps working in memory */
  }
}

export function loadState(): ERPState {
  const meta = safeGet(PREFIX + 'meta');
  if (meta) {
    try {
      const parsed = JSON.parse(meta) as { version: number };
      if (parsed.version === VERSION) {
        const base = emptyState();
        const s = { ...base } as Record<CollectionKey, unknown>;
        for (const k of KEYS) {
          const raw = safeGet(PREFIX + k);
          if (raw != null) s[k] = JSON.parse(raw);
        }
        return s as unknown as ERPState;
      }
    } catch {
      /* corrupted or older version — fall through to a fresh start */
    }
  }
  return sampleState();
}

/** Writes only the collections whose reference changed. */
export function saveState(next: ERPState, prev?: ERPState) {
  for (const k of KEYS) {
    if (!prev || prev[k] !== next[k]) safeSet(PREFIX + k, JSON.stringify(next[k]));
  }
}

function replaceWith(s: ERPState): ERPState {
  saveState(s);
  safeSet(PREFIX + 'meta', JSON.stringify({ version: VERSION, seededAt: new Date().toISOString() }));
  return s;
}

/** Empty plant: masters only, no stock and no jobs. */
export const resetState = () => replaceWith(buildSeed());

/** Presentation sample: stock, six jobs at different stages, dispatches. */
export const sampleState = () => replaceWith(buildSample());

export function seededAt(): string | null {
  try {
    return (JSON.parse(safeGet(PREFIX + 'meta') ?? '{}') as { seededAt?: string }).seededAt ?? null;
  } catch {
    return null;
  }
}
