import { useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, Eye, Info, PackageCheck, ShieldCheck } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { completeQC, getJob, getProduct, qcStatusFor, stageRecords } from '../store/engine';
import { INSPECTORS } from '../store/seed';
import { Badge, Empty, Field, JobLink, Modal, NumInput, PageHeader, QtyFlow, Search, SummaryLine, Tabs } from '../components/ui';
import { tsFor } from '../components/NewJobModal';
import { fmtDateTime, fmtNum, matches, todayISO } from '../components/format';

type Filter = 'QC Pending' | 'inspected' | 'Rejections' | 'all';

export function QCPage() {
  const { state, openTrace, openAction } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const recs = state.qc;
  const pending = recs.filter((r) => r.status === 'QC Pending');
  const inspected = recs.filter((r) => r.status !== 'QC Pending');
  const withRej = inspected.filter((r) => r.rejected > 0);
  const accepted = inspected.reduce((t, r) => t + r.accepted, 0);
  const rejected = inspected.reduce((t, r) => t + r.rejected, 0);
  const total = accepted + rejected;

  const rows = useMemo(
    () =>
      recs
        .filter((r) =>
          filter === 'all' ? true : filter === 'QC Pending' ? r.status === 'QC Pending' : filter === 'inspected' ? r.status !== 'QC Pending' : r.rejected > 0,
        )
        .filter((r) => {
          const job = getJob(state, r.jobNo);
          return matches(q, r.jobNo, getProduct(state, job.productId).name, job.customer, r.inspector, r.status);
        })
        .sort((a, b) => (a.status === 'QC Pending' ? -1 : 1) - (b.status === 'QC Pending' ? -1 : 1) || (b.inspectedAt ?? b.receivedAt).localeCompare(a.inspectedAt ?? a.receivedAt)),
    [recs, filter, q, state],
  );

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Step 6 of 8"
        title="Quality Control"
        flow="qc"
      />
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Inspection Register</h3>
          </div>
          {total > 0 && (
            <div className="right">
              <SummaryLine
                items={[
                  { label: 'PCS accepted → FG', value: fmtNum(accepted), tone: 'good' },
                  { label: 'PCS rejected', value: fmtNum(rejected), tone: 'bad' },
                  { label: 'first-pass yield', value: `${((accepted / total) * 100).toFixed(1)}%`, tone: 'info' },
                ]}
              />
            </div>
          )}
        </div>
        <div className="toolbar">
          <Tabs
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: 'All', count: recs.length },
              { value: 'QC Pending', label: 'Pending', count: pending.length },
              { value: 'inspected', label: 'Inspected', count: inspected.length },
              { value: 'Rejections', label: 'With Rejections', count: withRej.length },
            ]}
          />
          <Search value={q} onChange={setQ} placeholder="Search job, product, inspector…" />
        </div>
        {rows.length === 0 ? (
          <Empty icon={ShieldCheck} title="Nothing to inspect" text="Jobs appear here automatically once Heat Treatment is completed." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Job No.</th>
                  <th>Product</th>
                  <th>HT Temp.</th>
                  <th>Received</th>
                  <th className="r">Input</th>
                  <th className="r">Accepted</th>
                  <th className="r">Rejected</th>
                  <th>Inspector / Reason</th>
                  <th>QC Status</th>
                  <th className="r">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const job = getJob(state, r.jobNo);
                  const p = getProduct(state, job.productId);
                  const ht = stageRecords(state, 'heatTreatment').find((x) => x.jobNo === r.jobNo);
                  const done = r.status !== 'QC Pending';
                  return (
                    <tr key={r.id}>
                      <td>
                        <JobLink jobNo={r.jobNo} />
                      </td>
                      <td>
                        <div className="strong">{p.name}</div>
                        <div className="sub">{job.customer}</div>
                      </td>
                      <td className="nowrap">{ht?.params.temperature}°C</td>
                      <td className="nowrap">{fmtDateTime(r.receivedAt)}</td>
                      <td className="r qty-cell">{fmtNum(r.input)}</td>
                      <td className="r">{done ? <span className="gain">{fmtNum(r.accepted)}</span> : <span className="muted">—</span>}</td>
                      <td className="r">{done ? r.rejected ? <span className="loss">{fmtNum(r.rejected)}</span> : <span className="muted">0</span> : <span className="muted">—</span>}</td>
                      <td>
                        {done ? (
                          <>
                            <div>{r.inspector}</div>
                            {r.rejectionReason && <div className="sub" style={{ color: 'var(--crit)' }}>{r.rejectionReason}</div>}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <Badge status={r.status} />
                      </td>
                      <td className="r nowrap">
                        {!done && (
                          <button className="btn btn-sm btn-primary" onClick={() => openAction({ kind: 'qc', jobNo: r.jobNo })}>
                            <ClipboardCheck size={13} /> Inspect
                          </button>
                        )}
                        <button className="icon-btn" style={{ display: 'inline-grid', verticalAlign: 'middle', marginLeft: 4 }} title="View traceability" onClick={() => openTrace(r.jobNo)}>
                          <Eye size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export function InspectModal({ jobNo, onClose }: { jobNo: string; onClose: () => void }) {
  const { state, run } = useStore();
  const rec = state.qc.find((r) => r.jobNo === jobNo && r.status === 'QC Pending');
  const job = getJob(state, jobNo);
  const p = getProduct(state, job.productId);
  const ht = stageRecords(state, 'heatTreatment').find((x) => x.jobNo === jobNo);
  const [accepted, setAccepted] = useState(String(rec?.input ?? 0));
  const [rejected, setRejected] = useState('0');
  const [inspector, setInspector] = useState(INSPECTORS[0]);
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [date, setDate] = useState(todayISO());
  const [checks, setChecks] = useState({ dimensional: true, visual: true, hardness: true });
  if (!rec) return null;

  const a = Number(accepted);
  const r = Number(rejected);
  const sum = a + r;
  const bad = !Number.isInteger(a) || !Number.isInteger(r) || a < 0 || r < 0 || sum !== rec.input;
  const status = !bad ? qcStatusFor(rec.input, a) : null;
  const needReason = r > 0 && !reason.trim();

  // Keep the two numbers balanced to the input as the inspector types
  const onAccepted = (v: string) => {
    setAccepted(v);
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n <= rec.input) setRejected(String(rec.input - n));
  };
  const onRejected = (v: string) => {
    setRejected(v);
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n <= rec.input) setAccepted(String(rec.input - n));
  };

  const submit = () => {
    const ok = run((d, now) => completeQC(d, jobNo, { accepted: a, rejected: r, inspector, rejectionReason: reason, remarks, checks }, tsFor(date, now)), {
      title: `QC ${status?.toLowerCase()}`,
      message: a > 0 ? `${jobNo}: ${a} PCS moved to Finished Goods${r ? `, ${r} PCS rejected` : ''}.` : `${jobNo}: all ${r} PCS rejected.`,
    });
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={ShieldCheck}
      title={`QC Inspection — ${jobNo}`}
      subtitle={`${p.name} · ${job.customer}`}
      footer={
        <>
          <span className="left">Accepted + Rejected must equal Input</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-success" disabled={bad || needReason} onClick={submit}>
            <PackageCheck size={15} /> Submit QC {status ? `· ${status}` : ''}
          </button>
        </>
      }
    >
      <div className="info-strip">
        <div>
          <div className="l">Job No.</div>
          <div className="v mono">{jobNo}</div>
        </div>
        <div>
          <div className="l">Product</div>
          <div className="v">{p.name}</div>
        </div>
        <div>
          <div className="l">HT Temperature</div>
          <div className="v">{ht?.params.temperature}°C</div>
        </div>
        <div>
          <div className="l">Received from HT</div>
          <div className="v">{fmtNum(rec.input)} PCS</div>
        </div>
      </div>

      <div className="form-grid three">
        <Field label="Input Quantity" hint="= Heat Treatment output · locked">
          <NumInput value={rec.input} readOnly />
        </Field>
        <Field label="Accepted Quantity" required>
          <NumInput value={accepted} onChange={onAccepted} bad={bad} autoFocus />
        </Field>
        <Field label="Rejected Quantity" required error={bad ? `Must total ${rec.input}` : null}>
          <NumInput value={rejected} onChange={onRejected} bad={bad} />
        </Field>
        <Field label="Inspector">
          <select value={inspector} onChange={(e) => setInspector(e.target.value)}>
            {INSPECTORS.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </Field>
        <Field label="Inspection Date">
          <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="QC Status" hint="Derived from quantities">
          <div style={{ paddingTop: 8 }}>{status ? <Badge status={status} /> : <span className="muted">—</span>}</div>
        </Field>
        <Field label="Rejection Reason" required={r > 0} full error={needReason ? 'Required when quantity is rejected' : null}>
          <select value={reason} onChange={(e) => setReason(e.target.value)} disabled={r === 0}>
            <option value="">{r === 0 ? 'No rejection' : 'Select reason…'}</option>
            {['Dimension out of tolerance', 'Surface crack', 'Under-filled / incomplete forging', 'Hardness out of range', 'Flash / burr not removed', 'Scale / pitting'].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Inspection Checks" full>
          <div className="check-row">
            {(['dimensional', 'visual', 'hardness'] as const).map((k) => (
              <label key={k} className={`check ${checks[k] ? 'on' : ''}`}>
                <input type="checkbox" checked={checks[k]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} />
                {k === 'dimensional' ? 'Dimensional check' : k === 'visual' ? 'Visual / surface' : 'Hardness test'}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Remarks" full>
          <input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional inspection remarks" />
        </Field>
      </div>

      <div style={{ marginTop: 18 }}>
        <QtyFlow input={rec.input} loss={Number.isFinite(r) ? r : 0} output={Number.isFinite(a) ? a : 0} labels={['QC Input', 'Rejected', 'Accepted → FG']} />
      </div>
      {!bad && (
        <div className={`callout ${a === 0 ? 'err' : r > 0 ? 'warn' : 'ok'}`}>
          {a === 0 ? <AlertTriangle size={16} /> : <Info size={16} />}
          <div>
            {a > 0 ? (
              <>
                <b>{fmtNum(a)} PCS</b> will be added to Finished Goods inventory.
                {r > 0 && (
                  <>
                    {' '}
                    <b>{r} PCS</b> recorded as QC rejection.
                  </>
                )}
              </>
            ) : (
              <>Entire batch rejected — nothing moves to Finished Goods.</>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
