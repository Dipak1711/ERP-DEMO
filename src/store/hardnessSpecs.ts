// ---------------------------------------------------------------------------
// Required hardness by material grade — drives the auto-filled range on the
// Hardness Inspection Report. Only Aluminium, Brass and Copper are reported.
//
// AA 6082-T6 (80–90 HRB) is the range printed on the client's paper report.
// The other ranges are typical placeholders — confirm them with the client and
// edit the numbers here; nothing else needs to change.
// ---------------------------------------------------------------------------
import { MATERIAL_MASTER, findMaterial } from './materials';
import type { HardnessScale } from './types';

export const HARDNESS_MATERIALS = ['Aluminium', 'Brass', 'Copper'] as const;
export type HardnessMaterial = (typeof HARDNESS_MATERIALS)[number];

export interface HardnessRange {
  min: number;
  max: number;
  scale: HardnessScale;
}

/** Keyed by the raw-material master's `material` name. */
const RANGE: Record<string, HardnessRange> = {
  'Aluminium Round Bar': { min: 55, max: 65, scale: 'HRB' }, // AA 6061-T6
  'Aluminium 6082 Round Bar': { min: 80, max: 90, scale: 'HRB' }, // AA 6082-T6 — from the client's sheet
  'Aluminium 2014 Round Bar': { min: 70, max: 80, scale: 'HRB' }, // AA 2014
  'Brass Round Bar': { min: 60, max: 80, scale: 'HRB' }, // CW614N
  'Forging Brass Round Bar': { min: 55, max: 75, scale: 'HRB' }, // CW617N
  'Copper Round Bar': { min: 35, max: 55, scale: 'HRB' }, // ETP
  'OFHC Copper Round Bar': { min: 30, max: 50, scale: 'HRB' }, // OFHC
};

export interface HardnessGrade extends HardnessRange {
  grade: string;
}

export const hardnessGrades = (family: string): HardnessGrade[] =>
  MATERIAL_MASTER.filter((m) => m.family === family && RANGE[m.material]).map((m) => ({ grade: m.grade, ...RANGE[m.material] }));

export const isHardnessMaterial = (m: string): m is HardnessMaterial => (HARDNESS_MATERIALS as readonly string[]).includes(m);

/** Material family + grade + range for a product's raw material, or null for anything outside the three. */
export function hardnessSpecForRawMaterial(rawMaterial: string) {
  const spec = findMaterial(rawMaterial);
  if (!spec || !isHardnessMaterial(spec.family) || !RANGE[spec.material]) return null;
  return { family: spec.family, grade: spec.grade, ...RANGE[spec.material] };
}
