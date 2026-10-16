// ---------------------------------------------------------------------------
// Every change the app makes goes through one of these calls. Each is a single database function (supabase/migrations 10–12):
// it validates, writes, updates the ledger and activity feed in ONE transaction, and raises the same error texts the old
// in-browser engine did — so a failed action never half-saves and the toast shows the real reason.
//
// Parameter names (p_…) must match the SQL function signatures exactly.
// ---------------------------------------------------------------------------
import { supabase } from './client';
import { parseMaterialKey } from '../store/engine';
import type { CompleteInput, DispatchInput, HardnessInput, InwardInput, JobInput, QCInput, StartInput } from '../store/engine';
import type { Product, ProcessStage } from '../store/types';
import type { DieInput, MainInput } from '../dies/DieContext';
import type { DieKind, DieStatus } from '../dies/types';

async function call<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  // undefined = "not provided": the function's own default applies
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
  const { data, error } = await supabase.rpc(fn, clean);
  if (error) throw new Error(error.message);
  return data as T;
}

const emptyToNull = (s?: string) => (s && s.trim() ? s : null);

// ---------------------------------------------------------- production ---
export const addInward = (i: InwardInput, ts?: string) =>
  call<string>('add_inward', {
    p_material: i.material,
    p_material_type: i.materialType,
    p_od: i.od,
    p_supplier: i.supplier,
    p_inward_date: i.inwardDate,
    p_qty: i.qty,
    p_weight: i.weight,
    p_heat_no: emptyToNull(i.heatNo),
    p_invoice_no: emptyToNull(i.invoiceNo),
    p_purchase_rate: i.purchaseRate ?? null,
    p_ts: ts,
  });

export const createJob = (i: JobInput, ts?: string) => {
  const { material, od } = parseMaterialKey(i.materialKey);
  return call<string>('create_job', {
    p_product_id: i.productId,
    p_planned_qty: i.plannedQty,
    p_material: material,
    p_od: od,
    p_cutting_length: i.cuttingLength,
    p_customer: emptyToNull(i.customer),
    p_due_date: i.dueDate || null,
    p_priority: i.priority ?? 'Normal',
    p_piece_weight_g: i.pieceWeightG ?? null,
    p_die_no: emptyToNull(i.dieNo),
    p_machine_no: emptyToNull(i.machineNo),
    p_ts: ts,
  });
};

export const startStage = (stage: ProcessStage, jobNo: string, i: StartInput, ts?: string) =>
  call<void>('start_stage', { p_stage: stage, p_job_no: jobNo, p_input_qty: i.inputQty, p_machine: i.machine, p_operator: i.operator, p_params: i.params, p_ts: ts });

export const completeStage = (stage: ProcessStage, jobNo: string, i: CompleteInput, ts?: string) =>
  call<void>('complete_stage', {
    p_stage: stage,
    p_job_no: jobNo,
    p_loss: i.loss,
    p_input_qty: i.inputQty,
    p_machine: i.machine,
    p_operator: i.operator,
    p_remarks: i.remarks,
    p_params: i.params,
    p_ts: ts,
  });

export const completeQC = (jobNo: string, i: QCInput, ts?: string) =>
  call<string | null>('complete_qc', {
    p_job_no: jobNo,
    p_accepted: i.accepted,
    p_rejected: i.rejected,
    p_inspector: i.inspector,
    p_rejection_reason: i.rejectionReason,
    p_remarks: i.remarks,
    p_dimensional: i.checks.dimensional,
    p_visual: i.checks.visual,
    p_hardness: i.checks.hardness,
    p_ts: ts,
  });

export const createDispatch = (i: DispatchInput, ts?: string) =>
  call<string>('create_dispatch', {
    p_fg_id: i.fgId,
    p_vehicle_no: i.vehicleNo ?? '',
    p_date: i.date,
    p_status: i.status,
    p_bags: i.bags?.map((b) => ({ qty: b.qty, weight: b.weight })),
    p_qty: i.qty,
    p_bag_count: i.bagCount,
    p_weight: i.weight,
    p_customer: emptyToNull(i.customer),
    p_driver: emptyToNull(i.driver),
    p_invoice_no: emptyToNull(i.invoiceNo),
    p_ts: ts,
  });

export const markDispatched = (dispatchNo: string, vehicleNo: string, ts?: string) =>
  call<void>('mark_dispatched', { p_dispatch_no: dispatchNo, p_vehicle_no: vehicleNo, p_ts: ts });

export const saveHardnessReport = (i: HardnessInput, ts?: string, id?: string) =>
  call<string>('save_hardness_report', {
    p_payload: {
      job_no: i.jobNo ?? null,
      date: i.date,
      component: i.component,
      material: i.material,
      grade: i.grade,
      supplier: i.supplier,
      inward_qty: i.inwardQty,
      inspected_qty: i.inspectedQty,
      cycle_no: i.cycleNo,
      drawing_no: i.drawingNo,
      checked_by: i.checkedBy,
      scale: i.scale,
      min_hardness: i.min,
      max_hardness: i.max,
      remarks: i.remarks,
      readings: i.readings,
    },
    p_id: id,
    p_ts: ts,
  });

/** New products get an id from their code; an id that is already taken is never reused (the function would overwrite it). */
export const saveProduct = (i: Omit<Product, 'id'>, existing: Product[], id?: string) => {
  const code = i.code.trim();
  if (existing.some((p) => p.code.toLowerCase() === code.toLowerCase() && p.id !== id)) throw new Error(`Product code ${code} already belongs to ${existing.find((p) => p.code.toLowerCase() === code.toLowerCase())!.name}.`);
  let pid = id;
  if (!pid) {
    pid = `P-${code.toUpperCase().replace(/[^A-Z0-9]+/g, '')}`;
    while (existing.some((p) => p.id === pid)) pid += '1';
  }
  return call<string>('save_product', {
    p_payload: {
      id: pid,
      code,
      name: i.name.trim(),
      material: i.material,
      od: i.od,
      cutting_length: i.cuttingLength,
      finished_weight: i.finishedWeight,
      ht_temperature: i.htTemperature,
      ht_soak_minutes: i.htSoakMinutes,
      ht_process: i.htProcess.trim(),
      ht_quench: i.htQuench.trim(),
      die_no: i.dieNo.trim(),
      default_customer: i.defaultCustomer.trim(),
      sales_rate: i.salesRate ?? null,
    },
  });
};

// ----------------------------------------------------------------- dies ---
/** Uploads a picked picture (a down-scaled JPEG data URL) to the private bucket and returns its path. */
export async function uploadDieImage(dataUrl: string, side: 'top' | 'bottom'): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${crypto.randomUUID()}/${side}.jpg`;
  const { error } = await supabase.storage.from('die-images').upload(path, blob, { contentType: blob.type || 'image/jpeg' });
  if (error) throw new Error(`Picture upload failed: ${error.message}`);
  return path;
}

/** Existing pictures are kept by path; a new data URL is uploaded; an empty value removes the picture. */
async function imagePath(url: string, current: string | undefined, side: 'top' | 'bottom') {
  if (!url) return null;
  if (url.startsWith('data:')) return uploadDieImage(url, side);
  return current ?? null;
}

const dieBody = async (i: DieInput, cur?: { topImg?: string; bottomImg?: string }) => ({
  main_code: i.mainCode,
  material: i.material,
  top_l: i.top.l ?? null,
  top_w: i.top.w ?? null,
  top_h: i.top.h ?? null,
  bottom_l: i.bottom.l ?? null,
  bottom_w: i.bottom.w ?? null,
  bottom_h: i.bottom.h ?? null,
  top_weight: i.topWeight ?? null,
  bottom_weight: i.bottomWeight ?? null,
  making_date: i.makingDate,
  maker: i.maker,
  drawing_no: i.drawingNo,
  revision: i.revision,
  top_img_path: await imagePath(i.topUrl, cur?.topImg, 'top'),
  bottom_img_path: await imagePath(i.bottomUrl, cur?.bottomImg, 'bottom'),
  status: i.status,
  remarks: i.remarks,
  location: i.location,
  cost: i.cost ?? null,
  pieces: i.pieces,
});

export const saveMainDie = (i: MainInput, code?: string) =>
  call<string>('save_main_die', {
    p_payload: { name: i.name, part_code: i.partCode, description: i.description, customer: i.customer, metal: i.metal, created_on: i.createdOn, status: i.status, remarks: i.remarks },
    p_code: code,
  });

export const saveDie = async (kind: DieKind, i: DieInput, code?: string, cur?: { topImg?: string; bottomImg?: string }) =>
  call<string>('save_die', { p_kind: kind, p_payload: await dieBody(i, cur), p_code: code });

export const replaceDie = async (kind: DieKind, oldCode: string, i: DieInput, oldStatus: DieStatus, reason: string) =>
  call<string>('replace_die', { p_kind: kind, p_old_code: oldCode, p_payload: await dieBody(i), p_old_status: oldStatus, p_reason: reason });

export const recordMaintenance = (code: string, v: { date: string; remarks: string; status: DieStatus }) =>
  call<number>('record_maintenance', { p_code: code, p_date: v.date, p_remarks: v.remarks, p_status: v.status });

export const issueDie = (code: string, v: { date: string; issuedTo: string; remarks: string }) =>
  call<number>('issue_die', { p_code: code, p_date: v.date, p_issued_to: v.issuedTo, p_remarks: v.remarks });

export const returnDie = (code: string, v: { date: string; pieces: number; remarks: string; status: DieStatus }) =>
  call<void>('return_die', { p_code: code, p_date: v.date, p_pieces: v.pieces, p_remarks: v.remarks, p_status: v.status });

// ------------------------------------------------------ access settings ---
export const saveRoleAccess = (role: string, pages: Record<string, string>, fields: Record<string, boolean>) =>
  call<void>('save_role_access', { p_role: role, p_pages: pages, p_fields: fields });

export const resetRoleAccess = (role: string) => call<void>('reset_role_access', { p_role: role });

export const addProtectedColumns = (keys: string[]) => call<number>('add_protected_columns', { p_keys: keys });
export const removeProtectedColumn = (key: string) => call<void>('remove_protected_column', { p_key: key });

// ------------------------------------------------------- sales & orders ---
/** Create (id undefined) or edit one Sales & Orders record (supabase/migrations/21). Returns its number, e.g. QT-2026-0001. */
export const saveSalesRecord = (kind: string, id: number | undefined, payload: Record<string, string>) =>
  call<string>('save_sales_record', { p_kind: kind, p_id: id ?? null, p_payload: payload });
/** Delete one Sales & Orders record (needs Write on its page). */
export const deleteSalesRecord = (kind: string, id: number) => call<null>('delete_sales_record', { p_kind: kind, p_id: id });

// ------------------------------------------------------------- units ---
/** Add or change a unit of measure (Settings → Units; Director / Plant Head). factor = how many reference units (PCS / KG / mm / min) one holds. */
export const saveUnit = (code: string, name: string, kind: string, factor: number, active: boolean) => call<string>('save_unit', { p_code: code, p_name: name, p_kind: kind, p_factor: factor, p_active: active });
export const deleteUnit = (code: string) => call<null>('delete_unit', { p_code: code });
