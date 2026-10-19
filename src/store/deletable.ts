// Can this record be deleted? Each helper returns null when it can, or the reason it cannot (shown as the tooltip on the greyed-out
// Delete icon). The database enforces the same rules (supabase/migrations/25) — this only saves a round trip and explains why.
import type { Dispatch, ERPState, RawMaterialLot } from './types';

/** an inward lot can go only while none of it has been issued to production */
export const lotDeleteReason = (l: RawMaterialLot): string | null => (l.availableQty < l.inwardQty ? `${l.inwardQty - l.availableQty} PCS of this lot are already issued to production` : null);

/** a job card can go only while it is still waiting at Cutting: nothing issued, nothing entered, no hardness report on it */
export function jobDeleteReason(s: ERPState, jobNo: string): string | null {
  const job = s.jobs.find((j) => j.jobNo === jobNo);
  if (!job) return 'Job card not found';
  const started =
    job.currentStage !== 'cutting' ||
    job.issues.length > 0 ||
    s.cutting.some((r) => r.jobNo === jobNo && r.status !== 'Pending') ||
    [s.forging, s.trimming, s.heatTreatment].some((list) => list.some((r) => r.jobNo === jobNo)) ||
    s.qc.some((r) => r.jobNo === jobNo);
  if (started) return 'This job card has already started in production';
  if (s.hardnessReports.some((h) => h.jobNo === jobNo)) return 'A hardness report is linked to this job card';
  return null;
}

/** a dispatch can go only while it is still packed and waiting for a vehicle */
export const dispatchDeleteReason = (d: Dispatch): string | null => (d.status === 'Ready for Dispatch' ? null : 'This dispatch has already left the plant');

/** a product can go only when no job card was ever made from it */
export function productDeleteReason(s: ERPState, id: string): string | null {
  const n = s.jobs.filter((j) => j.productId === id).length;
  return n ? `Used by ${n} job card${n === 1 ? '' : 's'}` : null;
}

/** a job-work batch can go only before any work has started on it (the skipped-stage rows written on arrival do not count) */
export function jobWorkDeleteReason(s: ERPState, jobNo: string): string | null {
  const job = s.jobs.find((j) => j.jobNo === jobNo);
  if (!job) return 'Job card not found';
  const worked =
    job.issues.length > 0 ||
    [s.cutting, s.forging, s.trimming, s.heatTreatment].some((list) => list.some((r) => r.jobNo === jobNo && r.status !== 'Pending' && !r.params.auto)) ||
    s.qc.some((r) => r.jobNo === jobNo) ||
    s.finishedGoods.some((f) => f.jobNo === jobNo) ||
    s.hardnessReports.some((h) => h.jobNo === jobNo);
  return worked ? 'Work on this batch has already started' : null;
}
