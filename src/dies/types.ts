export type DieKind = 'forging' | 'trimming';
export type Metal = 'Brass' | 'Aluminium' | 'Copper' | 'Other';
export type DieStatus = 'Available' | 'In Production' | 'Under Maintenance' | 'Damaged' | 'Retired';

export const METALS: Metal[] = ['Brass', 'Aluminium', 'Copper', 'Other'];
export const DIE_STATUSES: DieStatus[] = ['Available', 'In Production', 'Under Maintenance', 'Damaged', 'Retired'];
export const KIND_LABEL: Record<DieKind, string> = { forging: 'Forging', trimming: 'Trimming' };
export const KIND_PREFIX: Record<DieKind, string> = { forging: 'FGD', trimming: 'TRD' };

/** Dimensions in mm */
export interface Dims {
  l?: number;
  w?: number;
  h?: number;
}

/** Parent record: the component. Forging and trimming dies point at it by `code`. */
export interface MainDie {
  code: string; // DIE-0001
  name: string;
  partCode: string;
  description: string;
  customer: string;
  metal: Metal;
  createdOn: string; // yyyy-mm-dd
  status: 'Active' | 'Inactive';
  remarks: string;
  demo?: boolean;
}

/** One physical die. Forging and trimming dies share this shape but live in separate collections. */
export interface Die {
  code: string; // FGD-0001 / TRD-0001
  kind: DieKind;
  mainCode: string;
  material: string;
  top: Dims;
  bottom: Dims;
  topWeight?: number; // kg
  bottomWeight?: number; // kg
  makingDate: string;
  maker: string;
  drawingNo: string;
  revision: string;
  topImg?: string; // key into DieData.images
  bottomImg?: string;
  status: DieStatus;
  remarks: string;
  location: string;
  cost?: number;
  pieces: number; // production strokes / pieces produced
  lastMaintDate?: string;
  maintRemarks?: string;
  replacesCode?: string;
  replacedByCode?: string;
  demo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEvent {
  id: string;
  at: string; // ISO timestamp, used for ordering
  date: string; // yyyy-mm-dd
  kind: DieKind;
  dieCode: string;
  mainCode: string;
  event: string;
  remarks: string;
  demo?: boolean;
}

export interface MaintenanceRecord {
  id: string;
  kind: DieKind;
  dieCode: string;
  date: string;
  remarks: string;
  demo?: boolean;
}

export interface IssueRecord {
  id: string;
  kind: DieKind;
  dieCode: string;
  issuedOn: string;
  issuedTo: string;
  remarks: string;
  returnedOn?: string;
  pieces?: number; // produced during this issue
  returnRemarks?: string;
  demo?: boolean;
}

export interface DieData {
  mainDies: MainDie[];
  forgingDies: Die[];
  trimmingDies: Die[];
  history: HistoryEvent[];
  maintenance: MaintenanceRecord[];
  issues: IssueRecord[];
  /** Down-scaled image data URLs, keyed by id. Kept apart so die records stay small. */
  images: Record<string, string>;
}

export type DieCollection = keyof DieData;
