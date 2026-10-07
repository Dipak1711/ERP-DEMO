// Headless check of the production engine + seed data:  npm run test:engine
import assert from 'node:assert/strict';
import {
  availableFor,
  completeQC,
  completeStage,
  createDispatch,
  createJob,
  fgAvailable,
  jobSummary,
  markDispatched,
  materialKey,
  startStage,
  ERPError,
} from '../src/store/engine';
import { buildSeed } from '../src/store/seed';

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ✓', name);
};
const throws = (fn: () => void, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof ERPError && re.test(e.message));
const ts = () => new Date().toISOString();

const s = buildSeed();

console.log('\nSeed data');
t('8 jobs at parallel stages', () => {
  const stages = s.jobs.map((j) => `${j.jobNo}:${j.currentStage}`);
  console.log('    ', stages.join('  '));
  assert.equal(s.jobs.length, 8);
  assert.deepEqual(
    s.jobs.map((j) => j.currentStage),
    ['dispatched', 'finishedGoods', 'qc', 'heatTreatment', 'forging', 'trimming', 'cutting', 'cutting'],
  );
});
t('JOB-0001 journey 100 → 98 → 98 → 97 → 95 → 94 → dispatched 94', () => {
  const j = jobSummary(s, s.jobs[0].jobNo);
  assert.equal(j.issuedQty, 100);
  assert.deepEqual([j.records.cutting!.input, j.records.cutting!.loss, j.records.cutting!.output], [100, 2, 98]);
  assert.deepEqual([j.records.forging!.input, j.records.forging!.output], [98, 98]);
  assert.deepEqual([j.records.trimming!.input, j.records.trimming!.output], [98, 97]);
  assert.deepEqual([j.records.heatTreatment!.input, j.records.heatTreatment!.output], [97, 95]);
  assert.equal(j.records.heatTreatment!.params.temperature, 850);
  assert.deepEqual([j.qc!.input, j.qc!.accepted, j.qc!.rejected, j.qc!.status], [95, 94, 1, 'Partially Approved']);
  assert.equal(j.dispatchedQty, 94);
  assert.equal(j.status, 'Dispatched');
  assert.equal(j.dispatches[0].dispatchNo.endsWith('-0001'), true);
  assert.equal(j.dispatches[0].bags.length, 10);
});
t('raw stock reduced by issues; FIFO split on brass', () => {
  assert.equal(availableFor(s, materialKey('Copper Round Bar', 30)), 600);
  assert.equal(availableFor(s, materialKey('Aluminium Round Bar', 25)), 450);
  const j5 = s.jobs[4];
  assert.equal(j5.issues.length, 2, 'JOB-0005 should draw from two brass lots');
  assert.equal(j5.issues[0].qty + j5.issues[1].qty, 200);
});
t('FG of JOB-0002: 240 received, 100 dispatched, 60 reserved, 80 available', () => {
  const fg = s.finishedGoods.find((f) => f.jobNo === s.jobs[1].jobNo)!;
  assert.deepEqual([fg.qty, fg.dispatchedQty, fg.reservedQty, fgAvailable(fg)], [240, 100, 60, 80]);
});
t('heat-treatment temperature differs by product', () => {
  const temps = new Set(s.heatTreatment.map((r) => r.params.temperature));
  assert.ok(temps.size >= 3, [...temps].join(','));
});

console.log('\nNew job end-to-end');
const d = structuredClone(s);
const key = materialKey('Copper Round Bar', 30);
const before = availableFor(d, key);
const jobNo = createJob(d, { productId: 'P-CU30', customer: 'Metro Electricals', plannedQty: 100, materialKey: key, cuttingLength: 45, dueDate: '2026-12-01', priority: 'Normal' }, ts());
t('job number auto-generated sequentially', () => assert.match(jobNo, /^JOB-\d{4}-0009$/));
t('raw stock not consumed until cutting starts', () => assert.equal(availableFor(d, key), before));
t('cannot issue more than raw stock', () => throws(() => startStage(d, 'cutting', jobNo, { inputQty: before + 1 }, ts()), /available/));
t('cannot complete forging before cutting', () => throws(() => completeStage(d, 'forging', jobNo, { loss: 0 }, ts()), /no open Forging/));
t('loss cannot exceed input', () => throws(() => completeStage(d, 'cutting', jobNo, { loss: 101 }, ts()), /cannot exceed/));
completeStage(d, 'cutting', jobNo, { loss: 2, inputQty: 100 }, ts());
t('cutting 100 − 2 = 98; raw reduced by 100', () => {
  assert.equal(availableFor(d, key), before - 100);
  assert.equal(d.forging.find((r) => r.jobNo === jobNo)!.input, 98);
  assert.equal(d.jobs.find((j) => j.jobNo === jobNo)!.currentStage, 'forging');
});
t('cutting order no longer open', () => throws(() => completeStage(d, 'cutting', jobNo, { loss: 0 }, ts()), /no open Cutting/));
completeStage(d, 'forging', jobNo, { loss: 0 }, ts());
completeStage(d, 'trimming', jobNo, { loss: 1 }, ts());
completeStage(d, 'heatTreatment', jobNo, { loss: 2, params: { temperature: 610 } }, ts());
t('QC must balance accepted + rejected = input', () =>
  throws(() => completeQC(d, jobNo, { accepted: 95, rejected: 1, inspector: 'x', rejectionReason: 'y', checks: { dimensional: true, visual: true, hardness: true } }, ts()), /must equal/));
const fgBefore = d.finishedGoods.reduce((t2, f) => t2 + fgAvailable(f), 0);
completeQC(d, jobNo, { accepted: 94, rejected: 1, inspector: 'x', rejectionReason: 'Dent', checks: { dimensional: true, visual: true, hardness: true } }, ts());
const fg = d.finishedGoods.find((f) => f.jobNo === jobNo)!;
t('FG increases by QC accepted (94)', () => assert.equal(d.finishedGoods.reduce((t2, f) => t2 + fgAvailable(f), 0), fgBefore + 94));
t('dispatch cannot exceed FG available', () =>
  throws(() => createDispatch(d, { fgId: fg.id, customer: 'Metro', qty: 95, vehicleNo: 'MH01', date: '2026-10-07', bagCount: 5, weight: 10, status: 'Dispatched' }, ts()), /exceeds/));
const dn = createDispatch(d, { fgId: fg.id, customer: 'Metro', qty: 50, vehicleNo: '', date: '2026-10-07', bagCount: 5, weight: 13.1, status: 'Ready for Dispatch' }, ts());
t('ready-for-dispatch reserves FG', () => assert.deepEqual([fg.reservedQty, fgAvailable(fg)], [50, 44]));
markDispatched(d, dn, 'mh12ab0001', ts());
createDispatch(d, { fgId: fg.id, customer: 'Metro', qty: 44, vehicleNo: 'MH12AB0002', date: '2026-10-07', bagCount: 4, weight: 11.5, status: 'Dispatched' }, ts());
t('FG decreases on dispatch; job closes as Dispatched', () => {
  assert.deepEqual([fg.dispatchedQty, fgAvailable(fg)], [94, 0]);
  const j = jobSummary(d, jobNo);
  assert.equal(j.status, 'Dispatched');
  assert.equal(j.totalLoss, 6);
  assert.equal(j.yieldPct, 94);
});
t('seed state untouched by draft mutations', () => assert.equal(s.jobs.length, 8));

console.log(`\n${passed} checks passed\n`);
