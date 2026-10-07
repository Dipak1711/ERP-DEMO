// ---------------------------------------------------------------------------
// Demo seed — replays ~2 weeks of plant history through the real engine so that
// every seeded quantity obeys the same rules as live clicks. Timestamps are
// relative to "now", so the dashboard always shows today's activity.
// ---------------------------------------------------------------------------
import {
  addInward,
  completeQC,
  completeStage,
  createDispatch,
  createJob,
  materialKey,
  startStage,
} from './engine';
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

export const SUPPLIERS = ['ABC Metals', 'XYZ Metals', 'PQR Industries', 'Shree Steel Traders', 'Mahalaxmi Alloys'];
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

type Ev = { at: Date; run: (s: ERPState, ts: string) => void };

export function buildSeed(now = new Date()): ERPState {
  const s = emptyState();
  const events: Ev[] = [];
  /** time `days` ago at hh:mm (local) — capped so nothing is in the future */
  // Today's scripted events run up to 12:15. If the demo is opened earlier in the
  // day they are pulled back (1 scripted minute = 1 real minute before now) so they
  // stay in the past and keep their relative order.
  const LAST_TODAY = 12 * 60 + 15;
  const at = (days: number, hh: number, mm = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    d.setHours(hh, mm, 0, 0);
    if (days === 0) {
      const latest = now.getTime() - (5 + LAST_TODAY - (hh * 60 + mm)) * 60_000;
      return new Date(Math.min(d.getTime(), latest));
    }
    return d;
  };
  const dateOnly = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ev = (when: Date, run: Ev['run']) => events.push({ at: when, run });

  // ---- Raw material inward (FIFO: two brass lots of different age) -------
  const inward = (days: number, m: string, t: string, od: number, sup: string, qty: number, kg: number, heat: string) =>
    ev(at(days, 10), (st, ts) =>
      addInward(st, { material: m, materialType: t, od, supplier: sup, inwardDate: dateOnly(at(days, 10)), qty, weight: kg, heatNo: heat }, ts),
    );
  inward(20, 'EN8 Steel Round Bar', 'Carbon Steel EN8', 50, 'Shree Steel Traders', 600, 168, 'H-24817');
  inward(18, 'Brass Round Bar', 'Brass CW614N', 45, 'ABC Metals', 450, 51.75, 'H-B3301');
  inward(16, 'Copper Round Bar', 'Copper ETP C11000', 30, 'XYZ Metals', 750, 217.5, 'H-C1190');
  inward(15, 'Aluminium Round Bar', 'Aluminium 6061', 25, 'PQR Industries', 650, 62.4, 'H-A6061');
  inward(8, 'Brass Round Bar', 'Brass CW614N', 45, 'ABC Metals', 1000, 115, 'H-B3342');
  inward(2, 'EN8 Steel Round Bar', 'Carbon Steel EN8', 50, 'Shree Steel Traders', 400, 112, 'H-24903');

  // ---- helper to script one job's journey --------------------------------
  type Step = { stage: 'cutting' | 'forging' | 'trimming' | 'heatTreatment'; start: Date; end?: Date; loss?: number; machine: string; operator: string; params?: Record<string, string | number> };
  const job = (
    created: Date,
    productId: string,
    qty: number,
    customer: string,
    priority: 'Normal' | 'High' | 'Urgent',
    steps: Step[],
    qc?: { at: Date; accepted: number; rejected: number; reason?: string; inspector: string },
  ) => {
    const p = PRODUCTS.find((x) => x.id === productId)!;
    let jobNo = '';
    ev(created, (st, ts) => {
      const due = new Date(created);
      due.setDate(due.getDate() + 14);
      jobNo = createJob(
        st,
        { productId, customer, plannedQty: qty, materialKey: materialKey(p.material, p.od), cuttingLength: p.cuttingLength, dueDate: dateOnly(due), priority },
        ts,
      );
    });
    for (const step of steps) {
      ev(step.start, (st, ts) =>
        startStage(st, step.stage, jobNo, { machine: step.machine, operator: step.operator, params: step.params }, ts),
      );
      if (step.end) ev(step.end, (st, ts) => completeStage(st, step.stage, jobNo, { loss: step.loss ?? 0 }, ts));
    }
    if (qc)
      ev(qc.at, (st, ts) =>
        completeQC(st, jobNo, { accepted: qc.accepted, rejected: qc.rejected, rejectionReason: qc.reason, inspector: qc.inspector, checks: { dimensional: true, visual: true, hardness: true }, remarks: 'Inspected as per control plan' }, ts),
      );
    return () => jobNo;
  };

  // JOB-0001 — 9084 Flange, full journey through Dispatch (the traceability showcase)
  const j1 = job(at(12, 9), 'P-9084', 100, 'ABC Industries', 'High', [
    { stage: 'cutting', start: at(12, 10), end: at(12, 15), loss: 2, machine: 'Bandsaw BS-01', operator: 'Ramesh Patil' },
    { stage: 'forging', start: at(11, 9), end: at(11, 16), loss: 0, machine: 'Friction Screw Press FP-400T', operator: 'Suresh Jadhav' },
    { stage: 'trimming', start: at(10, 10), end: at(10, 14), loss: 1, machine: 'Trim Press TP-01', operator: 'Imran Shaikh' },
    { stage: 'heatTreatment', start: at(9, 8), end: at(9, 17), loss: 2, machine: 'Furnace F-01 (Box)', operator: 'Vijay Pawar' },
  ], { at: at(8, 11), accepted: 94, rejected: 1, reason: 'Surface crack on flange face', inspector: INSPECTORS[0] });

  // JOB-0002 — 9084 Flange, in Finished Goods, partly dispatched + one lot packed
  const j2 = job(at(10, 11), 'P-9084', 250, 'Nova Hydraulics', 'Normal', [
    { stage: 'cutting', start: at(10, 12), end: at(10, 18), loss: 3, machine: 'Bandsaw BS-02', operator: 'Anil More' },
    { stage: 'forging', start: at(9, 9), end: at(8, 15), loss: 1, machine: 'Friction Screw Press FP-400T', operator: 'Suresh Jadhav' },
    { stage: 'trimming', start: at(7, 9), end: at(7, 16), loss: 2, machine: 'Trim Press TP-02', operator: 'Imran Shaikh' },
    { stage: 'heatTreatment', start: at(6, 8), end: at(5, 12), loss: 2, machine: 'Furnace F-01 (Box)', operator: 'Vijay Pawar' },
  ], { at: at(4, 15), accepted: 240, rejected: 2, reason: 'Under-filled flange OD', inspector: INSPECTORS[1] });

  // JOB-0003 — Aluminium, waiting at QC
  job(at(7, 10), 'P-AL25', 120, 'Apex Auto Components', 'Normal', [
    { stage: 'cutting', start: at(7, 11), end: at(7, 16), loss: 1, machine: 'Circular Saw CS-01', operator: 'Kiran Desai' },
    { stage: 'forging', start: at(6, 9), end: at(5, 17), loss: 2, machine: 'Hydraulic Press HP-250T', operator: 'Suresh Jadhav' },
    { stage: 'trimming', start: at(3, 10), end: at(3, 15), loss: 1, machine: 'Trim Press TP-01', operator: 'Imran Shaikh' },
    { stage: 'heatTreatment', start: at(1, 8), end: at(1, 18), loss: 1, machine: 'Continuous Furnace CF-01', operator: 'Vijay Pawar' },
  ]);

  // JOB-0004 — Brass Bush, received at Heat Treatment (pending)
  job(at(6, 9), 'P-BB45', 300, 'Sigma Valves Pvt. Ltd.', 'High', [
    { stage: 'cutting', start: at(6, 10), end: at(5, 11), loss: 5, machine: 'Bandsaw BS-01', operator: 'Ramesh Patil' },
    { stage: 'forging', start: at(4, 9), end: at(3, 17), loss: 2, machine: 'Power Hammer PH-01', operator: 'Anil More' },
    { stage: 'trimming', start: at(2, 9), end: at(1, 16), loss: 3, machine: 'Trim Press TP-02', operator: 'Imran Shaikh' },
  ]);

  // JOB-0005 — Brass Bush, forging in progress
  job(at(4, 14), 'P-BB45', 200, 'Sigma Valves Pvt. Ltd.', 'Normal', [
    { stage: 'cutting', start: at(3, 9), end: at(2, 12), loss: 4, machine: 'Bandsaw BS-02', operator: 'Ramesh Patil' },
    { stage: 'forging', start: at(0, 8, 30), machine: 'Friction Screw Press FP-400T', operator: 'Suresh Jadhav' },
  ]);

  // JOB-0006 — Aluminium, trimming in progress
  job(at(3, 15), 'P-AL25', 80, 'Apex Auto Components', 'Urgent', [
    { stage: 'cutting', start: at(2, 9), end: at(2, 13), loss: 0, machine: 'Circular Saw CS-01', operator: 'Kiran Desai' },
    { stage: 'forging', start: at(1, 9), end: at(1, 15), loss: 1, machine: 'Hydraulic Press HP-250T', operator: 'Anil More' },
    { stage: 'trimming', start: at(0, 9), machine: 'Trim Press TP-01', operator: 'Imran Shaikh' },
  ]);

  // JOB-0007 — Copper, cutting in progress
  job(at(1, 11), 'P-CU30', 150, 'Metro Electricals', 'Normal', [
    { stage: 'cutting', start: at(0, 8), machine: 'Bandsaw BS-02', operator: 'Kiran Desai' },
  ]);

  // JOB-0008 — 9084 Flange, cutting order released (pending)
  job(at(0, 9, 15), 'P-9084', 150, 'ABC Industries', 'Normal', []);

  // ---- Dispatches ---------------------------------------------------------
  const fgOf = (st: ERPState, jobNo: string) => st.finishedGoods.find((f) => f.jobNo === jobNo)!.id;
  ev(at(6, 16), (st, ts) =>
    createDispatch(st, { fgId: fgOf(st, j1()), customer: 'ABC Industries', qty: 94, vehicleNo: 'GJ05AB1234', driver: 'Mahesh Yadav', date: dateOnly(at(6, 16)), bagCount: 10, weight: 23.209, status: 'Dispatched' }, ts),
  );
  ev(at(0, 11, 30), (st, ts) =>
    createDispatch(st, { fgId: fgOf(st, j2()), customer: 'Nova Hydraulics', qty: 100, vehicleNo: 'MH12QW4521', driver: 'Sandeep Gaikwad', date: dateOnly(at(0, 11)), bagCount: 10, weight: 24.69, status: 'Dispatched' }, ts),
  );
  ev(at(0, 12, 15), (st, ts) =>
    createDispatch(st, { fgId: fgOf(st, j2()), customer: 'Nova Hydraulics', qty: 60, vehicleNo: '', date: dateOnly(at(0, 12)), bagCount: 6, weight: 14.814, status: 'Ready for Dispatch' }, ts),
  );

  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const e of events) e.run(s, e.at.toISOString());
  return s;
}
