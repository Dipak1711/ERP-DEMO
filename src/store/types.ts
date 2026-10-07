// ---------------------------------------------------------------------------
// ForgeFlow ERP demo — data model
// Every collection below is persisted to its own localStorage key (see storage.ts).
// ---------------------------------------------------------------------------

/** The four quantity-transforming process stages handled by the generic stage engine. */
export type ProcessStage = 'cutting' | 'forging' | 'trimming' | 'heatTreatment';

/** Where a job currently sits in the plant. */
export type JobStage = ProcessStage | 'qc' | 'finishedGoods' | 'dispatched' | 'scrapped';

export type StageStatus = 'Pending' | 'In Progress' | 'Completed';
export type QCStatus = 'QC Pending' | 'Approved' | 'Rejected' | 'Partially Approved';
export type DispatchStatus = 'Ready for Dispatch' | 'Dispatched';
export type FGStatus = 'Available' | 'Reserved' | 'Partially Dispatched' | 'Dispatched';

export interface Product {
  id: string;
  code: string;
  name: string;
  /** Raw material grade this product is forged from */
  material: string;
  od: number; // mm
  cuttingLength: number; // mm
  finishedWeight: number; // kg per piece (after forging/trimming)
  htTemperature: number; // °C — varies per product
  htSoakMinutes: number;
  htProcess: string; // e.g. Normalising, Annealing
  htQuench: string;
  dieNo: string;
  defaultCustomer: string;
}

/** One inward lot of raw material (round bar billets). FIFO is applied across lots of the same material + OD. */
export interface RawMaterialLot {
  id: string; // RM-2026-001
  material: string; // Brass Round Bar
  materialType: string; // grade, e.g. CW614N
  od: number; // mm
  supplier: string;
  inwardDate: string; // ISO date
  heatNo: string;
  invoiceNo: string;
  inwardQty: number; // PCS
  inwardWeight: number; // KG
  availableQty: number; // PCS — reduces as material is issued to Cutting
  unit: 'PCS';
}

export interface RawInward {
  id: string;
  lotId: string;
  date: string;
  material: string;
  materialType: string;
  od: number;
  supplier: string;
  qty: number;
  weight: number;
  invoiceNo: string;
}

/** Material issued from a raw lot to a job (FIFO allocation). */
export interface MaterialIssue {
  lotId: string;
  qty: number;
  weight: number;
}

export interface Job {
  jobNo: string; // JOB-2026-0001 — same number travels through every stage
  productId: string;
  customer: string;
  plannedQty: number;
  materialKey: string; // `${material}|${od}` — what Cutting will consume
  createdAt: string;
  dueDate: string;
  priority: 'Normal' | 'High' | 'Urgent';
  currentStage: JobStage;
  issues: MaterialIssue[]; // raw lots consumed (filled when Cutting starts)
}

/** Generic record for Cutting, Forging, Trimming and Heat Treatment. */
export interface StageRecord {
  id: string;
  jobNo: string;
  stage: ProcessStage;
  input: number;
  loss: number;
  output: number;
  status: StageStatus;
  receivedAt: string; // when the qty arrived at this stage
  startedAt?: string;
  completedAt?: string;
  machine: string;
  operator: string;
  remarks: string;
  /** Stage specific parameters: cuttingLength, dieNo, temperature, soakMinutes, quench … */
  params: Record<string, string | number>;
}

export interface QCRecord {
  id: string;
  jobNo: string;
  input: number;
  accepted: number;
  rejected: number;
  status: QCStatus;
  receivedAt: string;
  inspectedAt?: string;
  inspector: string;
  rejectionReason: string;
  remarks: string;
  checks: { dimensional: boolean; visual: boolean; hardness: boolean };
}

export interface FinishedGood {
  id: string; // FG-2026-0001
  jobNo: string;
  productId: string;
  qty: number; // QC accepted qty received into FG
  reservedQty: number; // packed / ready for dispatch
  dispatchedQty: number;
  receivedAt: string;
  location: string;
}

export interface Bag {
  no: number;
  qty: number;
  weight: number;
}

export interface Dispatch {
  dispatchNo: string; // DSP-2026-0001
  fgId: string;
  jobNo: string;
  productId: string;
  customer: string;
  qty: number;
  vehicleNo: string;
  driver: string;
  invoiceNo: string;
  date: string;
  bags: Bag[];
  weight: number; // KG total
  status: DispatchStatus;
  createdAt: string;
  dispatchedAt?: string;
}

/** Quantity movement ledger — every transfer between stages is written here. */
export interface Movement {
  id: string;
  ts: string;
  jobNo: string;
  from: string;
  to: string;
  qty: number;
  loss: number;
  note: string;
}

export interface Activity {
  id: string;
  ts: string;
  jobNo?: string;
  kind: 'inward' | 'job' | 'start' | 'complete' | 'qc' | 'fg' | 'dispatch' | 'reject';
  text: string;
}

export interface Counters {
  job: number;
  dispatch: number;
  lot: number;
  fg: number;
  seq: number; // generic id sequence
}

export interface ERPState {
  products: Product[];
  rawMaterials: RawMaterialLot[];
  rawInwards: RawInward[];
  jobs: Job[];
  cutting: StageRecord[];
  forging: StageRecord[];
  trimming: StageRecord[];
  heatTreatment: StageRecord[];
  qc: QCRecord[];
  finishedGoods: FinishedGood[];
  dispatches: Dispatch[];
  movements: Movement[];
  activity: Activity[];
  counters: Counters;
}

export type CollectionKey = keyof ERPState;
