import { useMemo, useState } from 'react';
import { CheckCircle2, Eye, PenLine, Play, Plus, SlidersHorizontal, Waypoints } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { completeStage, getJob, getProduct, parseMaterialKey, PROCESS_STAGES, STAGE_LABEL, stageRecords } from '../store/engine';
import type { ProcessStage, StageRecord } from '../store/types';
import { OPERATORS } from '../store/seed';
import { Badge, Empty, Field, FLOW_STEPS, InlineQty, JobLink, Modal, NumInput, PageHeader, QtyFlow, rowTone, Search, SummaryLine, Tabs } from '../components/ui';
import { FifoPreview, tsFor } from '../components/NewJobModal';
import { nextStep } from '../components/workflow';
import { fmtNum, matches, todayISO } from '../components/format';

const CFG: Record<ProcessStage, { title: string; from: string; to: string }> = {
  cutting: {
    title: 'Cutting',
    from: 'Raw Inventory',
    to: 'Forging',
  },
  forging: {
    title: 'Forging / Manufacturing',
    from: 'Cutting',
    to: 'Trimming',
  },
  trimming: {
    title: 'Trimming',
    from: 'Forging',
    to: 'Heat Treatment',
  },
  heatTreatment: {
    title: 'Heat Treatment',
    from: 'Trimming',
    to: 'QC',
  },
};

type Filter = 'all' | 'Pending' | 'Completed';

export function StagePage({ stage }: { stage: ProcessStage }) {
  const { state, openAction } = useStore();
  const cfg = CFG[stage];
  const step = FLOW_STEPS.find((s) => s.key === stage)!;
  const recs = stageRecords(state, stage);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [productF, setProductF] = useState('');

  // started-but-not-finished records (older data) count as pending: the card has no separate step
  const pending = recs.filter((r) => r.status !== 'Completed');
  const done = recs.filter((r) => r.status === 'Completed');
  const totIn = done.reduce((t, r) => t + r.input, 0);
  const totLoss = done.reduce((t, r) => t + r.loss, 0);
  const totOut = done.reduce((t, r) => t + r.output, 0);

  const rows = useMemo(() => {
    const order = { 'In Progress': 0, Pending: 1, Completed: 2 } as const;
    return recs
      .filter((r) => filter === 'all' || (filter === 'Completed' ? r.status === 'Completed' : r.status !== 'Completed'))
      .filter((r) => {
        const job = getJob(state, r.jobNo);
        const p = getProduct(state, job.productId);
        return (!productF || p.id === productF) && matches(q, r.jobNo, p.name, job.customer, r.machine, r.operator);
      })
      .sort((a, b) => order[a.status] - order[b.status] || (b.completedAt ?? b.receivedAt).localeCompare(a.completedAt ?? a.receivedAt));
  }, [recs, filter, q, productF, state]);

  // Jobs still upstream — they will arrive here later (demonstrates parallel stages)
  const idx = PROCESS_STAGES.indexOf(stage);
  const upstream = state.jobs.filter((j) => PROCESS_STAGES.indexOf(j.currentStage as ProcessStage) > -1 && PROCESS_STAGES.indexOf(j.currentStage as ProcessStage) < idx);

  return (
    <>
      <PageHeader
        eyebrow={`Workflow · Step ${FLOW_STEPS.indexOf(step) + 1} of 8`}
        title={cfg.title}
        flow={stage}
        actions={
          stage === 'cutting' && (
            <button className="btn btn-primary" onClick={() => openAction({ kind: 'newJob' })}>
              <Plus size={16} /> New Job Card
            </button>
          )
        }
      />

      <div className="card">
        <div className="card-head">
          <div>
            <h3>{STAGE_LABEL[stage]} Jobs</h3>
          </div>
          {done.length > 0 && (
            <div className="right">
              <SummaryLine
                items={[
                  { label: `PCS OK sent to ${cfg.to}`, value: fmtNum(totOut), tone: 'good' },
                  { label: `PCS rejection (${((totLoss / totIn) * 100).toFixed(2)}%)`, value: fmtNum(totLoss), tone: 'bad' },
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
              { value: 'all', label: 'All', count: recs.length, tone: 'blue' },
              { value: 'Pending', label: 'Pending', count: pending.length, tone: 'amber' },
              { value: 'Completed', label: 'Completed', count: done.length, tone: 'green' },
            ]}
          />
          <Search value={q} onChange={setQ} placeholder="Search job, product, customer, machine…" />
          <span className="filter-wrap">
            <SlidersHorizontal size={15} />
            <select className="filter" value={productF} onChange={(e) => setProductF(e.target.value)} aria-label="Filter by product">
              <option value="">All products</option>
              {state.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </span>
        </div>
        {rows.length === 0 ? (
          <Empty
            title={
              filter === 'all' && !q && !productF
                ? `No ${STAGE_LABEL[stage]} jobs yet`
                : filter === 'all'
                  ? 'No matching jobs'
                  : `No ${filter.toLowerCase()} ${STAGE_LABEL[stage]} jobs`
            }
            text={stage === 'cutting' ? 'Create a job card to start production.' : `Jobs appear here automatically once ${cfg.from} is completed.`}
            action={stage === 'cutting' && <button className="btn btn-primary" onClick={() => openAction({ kind: 'newJob' })}><Plus size={15} /> New Job Card</button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="tbl compact">
              <thead>
                <tr>
                  <th>Job Card No.</th>
                  <th>Item</th>
                  {stage === 'cutting' && <th>Material</th>}
                  {stage === 'heatTreatment' && <th className="r">Temp.</th>}
                  <th>Received → Rejection → OK</th>
                  <th>Checked By</th>
                  <th>Status</th>
                  <th className="r">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.id} r={r} onProcess={() => openAction({ kind: 'stage', stage, jobNo: r.jobNo })} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {upstream.length > 0 && <UpstreamJobs jobNos={upstream.map((j) => j.jobNo)} />}

    </>
  );
}

function Row({ r, onProcess }: { r: StageRecord; onProcess: () => void }) {
  const { state, openTrace } = useStore();
  const job = getJob(state, r.jobNo);
  const p = getProduct(state, job.productId);
  const mat = parseMaterialKey(job.materialKey);
  return (
    <tr className={rowTone(r.status === 'Completed' ? 'Completed' : 'Pending')}>
      <td>
        <JobLink jobNo={r.jobNo} />
      </td>
      <td className="strong nowrap">{p.name}</td>
      {r.stage === 'cutting' && (
        <td>
          <div className="nowrap">{mat.material}</div>
          <div className="sub">
            Ø{mat.od} · {r.params.cuttingLength} mm{job.pieceWeightG ? ` · ${job.pieceWeightG} g` : ''}
          </div>
        </td>
      )}
      {r.stage === 'heatTreatment' && <td className="r strong nowrap">{r.params.temperature}°C</td>}
      <td>
        {r.params.skipped ? (
          <span className="chip chip-skip">Not required — skipped</span>
        ) : r.status === 'Completed' ? (
          <InlineQty input={r.input} loss={r.loss} output={r.output} />
        ) : (
          <span className="inline-q">
            {fmtNum(r.input)} <span className="muted" style={{ fontWeight: 500 }}>PCS {r.stage === 'cutting' ? 'to cut' : 'received'}</span>
          </span>
        )}
      </td>
      <td>{r.operator || <span className="muted">—</span>}</td>
      <td>
        <Badge status={r.status === 'Completed' ? 'Completed' : 'Pending'} />
      </td>
      <td className="r nowrap">
        {r.status !== 'Completed' && (
          <button className="btn btn-sm btn-primary" onClick={onProcess}>
            <PenLine size={13} /> Enter Qty
          </button>
        )}
        <button className="icon-btn" style={{ display: 'inline-grid', verticalAlign: 'middle', marginLeft: 4 }} title="View traceability" onClick={() => openTrace(r.jobNo)}>
          <Eye size={16} />
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
/** One row of the route card: Inward Date, Received Qty, Rejection Qty, OK Qty, Checked By. */
export function StageModal({ stage, jobNo, onClose }: { stage: ProcessStage; jobNo: string; onClose: () => void }) {
  const { state, run } = useStore();
  const rec = stageRecords(state, stage).find((r) => r.jobNo === jobNo && r.status !== 'Completed');
  const job = getJob(state, jobNo);
  const p = getProduct(state, job.productId);
  const cfg = CFG[stage];

  const [received, setReceived] = useState(String(rec?.input ?? 0));
  const [rejection, setRejection] = useState('0');
  const [checkedBy, setCheckedBy] = useState(rec?.operator ?? '');
  const [date, setDate] = useState(todayISO());
  const [temperature, setTemperature] = useState(String(rec?.params.temperature ?? p.htTemperature));
  const [skip, setSkip] = useState(false);

  if (!rec) return null;
  // Cutting: the received qty is the cut qty, issued from raw stock (editable until issued)
  const editableInput = stage === 'cutting' && rec.status === 'Pending';
  const inN = editableInput ? Number(received) : rec.input;
  const rejN = skip ? 0 : Number(rejection);
  const ok = inN - rejN;
  const rawAvail = state.rawMaterials.filter((l) => `${l.material}|${l.od}` === job.materialKey).reduce((t, l) => t + l.availableQty, 0);

  const errIn = editableInput ? (!(inN > 0) || !Number.isInteger(inN) ? 'Enter a whole quantity' : inN > rawAvail ? `Only ${rawAvail} PCS in raw stock` : null) : null;
  const errRej = rejection === '' || rejN < 0 || !Number.isInteger(rejN) ? 'Whole number' : rejN > inN ? `Cannot exceed ${inN}` : null;
  const errTemp = stage === 'heatTreatment' && !(Number(temperature) > 0) ? 'Enter temperature' : null;
  const invalid = !!errIn || !!errRej || !!errTemp;

  const save = () => {
    if (invalid) return;
    const done = run(
      (d, now) =>
        completeStage(
          d,
          stage,
          jobNo,
          {
            inputQty: editableInput ? inN : undefined,
            loss: rejN,
            operator: checkedBy,
            remarks: skip ? 'Not required — skipped' : undefined,
            params: stage === 'heatTreatment' ? { temperature: Number(temperature) } : skip ? { skipped: 1 } : undefined,
          },
          tsFor(date, now),
        ),
      {
        title: skip ? `${STAGE_LABEL[stage]} skipped` : `${STAGE_LABEL[stage]} saved`,
        message: ok > 0 ? `${jobNo}: ${inN} received − ${rejN} rejected = ${ok} OK, sent to ${cfg.to}.` : `${jobNo}: entire batch rejected.`,
      },
    );
    if (done) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={FLOW_STEPS.find((f) => f.key === stage)!.icon}
      title={`${STAGE_LABEL[stage]} — ${jobNo}`}
      subtitle={`${p.name} · ${parseMaterialKey(job.materialKey).material} Ø${parseMaterialKey(job.materialKey).od}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-success" disabled={invalid} onClick={save}>
            <CheckCircle2 size={15} /> Save &amp; send {ok > 0 ? `${fmtNum(ok)} PCS ` : ''}to {cfg.to}
          </button>
        </>
      }
    >
      {stage === 'trimming' && (
        <label className={`check ${skip ? 'on' : ''}`} style={{ marginBottom: 16 }}>
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          Trimming not required for this job (send all {fmtNum(rec.input)} PCS to Heat Treatment)
        </label>
      )}
      <div className="form-grid three">
        <Field label="Inward Date">
          <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Received Qty" required error={errIn} hint={editableInput ? `Cut qty · ${fmtNum(rawAvail)} PCS in raw stock` : `OK qty from ${cfg.from}`}>
          <NumInput value={editableInput ? received : rec.input} onChange={setReceived} readOnly={!editableInput} bad={!!errIn} />
        </Field>
        <Field label="Rejection Qty" required error={skip ? null : errRej}>
          <NumInput value={skip ? '0' : rejection} onChange={setRejection} readOnly={skip} bad={!skip && !!errRej} autoFocus={!editableInput} />
        </Field>
        <Field label="OK Qty" hint="Received − Rejection">
          <NumInput value={Number.isFinite(ok) && ok >= 0 ? ok : ''} readOnly />
        </Field>
        <Field label="Checked By">
          <select value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)}>
            <option value="">Select…</option>
            {OPERATORS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        {stage === 'heatTreatment' && (
          <Field label="Temperature" required error={errTemp} hint={`${p.name} standard: ${p.htTemperature}°C`}>
            <NumInput value={temperature} onChange={setTemperature} suffix="°C" />
          </Field>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <QtyFlow input={Number.isFinite(inN) ? inN : 0} loss={Number.isFinite(rejN) ? rejN : 0} output={Number.isFinite(ok) && ok >= 0 ? ok : '—'} />
      </div>
      {editableInput && <FifoPreview keyId={job.materialKey} qty={inN} />}
    </Modal>
  );
}

/** Jobs still at an earlier stage — shows why they are not here yet and lets the user finish that step. */
function UpstreamJobs({ jobNos }: { jobNos: string[] }) {
  const { state, openAction, openTrace } = useStore();
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head">
        <div>
          <h3>Coming from earlier stages</h3>
          <div className="sub">They move here once their current stage is completed.</div>
        </div>
        <div className="right">
          <Waypoints size={18} className="muted" />
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl compact">
          <thead>
            <tr>
              <th>Job No.</th>
              <th>Product</th>
              <th>Now at</th>
              <th className="r">Qty</th>
              <th>Status</th>
              <th className="r">To move it forward</th>
            </tr>
          </thead>
          <tbody>
            {jobNos.map((jobNo) => {
              const job = getJob(state, jobNo);
              const st = job.currentStage as ProcessStage;
              const rec = stageRecords(state, st).find((r) => r.jobNo === jobNo && r.status !== 'Completed');
              const n = nextStep(state, jobNo);
              return (
                <tr key={jobNo} className={rowTone('Pending')}>
                  <td>
                    <JobLink jobNo={jobNo} />
                  </td>
                  <td className="strong nowrap">{getProduct(state, job.productId).name}</td>
                  <td className="strong">{STAGE_LABEL[st]}</td>
                  <td className="r qty-cell">{fmtNum(rec?.input ?? 0)}</td>
                  <td>{rec && <Badge status="Pending" />}</td>
                  <td className="r nowrap">
                    {n?.action && (
                      <button className={`btn btn-sm ${rec?.status === 'In Progress' ? 'btn-success' : 'btn-primary'}`} onClick={() => openAction(n.action!)}>
                        {rec?.status === 'In Progress' ? <CheckCircle2 size={13} /> : <Play size={13} />} {n.label}
                      </button>
                    )}
                    <button className="icon-btn" style={{ display: 'inline-grid', verticalAlign: 'middle', marginLeft: 4 }} title="View traceability" onClick={() => openTrace(jobNo)}>
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
