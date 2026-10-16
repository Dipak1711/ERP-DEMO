import { useEffect, useState } from 'react';
import { supabase } from '../db/client';

export type UnitKind = 'quantity' | 'weight' | 'length' | 'time';

export interface Unit {
  code: string;
  name: string;
  kind: UnitKind;
  /** how many reference units (PCS / KG / mm / min) one of these holds */
  factor: number;
  active: boolean;
  sort: number;
}

/** The kinds, with the reference unit each one is measured against. */
export const KINDS: { kind: UnitKind; label: string; ref: string; example: string }[] = [
  { kind: 'quantity', label: 'Quantity', ref: 'PCS', example: 'BOX = 50 PCS' },
  { kind: 'weight', label: 'Weight', ref: 'KG', example: 'TON = 1000 KG' },
  { kind: 'length', label: 'Length / size', ref: 'mm', example: 'm = 1000 mm' },
  { kind: 'time', label: 'Time', ref: 'min', example: 'hr = 60 min' },
];
/** The reference units cannot be deleted or switched off — the rest of the app counts in them. */
export const REFERENCE_UNITS = KINDS.map((k) => k.ref);

/** What the app uses until the list is loaded, or when migration 22 has not been run: only the reference units (no pickers). */
const BASE: Unit[] = [
  { code: 'PCS', name: 'Pieces', kind: 'quantity', factor: 1, active: true, sort: 1 },
  { code: 'KG', name: 'Kilogram', kind: 'weight', factor: 1, active: true, sort: 10 },
  { code: 'mm', name: 'Millimetre', kind: 'length', factor: 1, active: true, sort: 20 },
  { code: 'min', name: 'Minute', kind: 'time', factor: 1, active: true, sort: 30 },
];

let cache: Unit[] | null = null;
let loading = false;
const subs = new Set<() => void>();

type Row = { code: string; name: string; kind: UnitKind; factor: number | string; active: boolean; sort: number };

async function fetchUnits() {
  if (loading) return;
  loading = true;
  const { data, error } = await supabase.from('units').select('code, name, kind, factor, active, sort').order('sort').order('code');
  loading = false;
  cache = error || !data?.length ? BASE : (data as Row[]).map((u) => ({ code: u.code, name: u.name, kind: u.kind, factor: Number(u.factor), active: u.active, sort: u.sort }));
  subs.forEach((f) => f());
}

/** Forget the list (on sign-in / sign-out) so the next person loads their own. */
export const resetUnits = () => {
  cache = null;
};

/** The units list from Settings → Units, shared by every number box. */
export function useUnits() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    if (!cache) void fetchUnits();
    return () => {
      subs.delete(f);
    };
  }, []);
  const all = cache ?? BASE;
  return {
    /** every unit, including switched-off ones (the Settings page) */
    all,
    reload: fetchUnits,
    /** find a unit by the text a number box shows after its value ("kg" and "KG" are the same) */
    find: (code: string) => all.find((u) => u.code.toLowerCase() === code.toLowerCase()),
    /** the units a number box measured in `code` can offer: every switched-on unit of its kind, plus its own */
    optionsFor: (code: string): Unit[] => {
      const own = all.find((u) => u.code.toLowerCase() === code.toLowerCase());
      if (!own) return [];
      return all.filter((u) => u.kind === own.kind && (u.active || u.code === own.code));
    },
  };
}
