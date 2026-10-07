// ---------------------------------------------------------------------------
// Starting data — master lists only: products, raw-material categories,
// customers, suppliers, machines, operators and inspectors.
// There is NO raw-material stock and there are NO jobs: every inward, job,
// stage entry, QC result, finished good and dispatch is entered by the user,
// so the full flow and every calculation can be checked from the first inward.
// ---------------------------------------------------------------------------
import type { ERPState, Product } from './types';

export const PRODUCTS: Product[] = [
  {
    id: 'P-9084',
    code: '9084',
    name: '9084 Flange',
    material: 'EN8 Steel Round Bar',
    od: 50,
    cuttingLength: 62,
    finishedWeight: 0.2469,
    htTemperature: 850,
    htSoakMinutes: 60,
    htProcess: 'Normalising',
    htQuench: 'Still air',
    dieNo: 'D-9084-01',
    defaultCustomer: 'ABC Industries',
  },
  {
    id: 'P-BB45',
    code: 'BB-45',
    name: 'Brass Bush',
    material: 'Brass Round Bar',
    od: 45,
    cuttingLength: 38,
    finishedWeight: 0.105,
    htTemperature: 550,
    htSoakMinutes: 45,
    htProcess: 'Stress-relief annealing',
    htQuench: 'Still air',
    dieNo: 'D-BB45-02',
    defaultCustomer: 'Sigma Valves Pvt. Ltd.',
  },
  {
    id: 'P-CU30',
    code: 'CU-30',
    name: 'Copper Component',
    material: 'Copper Round Bar',
    od: 30,
    cuttingLength: 45,
    finishedWeight: 0.262,
    htTemperature: 600,
    htSoakMinutes: 40,
    htProcess: 'Annealing',
    htQuench: 'Water quench',
    dieNo: 'D-CU30-03',
    defaultCustomer: 'Metro Electricals',
  },
  {
    id: 'P-AL25',
    code: 'AL-25',
    name: 'Aluminium Forged Component',
    material: 'Aluminium Round Bar',
    od: 25,
    cuttingLength: 70,
    finishedWeight: 0.086,
    htTemperature: 530,
    htSoakMinutes: 60,
    htProcess: 'Solution treatment (T6)',
    htQuench: 'Water quench',
    dieNo: 'D-AL25-04',
    defaultCustomer: 'Apex Auto Components',
  },
];

export const SUPPLIERS = ['ABC Metals', 'XYZ Metals', 'PQR Industries', 'Shree Steel Traders', 'Mahalaxmi Alloys', 'Shakti Stainless Traders', 'Om Alloys & Metals'];
export const CUSTOMERS = [
  'ABC Industries',
  'Sigma Valves Pvt. Ltd.',
  'Metro Electricals',
  'Apex Auto Components',
  'Nova Hydraulics',
];
export const MACHINES = {
  cutting: ['Bandsaw BS-01', 'Bandsaw BS-02', 'Circular Saw CS-01'],
  forging: ['Friction Screw Press FP-400T', 'Hydraulic Press HP-250T', 'Power Hammer PH-01'],
  trimming: ['Trim Press TP-01', 'Trim Press TP-02'],
  heatTreatment: ['Furnace F-01 (Box)', 'Furnace F-02 (Pit)', 'Continuous Furnace CF-01'],
};
export const OPERATORS = ['Ramesh Patil', 'Suresh Jadhav', 'Imran Shaikh', 'Vijay Pawar', 'Anil More', 'Kiran Desai'];
export const INSPECTORS = ['Priya Kulkarni (QA)', 'Rahul Deshmukh (QA)'];

export function emptyState(): ERPState {
  return {
    products: PRODUCTS.map((p) => ({ ...p })),
    rawMaterials: [],
    rawInwards: [],
    jobs: [],
    cutting: [],
    forging: [],
    trimming: [],
    heatTreatment: [],
    qc: [],
    finishedGoods: [],
    dispatches: [],
    movements: [],
    activity: [],
    counters: { job: 0, dispatch: 0, lot: 0, fg: 0, seq: 0 },
  };
}

/** Starting state: master lists only — no raw-material stock and no jobs. */
export function buildSeed(): ERPState {
  return emptyState();
}
