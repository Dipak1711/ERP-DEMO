// ---------------------------------------------------------------------------
// Die Management state + persistence.
//
// Separate localStorage collections (own prefix, independent of the manufacturing data):
//   forgeflow.dies.v1.mainDies      forgeflow.dies.v1.history
//   forgeflow.dies.v1.forgingDies   forgeflow.dies.v1.maintenance
//   forgeflow.dies.v1.trimmingDies  forgeflow.dies.v1.issues
//   forgeflow.dies.v1.images        forgeflow.dies.v1.meta  ({ seededAt })
//
// Seed data is written only when `meta` is absent, so user records survive refreshes.
// Nothing is ever deleted: dies are Retired / Damaged, main dies are made Inactive.
// ---------------------------------------------------------------------------
import { isConfidentialAllowed } from '../auth/access';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store/StoreContext';
import { todayISO } from '../components/format';
import { emptyDieData } from './seed';
import { KIND_LABEL, KIND_PREFIX, type Die, type DieCollection, type DieData, type DieKind, type DieStatus, type Dims, type HistoryEvent, type MainDie } from './types';

const PREFIX = 'forgeflow.dies.v1.';
const KEYS = Object.keys(emptyDieData()) as DieCollection[];
/** Bump to wipe what older builds left in the browser (their demo dies). */
const VERSION = 2;

function lsGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
}

function load(): DieData {
  let ok = false;
  try {
    ok = (JSON.parse(lsGet(PREFIX + 'meta') ?? '{}') as { version?: number }).version === VERSION;
  } catch {
    /* unreadable meta → start clean */
  }
  if (ok) {
    try {
      const d = emptyDieData() as unknown as Record<DieCollection, unknown>;
      for (const k of KEYS) {
        const raw = lsGet(PREFIX + k);
        if (raw != null) d[k] = JSON.parse(raw);
      }
      return d as unknown as DieData;
    } catch {
      /* corrupted — start clean */
    }
  }
  const empty = emptyDieData();
  persist(empty);
  lsSet(PREFIX + 'meta', JSON.stringify({ version: VERSION, startedAt: new Date().toISOString() }));
  return empty;
}

/** Writes only the collections whose reference changed. Returns false if the browser refused (quota). */
function persist(next: DieData, prev?: DieData) {
  let ok = true;
  for (const k of KEYS) if (!prev || prev[k] !== next[k]) ok = lsSet(PREFIX + k, JSON.stringify(next[k])) && ok;
  return ok;
}

// ------------------------------------------------------------------ input ---
/** What the die form edits. Images are data URLs here; the store turns them into image ids. */
export interface DieInput {
  mainCode: string;
  material: string;
  top: Dims;
  bottom: Dims;
  topWeight?: number;
  bottomWeight?: number;
  makingDate: string;
  maker: string;
  drawingNo: string;
  revision: string;
  topUrl: string;
  bottomUrl: string;
  status: DieStatus;
  remarks: string;
  location: string;
  cost?: number;
  pieces: number;
}
export type MainInput = Omit<MainDie, 'code' | 'demo'>;

export type DieUI =
  | { kind: 'main-form'; code?: string }
  | { kind: 'die-form'; dieKind: DieKind; code?: string; mainCode?: string }
  | { kind: 'die-view'; dieKind: DieKind; code: string }
  | { kind: 'replace'; dieKind: DieKind; code: string }
  | { kind: 'maintenance'; dieKind: DieKind; code: string }
  | { kind: 'issue'; dieKind: DieKind; code: string }
  | { kind: 'return'; dieKind: DieKind; code: string };

interface DieStore {
  data: DieData;
  ui: DieUI | null;
  openUI: (u: DieUI | null) => void;
  /** Each returns the saved code, or null when validation failed (a toast explains why). */
  saveMain: (input: MainInput, code?: string) => string | null;
  saveDie: (kind: DieKind, input: DieInput, code?: string) => string | null;
  replaceDie: (kind: DieKind, oldCode: string, input: DieInput, oldStatus: DieStatus, reason: string) => string | null;
  recordMaintenance: (kind: DieKind, code: string, v: { date: string; remarks: string; status: DieStatus }) => boolean;
  issueDie: (kind: DieKind, code: string, v: { date: string; issuedTo: string; remarks: string }) => boolean;
  returnDie: (kind: DieKind, code: string, v: { date: string; pieces: number; remarks: string; status: DieStatus }) => boolean;
  diesOf: (kind: DieKind) => Die[];
  findDie: (kind: DieKind, code: string) => Die | undefined;
  nextMainCode: () => string;
  nextDieCode: (kind: DieKind) => string;
}

const Ctx = createContext<DieStore | null>(null);

const collKey = (k: DieKind) => (k === 'forging' ? 'forgingDies' : 'trimmingDies') as 'forgingDies' | 'trimmingDies';
const nextCode = (prefix: string, codes: string[]) => {
  const max = codes.reduce((m, c) => Math.max(m, Number(c.split('-')[1]) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
};
const trim = (s: string) => s.trim();

export function DieProvider({ children }: { children: ReactNode }) {
  const { toast } = useStore();
  const [data, setData] = useState<DieData>(load);
  const [ui, setUI] = useState<DieUI | null>(null);
  const prev = useRef<DieData | undefined>(undefined);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    const close = () => setUI(null);
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, []);

  useEffect(() => {
    if (prev.current && prev.current !== data && !persist(data, prev.current)) {
      toastRef.current({ kind: 'error', title: 'Browser storage is full', message: 'This change is shown but could not be saved. Remove large images or clear site data.' });
    }
    prev.current = data;
  }, [data]);

  const fail = useCallback((message: string) => {
    toastRef.current({ kind: 'error', title: 'Cannot save', message });
    return null;
  }, []);

  /** Runs a mutation on a deep copy so a failed validation can never half-write. */
  const commit = useCallback(
    (fn: (d: DieData, nowISO: string) => void) => {
      const draft = structuredClone(data);
      fn(draft, new Date().toISOString());
      setData(draft);
    },
    [data],
  );

  const addEvent = (d: DieData, die: Pick<Die, 'kind' | 'code' | 'mainCode'>, event: string, remarks: string, now: string, date = todayISO()) => {
    const n = d.history.reduce((m, h) => Math.max(m, Number(h.id.split('-')[1]) || 0), 0) + 1;
    const h: HistoryEvent = { id: `H-${String(n).padStart(4, '0')}`, at: now, date, kind: die.kind, dieCode: die.code, mainCode: die.mainCode, event, remarks };
    d.history.push(h);
  };

  /** Stores a data URL as an image record; reuses nothing so editing one die can never touch another's picture. */
  const putImage = (d: DieData, oldId: string | undefined, url: string, code: string, side: 'T' | 'B'): string | undefined => {
    if (oldId && d.images[oldId] === url) return oldId;
    if (oldId) delete d.images[oldId];
    if (!url) return undefined;
    const id = `IMG-${code}-${side}-${Date.now().toString(36)}`;
    d.images[id] = url;
    return id;
  };

  const validateDie = (kind: DieKind, i: DieInput, isNew: boolean) => {
    if (!i.mainCode || !data.mainDies.some((m) => m.code === i.mainCode)) return 'Select the main die this die belongs to.';
    if (isNew && data.mainDies.find((m) => m.code === i.mainCode)?.status === 'Inactive') return 'This main die is Inactive. Make it Active before adding dies.';
    if (!trim(i.material)) return `Enter the ${KIND_LABEL[kind].toLowerCase()} die material / grade.`;
    if (!i.makingDate) return 'Enter the die making date.';
    if (!trim(i.maker) && (isNew || isConfidentialAllowed())) return 'Enter the die maker name.';
    const nums = [i.top.l, i.top.w, i.top.h, i.bottom.l, i.bottom.w, i.bottom.h, i.topWeight, i.bottomWeight, i.cost, i.pieces];
    if (nums.some((n) => n !== undefined && (!Number.isFinite(n) || n < 0))) return 'Dimensions, weights, cost and pieces cannot be negative.';
    return null;
  };

  const baseDie = (kind: DieKind, code: string, i: DieInput, now: string): Die => ({
    code,
    kind,
    mainCode: i.mainCode,
    material: trim(i.material),
    top: i.top,
    bottom: i.bottom,
    topWeight: i.topWeight,
    bottomWeight: i.bottomWeight,
    makingDate: i.makingDate,
    maker: trim(i.maker),
    drawingNo: trim(i.drawingNo),
    revision: trim(i.revision),
    status: i.status,
    remarks: trim(i.remarks),
    location: trim(i.location),
    cost: isConfidentialAllowed() ? i.cost : undefined, // only authorised roles may enter a die cost
    pieces: i.pieces || 0,
    createdAt: now,
    updatedAt: now,
  });

  const saveMain: DieStore['saveMain'] = (input, code) => {
    if (!trim(input.name)) return fail('Enter the die / component name.');
    if (!trim(input.partCode)) return fail('Enter the part code.');
    if (!input.createdOn) return fail('Enter the creation date.');
    const dup = data.mainDies.find((m) => m.partCode.toLowerCase() === trim(input.partCode).toLowerCase() && m.code !== code);
    if (dup) return fail(`Part code ${trim(input.partCode)} already belongs to ${dup.code}.`);
    const clean: MainInput = { ...input, name: trim(input.name), partCode: trim(input.partCode), description: trim(input.description), customer: trim(input.customer), remarks: trim(input.remarks) };
    const saved = code ?? nextCode('DIE', data.mainDies.map((m) => m.code));
    commit((d) => {
      if (code) {
        const i = d.mainDies.findIndex((m) => m.code === code);
        d.mainDies[i] = { ...d.mainDies[i], ...clean, customer: isConfidentialAllowed() ? clean.customer : d.mainDies[i].customer };
      } else d.mainDies.push({ code: saved, ...clean });
    });
    toastRef.current({ kind: 'success', title: code ? 'Main die updated' : 'Main die added', message: `${saved} · ${clean.name}` });
    return saved;
  };

  const saveDie: DieStore['saveDie'] = (kind, input, code) => {
    const err = validateDie(kind, input, !code);
    if (err) return fail(err);
    const coll = collKey(kind);
    const saved = code ?? nextCode(KIND_PREFIX[kind], data[coll].map((x) => x.code));
    commit((d, now) => {
      if (!code) {
        const die = baseDie(kind, saved, input, now);
        die.topImg = putImage(d, undefined, input.topUrl, saved, 'T');
        die.bottomImg = putImage(d, undefined, input.bottomUrl, saved, 'B');
        d[coll].push(die);
        addEvent(d, die, 'Die created', `Made on ${die.makingDate}, material ${die.material}.`, now);
        return;
      }
      // edit: only this one record is replaced — the sibling die type is never touched
      const idx = d[coll].findIndex((x) => x.code === code);
      const old = d[coll][idx];
      const next: Die = {
        ...old,
        ...baseDie(kind, code, input, now),
        createdAt: old.createdAt,
        updatedAt: now,
        topImg: putImage(d, old.topImg, input.topUrl, code, 'T'),
        bottomImg: putImage(d, old.bottomImg, input.bottomUrl, code, 'B'),
        mainCode: old.mainCode,
      };
      if (!isConfidentialAllowed()) {
        next.maker = old.maker; // confidential: unchanged unless the role may see it
        next.cost = old.cost;
      }
      d[coll][idx] = next;
      const fields: [string, unknown, unknown][] = [
        ['material', old.material, next.material],
        ['top die size', old.top, next.top],
        ['bottom die size', old.bottom, next.bottom],
        ['top weight', old.topWeight, next.topWeight],
        ['bottom weight', old.bottomWeight, next.bottomWeight],
        ['making date', old.makingDate, next.makingDate],
        ['die maker', old.maker, next.maker],
        ['drawing no.', old.drawingNo, next.drawingNo],
        ['revision', old.revision, next.revision],
        ['location', old.location, next.location],
        ['cost', old.cost, next.cost],
        ['pieces produced', old.pieces, next.pieces],
        ['images', `${old.topImg}|${old.bottomImg}`, `${next.topImg}|${next.bottomImg}`],
      ];
      const changed = fields.filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b)).map(([f]) => f);
      if (changed.length) addEvent(d, next, 'Die details updated', `Changed: ${changed.join(', ')}.`, now);
      if (old.status !== next.status) {
        addEvent(d, next, 'Status changed', `${old.status} → ${next.status}.`, now);
        if (next.status === 'Damaged') addEvent(d, next, 'Die marked damaged', next.remarks || 'Marked damaged from the die form.', now);
      }
      if (old.remarks !== next.remarks) addEvent(d, next, 'Remarks updated', next.remarks || '(cleared)', now);
    });
    toastRef.current({ kind: 'success', title: code ? `${KIND_LABEL[kind]} die updated` : `${KIND_LABEL[kind]} die added`, message: `${saved} saved for ${input.mainCode}.` });
    return saved;
  };

  const replaceDie: DieStore['replaceDie'] = (kind, oldCode, input, oldStatus, reason) => {
    const err = validateDie(kind, input, true);
    if (err) return fail(err);
    if (oldStatus !== 'Retired' && oldStatus !== 'Damaged') return fail('The old die must be kept as Retired or Damaged.');
    const coll = collKey(kind);
    const newCode = nextCode(KIND_PREFIX[kind], data[coll].map((x) => x.code));
    commit((d, now) => {
      const old = d[coll].find((x) => x.code === oldCode)!;
      const die = baseDie(kind, newCode, input, now);
      die.replacesCode = oldCode;
      die.topImg = putImage(d, undefined, input.topUrl, newCode, 'T');
      die.bottomImg = putImage(d, undefined, input.bottomUrl, newCode, 'B');
      d[coll].push(die);
      const wasStatus = old.status;
      old.status = oldStatus;
      old.replacedByCode = newCode;
      old.updatedAt = now;
      const why = trim(reason) ? ` Reason: ${trim(reason)}` : '';
      if (wasStatus !== oldStatus) addEvent(d, old, 'Status changed', `${wasStatus} → ${oldStatus}.${why}`, now);
      if (oldStatus === 'Damaged') addEvent(d, old, 'Die marked damaged', trim(reason) || 'Marked damaged on replacement.', now);
      addEvent(d, old, 'Replacement die created', `Replaced by ${newCode}. This record is kept for traceability.`, now);
      addEvent(d, die, 'Die created', `Made on ${die.makingDate}, material ${die.material}.`, now);
      addEvent(d, die, 'Replacement die created', `Replacement for ${oldCode}.`, now);
    });
    const other = kind === 'forging' ? 'trimming' : 'forging';
    toastRef.current({ kind: 'success', title: `${newCode} created as replacement`, message: `${oldCode} kept as ${oldStatus}. ${KIND_LABEL[other]} dies of this component are unchanged.` });
    return newCode;
  };

  const recordMaintenance: DieStore['recordMaintenance'] = (kind, code, v) => {
    if (!v.date) return !!fail('Enter the maintenance date.');
    if (!trim(v.remarks)) return !!fail('Enter the maintenance remarks.');
    const coll = collKey(kind);
    commit((d, now) => {
      const die = d[coll].find((x) => x.code === code)!;
      const was = die.status;
      die.lastMaintDate = v.date;
      die.maintRemarks = trim(v.remarks);
      die.status = v.status;
      die.updatedAt = now;
      const n = d.maintenance.reduce((m, r) => Math.max(m, Number(r.id.split('-')[1]) || 0), 0) + 1;
      d.maintenance.push({ id: `M-${String(n).padStart(4, '0')}`, kind, dieCode: code, date: v.date, remarks: trim(v.remarks) });
      addEvent(d, die, 'Maintenance recorded', trim(v.remarks), now, v.date);
      if (was !== v.status) addEvent(d, die, 'Status changed', `${was} → ${v.status}.`, now, v.date);
    });
    toastRef.current({ kind: 'success', title: 'Maintenance recorded', message: code });
    return true;
  };

  const issueDie: DieStore['issueDie'] = (kind, code, v) => {
    if (!v.date) return !!fail('Enter the issue date.');
    if (!trim(v.issuedTo)) return !!fail('Enter who / which press the die is issued to.');
    const coll = collKey(kind);
    commit((d, now) => {
      const die = d[coll].find((x) => x.code === code)!;
      const was = die.status;
      die.status = 'In Production';
      die.updatedAt = now;
      const n = d.issues.reduce((m, r) => Math.max(m, Number(r.id.split('-')[1]) || 0), 0) + 1;
      d.issues.push({ id: `I-${String(n).padStart(4, '0')}`, kind, dieCode: code, issuedOn: v.date, issuedTo: trim(v.issuedTo), remarks: trim(v.remarks) });
      addEvent(d, die, 'Status changed', `${was} → In Production. Issued to ${trim(v.issuedTo)}.`, now, v.date);
    });
    toastRef.current({ kind: 'success', title: 'Die issued', message: `${code} → ${trim(v.issuedTo)}` });
    return true;
  };

  const returnDie: DieStore['returnDie'] = (kind, code, v) => {
    if (!v.date) return !!fail('Enter the return date.');
    if (!Number.isFinite(v.pieces) || v.pieces < 0) return !!fail('Pieces produced cannot be negative.');
    const coll = collKey(kind);
    commit((d, now) => {
      const die = d[coll].find((x) => x.code === code)!;
      const open = [...d.issues].reverse().find((r) => r.dieCode === code && r.kind === kind && !r.returnedOn);
      if (open) {
        open.returnedOn = v.date;
        open.pieces = v.pieces;
        open.returnRemarks = trim(v.remarks);
      }
      const was = die.status;
      die.status = v.status;
      die.pieces += v.pieces;
      die.updatedAt = now;
      addEvent(d, die, 'Status changed', `${was} → ${v.status}. Returned with ${v.pieces} pieces produced.${trim(v.remarks) ? ' ' + trim(v.remarks) : ''}`, now, v.date);
    });
    toastRef.current({ kind: 'success', title: 'Die returned', message: `${code} · ${v.pieces} pieces added to its count` });
    return true;
  };

  const value: DieStore = {
    data,
    ui,
    openUI: setUI,
    saveMain,
    saveDie,
    replaceDie,
    recordMaintenance,
    issueDie,
    returnDie,
    diesOf: (k) => data[collKey(k)],
    findDie: (k, c) => data[collKey(k)].find((x) => x.code === c),
    nextMainCode: () => nextCode('DIE', data.mainDies.map((m) => m.code)),
    nextDieCode: (k) => nextCode(KIND_PREFIX[k], data[collKey(k)].map((x) => x.code)),
  };
  // value identity changes with data, which is exactly when consumers need to re-render
  return <Ctx.Provider value={useMemo(() => value, [data, ui])}>{children}</Ctx.Provider>; // eslint-disable-line react-hooks/exhaustive-deps
}

export function useDies() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDies outside DieProvider');
  return v;
}
