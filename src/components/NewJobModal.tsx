import { useMemo, useState } from 'react';
import { Info, Layers, PackagePlus } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { completeStage, createJob, fifoLots, materialKey, parseMaterialKey, startStage } from '../store/engine';
import type { ERPState } from '../store/types';
import { CUSTOMERS, MACHINES, MATERIAL_CATEGORIES, OPERATORS } from '../store/seed';
import { Field, Modal, NumInput, QtyFlow } from './ui';
import { fmtNum, todayISO } from './format';

/** FIFO allocation preview (read-only) */
export function fifoPreview(s: ERPState, key: string, qty: number) {
  let left = qty;
  const rows: { lotId: string; inwardDate: string; take: number; available: number }[] = [];
  for (const l of fifoLots(s, key)) {
    if (left <= 0) break;
    const take = Math.min(l.availableQty, left);
    rows.push({ lotId: l.id, inwardDate: l.inwardDate, take, available: l.availableQty });
    left -= take;
  }
  return { rows, short: Math.max(0, left) };
}

export function FifoPreview({ keyId, qty }: { keyId: string; qty: number }) {
  const { state } = useStore();
  if (!keyId || !(qty > 0)) return null;
  const { rows, short } = fifoPreview(state, keyId, qty);
  return (
    <div className={`callout ${short ? 'err' : 'info'}`}>
      <Layers size={16} />
      <div>
        <b>FIFO issue plan:</b>{' '}
        {rows.map((r, i) => (
          <span key={r.lotId}>
            {i > 0 && ' + '}
            <span className="mono">{r.lotId}</span> ({r.take} of {r.available} PCS, inward {r.inwardDate})
          </span>
        ))}
        {short > 0 && <div>Short by {short} PCS — add a Raw Material Inward first.</div>}
      </div>
    </div>
  );
}

/** ISO timestamp for a chosen date, keeping the current time of day */
export const tsFor = (date: string, nowTs: string) => {
  if (!date || date === nowTs.slice(0, 10)) return nowTs;
  const n = new Date(nowTs);
  const d = new Date(date + 'T00:00:00');
  d.setHours(n.getHours(), n.getMinutes(), n.getSeconds());
  return d > n ? nowTs : d.toISOString();
};

type Mode = 'pending' | 'start' | 'complete';

export function NewJobModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, run, openTrace, openAction } = useStore();
  const p0 = state.products[0];
  const [productId, setProductId] = useState(p0.id);
  const product = state.products.find((p) => p.id === productId)!;
  const [customer, setCustomer] = useState(p0.defaultCustomer);
  const [matKey, setMatKey] = useState(materialKey(p0.material, p0.od));
  const [cutLen, setCutLen] = useState(String(p0.cuttingLength));
  const [planned, setPlanned] = useState('100');
  const [actual, setActual] = useState('100');
  const [loss, setLoss] = useState('0');
  const [date, setDate] = useState(todayISO());
  const [due, setDue] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [priority, setPriority] = useState<'Normal' | 'High' | 'Urgent'>('Normal');
  const [machine, setMachine] = useState(MACHINES.cutting[0]);
  const [operator, setOperator] = useState(OPERATORS[0]);
  const [mode, setMode] = useState<Mode>('pending');

  const materials = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of MATERIAL_CATEGORIES) m.set(materialKey(c.material, c.od), 0);
    for (const l of state.rawMaterials) {
      const k = materialKey(l.material, l.od);
      m.set(k, (m.get(k) ?? 0) + l.availableQty);
    }
    return [...m.entries()];
  }, [state.rawMaterials]);

  const nextJobNo = `JOB-${new Date().getFullYear()}-${String(state.counters.job + 1).padStart(4, '0')}`;
  const avail = materials.find(([k]) => k === matKey)?.[1] ?? 0;
  const plannedN = Number(planned);
  const actualN = mode === 'pending' ? plannedN : Number(actual);
  const lossN = Number(loss);
  const outputN = actualN - lossN;
  const mat = parseMaterialKey(matKey);

  const errPlanned = !(plannedN > 0) || !Number.isInteger(plannedN) ? 'Enter a whole quantity' : plannedN > avail ? `Only ${avail} PCS in stock` : null;
  const errActual = mode !== 'pending' && (!(actualN > 0) ? 'Enter actual input' : actualN > avail ? `Only ${avail} PCS in stock` : null);
  const errLoss = mode === 'complete' && (lossN < 0 || !Number.isInteger(lossN) ? 'Whole number ≥ 0' : lossN > actualN ? 'Loss cannot exceed input' : null);

  const pickProduct = (id: string) => {
    const p = state.products.find((x) => x.id === id)!;
    setProductId(id);
    setCustomer(p.defaultCustomer);
    setMatKey(materialKey(p.material, p.od));
    setCutLen(String(p.cuttingLength));
  };

  const submit = () => {
    let created = '';
    const ok = run(
      (d, now) => {
        const ts = tsFor(date, now);
        created = createJob(
          d,
          { productId, customer, plannedQty: plannedN, materialKey: matKey, cuttingLength: Number(cutLen), dueDate: due, priority },
          ts,
        );
        if (mode === 'start') startStage(d, 'cutting', created, { inputQty: actualN, machine, operator, params: { cuttingLength: Number(cutLen) } }, ts);
        if (mode === 'complete')
          completeStage(d, 'cutting', created, { inputQty: actualN, loss: lossN, machine, operator, params: { cuttingLength: Number(cutLen) } }, ts);
      },
      {
        title: 'Cutting order created',
        message:
          mode === 'complete'
            ? `${nextJobNo}: ${actualN} in − ${lossN} loss = ${outputN} PCS moved to Forging.`
            : mode === 'start'
              ? `${nextJobNo}: ${actualN} PCS issued from raw stock (FIFO). Cutting in progress.`
              : `${nextJobNo} released to Cutting as Pending.`,
      },
    );
    if (ok) {
      onClose();
      setTimeout(() => openTrace(created), 250);
    }
  };

  const invalid = !!errPlanned || !!errActual || !!errLoss;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Create Cutting Order"
      subtitle="Creates a new production job. The same Job No. follows the material through every stage up to Dispatch."
      footer={
        <>
          <span className="left">
            <Info size={13} style={{ verticalAlign: -2 }} /> Raw stock reduces when cutting starts.
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={invalid} onClick={submit}>
            {mode === 'pending' ? 'Create Order' : mode === 'start' ? 'Create & Start Cutting' : 'Create & Complete Cutting'}
          </button>
        </>
      }
    >
      <div className="section-label">Production Order</div>
      <div className="form-grid three">
        <Field label="Job Number" hint="Auto-generated">
          <input className="input mono" readOnly value={nextJobNo} />
        </Field>
        <Field label="Product" required>
          <select value={productId} onChange={(e) => pickProduct(e.target.value)}>
            {state.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Customer" required>
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            {CUSTOMERS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Raw Material" required hint={`${fmtNum(avail)} PCS available`}>
          <select value={matKey} onChange={(e) => setMatKey(e.target.value)}>
            {materials.map(([k, a]) => (
              <option key={k} value={k}>
                {k.split('|')[0]} — OD {k.split('|')[1]} mm ({a} PCS)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Raw Material OD">
          <NumInput value={mat.od} readOnly suffix="mm" />
        </Field>
        <Field label="Cutting Length" required hint={`Product standard: ${product.cuttingLength} mm`}>
          <NumInput value={cutLen} onChange={setCutLen} suffix="mm" step="any" />
        </Field>
        <Field label="Planned Quantity" required error={errPlanned}>
          <NumInput value={planned} onChange={(v) => { setPlanned(v); setActual(v); }} bad={!!errPlanned} />
        </Field>
        <Field label="Due Date">
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            <option>Normal</option>
            <option>High</option>
            <option>Urgent</option>
          </select>
        </Field>
      </div>

      <div className="section-label">Cutting Execution</div>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={mode === 'pending' ? 'on' : ''} onClick={() => setMode('pending')}>
          Release as Pending
        </button>
        <button className={mode === 'start' ? 'on' : ''} onClick={() => setMode('start')}>
          Start Now
        </button>
        <button className={mode === 'complete' ? 'on' : ''} onClick={() => setMode('complete')}>
          Start &amp; Complete
        </button>
      </div>

      {mode !== 'pending' && (
        <div className="form-grid three">
          <Field label="Actual Input Quantity" required error={errActual || null} hint="Issued from raw stock">
            <NumInput value={actual} onChange={setActual} bad={!!errActual} />
          </Field>
          {mode === 'complete' ? (
            <Field label="Loss / Rejection" required error={errLoss || null}>
              <NumInput value={loss} onChange={setLoss} bad={!!errLoss} />
            </Field>
          ) : (
            <Field label="Machine">
              <select value={machine} onChange={(e) => setMachine(e.target.value)}>
                {MACHINES.cutting.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Date">
            <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {mode === 'complete' && (
            <Field label="Machine">
              <select value={machine} onChange={(e) => setMachine(e.target.value)}>
                {MACHINES.cutting.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Operator">
            <select value={operator} onChange={(e) => setOperator(e.target.value)}>
              {OPERATORS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {mode === 'complete' && (
        <div style={{ marginTop: 16 }}>
          <QtyFlow input={actualN || 0} loss={lossN || 0} output={Number.isFinite(outputN) && outputN >= 0 ? outputN : '—'} />
          <div className="callout ok">
            <Info size={16} />
            <div>
              Output = Input − Loss → <b>{outputN >= 0 ? outputN : '—'} PCS</b> will move to <b>Forging</b>.
            </div>
          </div>
        </div>
      )}
      {avail === 0 ? (
        <div className="callout warn">
          <PackagePlus size={16} />
          <div style={{ flex: 1 }}>
            No stock of <b>{mat.material} OD {mat.od} mm</b>. Add a raw material inward first, then create the job.
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => openAction({ kind: 'inward' })}>
            Add Raw Material Inward
          </button>
        </div>
      ) : (
        <FifoPreview keyId={matKey} qty={actualN} />
      )}
    </Modal>
  );
}
