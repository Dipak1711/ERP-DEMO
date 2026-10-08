// ---------------------------------------------------------------------------
// Sample data for client presentations — about a week and a half of plant work,
// entered through the real engine (same rules as live entries), so every
// quantity, FIFO issue and balance is genuine.
//
// JOB-…-0001 copies the client's own paper route card: 1,000 to cut, 1,030
// cut, Trimming not required, packed in 10 bags (100 / 110 PCS) on GJ13AX3059.
// The other jobs are left at different stages so every screen has something.
// ---------------------------------------------------------------------------
import { addInward, completeQC, completeStage, createDispatch, createJob, materialKey } from './engine';
import { findMaterial, pieceWeightKg } from './materials';
import { emptyState, INSPECTORS, MACHINES, OPERATORS } from './seed';
import type { ERPState } from './types';

export function buildSample(now = new Date()): ERPState {
  const s = emptyState();

  // Today's scripted entries run up to 11:30. If the sample is loaded earlier in
  // the day they are pulled back so they stay in the past and keep their order.
  const LAST_TODAY = 11 * 60 + 30;
  const at = (days: number, hh: number, mm = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    d.setHours(hh, mm, 0, 0);
    if (days === 0) return new Date(Math.min(d.getTime(), now.getTime() - (5 + LAST_TODAY - (hh * 60 + mm)) * 60_000)).toISOString();
    return d.toISOString();
  };
  const dateOf = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const inward = (ts: string, material: string, od: number, lengthMm: number, qty: number, supplier: string, heatNo: string, invoiceNo: string) => {
    const spec = findMaterial(material)!;
    const weight = Math.round(pieceWeightKg(od, lengthMm, spec.density) * qty * 1000) / 1000;
    addInward(s, { material, materialType: spec.grade, od, supplier, inwardDate: dateOf(ts), qty, weight, heatNo, invoiceNo }, ts);
  };
  const jobCard = (ts: string, productId: string, qty: number, extra: { machineNo?: string } = {}) => {
    const p = s.products.find((x) => x.id === productId)!;
    const spec = findMaterial(p.material)!;
    return createJob(
      s,
      {
        productId,
        plannedQty: qty,
        materialKey: materialKey(p.material, p.od),
        cuttingLength: p.cuttingLength,
        pieceWeightG: Math.round(pieceWeightKg(p.od, p.cuttingLength, spec.density) * 1000),
        dieNo: p.dieNo,
        machineNo: extra.machineNo,
      },
      ts,
    );
  };
  const stage = (ts: string, st: 'cutting' | 'forging' | 'trimming' | 'heatTreatment', jobNo: string, rejection: number, checkedBy: string, opts: { cutQty?: number; temperature?: number; skip?: boolean } = {}) =>
    completeStage(
      s,
      st,
      jobNo,
      {
        inputQty: opts.cutQty,
        loss: rejection,
        operator: checkedBy,
        remarks: opts.skip ? 'Not required — skipped' : undefined,
        params: opts.temperature ? { temperature: opts.temperature } : opts.skip ? { skipped: 1 } : undefined,
      },
      ts,
    );
  const qc = (ts: string, jobNo: string, rejection: number, checkedBy: string) => {
    const input = s.qc.find((r) => r.jobNo === jobNo)!.input;
    completeQC(s, jobNo, { accepted: input - rejection, rejected: rejection, inspector: checkedBy, checks: { dimensional: true, visual: true, hardness: true } }, ts);
  };
  const dispatch = (ts: string, jobNo: string, vehicleNo: string, bags: [number, number][]) => {
    const fg = s.finishedGoods.find((f) => f.jobNo === jobNo)!;
    createDispatch(s, { fgId: fg.id, vehicleNo, date: dateOf(ts), status: 'Dispatched', bags: bags.map(([qty, weight]) => ({ qty, weight })) }, ts);
  };
  const [ramesh, suresh, imran, vijay, , kiran] = OPERATORS;
  const [priya, rahul] = INSPECTORS;

  // ---- 8 days ago: raw material arrives -------------------------------------
  inward(at(8, 10), 'EN8 Steel Round Bar', 50, 62, 1200, 'Shree Steel Traders', 'H-24817', 'SST/2026/118');
  inward(at(8, 11), 'Brass Round Bar', 45, 38, 800, 'ABC Metals', 'H-B3301', 'ABC/2026/0441');

  // ---- JOB 1 — the client's route card, start to finish ----------------------
  const j1 = jobCard(at(7, 9), 'P-9084', 1000, { machineNo: MACHINES.forging[0] });
  inward(at(7, 11, 30), 'Aluminium Round Bar', 25, 70, 600, 'PQR Industries', 'H-A6061', 'PQR/2026/0098');
  stage(at(7, 15), 'cutting', j1, 0, ramesh, { cutQty: 1030 });
  stage(at(6, 10), 'forging', j1, 0, suresh);

  // ---- JOB 2 — Brass Bush, ends partly dispatched ----------------------------
  const j2 = jobCard(at(6, 12), 'P-BB45', 400, { machineNo: MACHINES.forging[2] });
  stage(at(6, 16), 'cutting', j2, 3, ramesh);
  stage(at(6, 17), 'trimming', j1, 0, imran, { skip: true });

  inward(at(5, 9), 'Copper Round Bar', 30, 45, 500, 'XYZ Metals', 'H-C1190', 'XYZ/2026/0213');
  stage(at(5, 10), 'heatTreatment', j1, 0, vijay, { temperature: 850 });
  stage(at(5, 11), 'forging', j2, 2, suresh);

  // ---- JOB 3 — Aluminium, trimming not required, waits at QC -----------------
  const j3 = jobCard(at(5, 14), 'P-AL25', 300, { machineNo: MACHINES.forging[1] });
  stage(at(5, 16), 'cutting', j3, 2, kiran);

  qc(at(4, 10), j1, 0, priya);
  stage(at(4, 11), 'trimming', j2, 1, imran);
  dispatch(at(4, 15), j1, 'GJ13AX3059', [
    [100, 24.69], [110, 27.23], [110, 27.24], [110, 27.17], [100, 24.82],
    [100, 24.85], [100, 24.75], [100, 24.83], [100, 24.83], [100, 24.67],
  ]);

  stage(at(3, 10), 'forging', j3, 3, suresh);
  stage(at(3, 12), 'heatTreatment', j2, 2, vijay, { temperature: 550 });

  // ---- second EN8 lot, then JOB 4 draws from both lots (FIFO) ----------------
  inward(at(2, 10), 'EN8 Steel Round Bar', 50, 62, 600, 'Shree Steel Traders', 'H-24903', 'SST/2026/131');
  stage(at(2, 11), 'trimming', j3, 0, imran, { skip: true });
  const j4 = jobCard(at(2, 12), 'P-9084', 500, { machineNo: MACHINES.forging[0] });
  qc(at(2, 15), j2, 4, rahul);

  stage(at(1, 9), 'cutting', j4, 4, ramesh);

  // ---- JOB 5 — Copper, waits at Forging ---------------------------------------
  const j5 = jobCard(at(1, 11), 'P-CU30', 250, { machineNo: MACHINES.forging[1] });
  stage(at(1, 14), 'cutting', j5, 2, kiran);
  stage(at(1, 16), 'heatTreatment', j3, 1, vijay, { temperature: 530 });

  // ---- today ---------------------------------------------------------------------
  stage(at(0, 8, 30), 'forging', j4, 2, suresh);
  stage(at(0, 9, 30), 'trimming', j4, 3, imran);
  jobCard(at(0, 10, 15), 'P-BB45', 200, { machineNo: MACHINES.forging[2] }); // JOB 6 — just created, waits at Cutting
  dispatch(at(0, 11, 30), j2, 'MH12QW4521', [
    [100, 10.5],
    [100, 10.52],
  ]);

  return s;
}
