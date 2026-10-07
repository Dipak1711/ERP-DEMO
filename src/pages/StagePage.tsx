import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Clock, Eye, Info, Layers, Play, Plus, TrendingDown, Waypoints } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { completeStage, getJob, getProduct, parseMaterialKey, PROCESS_STAGES, STAGE_LABEL, startStage, stageRecords } from '../store/engine';
import type { ProcessStage, StageRecord } from '../store/types';
import { MACHINES, OPERATORS } from '../store/seed';
import { HT_PROCESSES, LOSS_REASONS } from '../store/materials';
import { Badge, Empty, Field, FLOW_STEPS, InlineQty, JobLink, Kpi, Modal, NumInput, PageHeader, QtyFlow, Search, Tabs } from '../components/ui';
import { FifoPreview, tsFor } from '../components/NewJobModal';
import { fmtDateTime, fmtNum, matches, todayISO } from '../components/format';

const CFG: Record<ProcessStage, { title: string; desc: string; from: string; to: string }> = {
  cutting: {
    title: 'Cutting',
    desc: 'First production stage. Round bars are issued from Raw Inventory (FIFO) and cut to the product length. Cutting output becomes the input for Forging.',
    from: 'Raw Inventory',
    to: 'Forging',
  },
  forging: {
    title: 'Forging / Manufacturing',
    desc: 'Receives cut billets from Cutting. Only jobs whose Cutting is complete appear here. Forging output moves to Trimming.',
    from: 'Cutting',
    to: 'Trimming',
  },
  trimming: {
    title: 'Trimming',
    desc: 'Removes flash from forged parts. Receives Forging output; trimmed output moves to Heat Treatment.',
    from: 'Forging',
    to: 'Heat Treatment',
  },
  heatTreatment: {
    title: 'Heat Treatment',
    desc: 'Receives trimmed parts. Temperature, soak time and cooling are taken from the product master and can be adjusted per batch. Output moves to QC.',
    from: 'Trimming',
    to: 'QC',
  },
};

type Filter = 'active' | 'Pending' | 'In Progress' | 'Completed' | 'all';

export function StagePage({ stage }: { stage: ProcessStage }) {
  const { state, openAction } = useStore();
  const cfg = CFG[stage];
  const step = FLOW_STEPS.find((s) => s.key === stage)!;
  const recs = stageRecords(state, stage);
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const [productF, setProductF] = useState('');

  const pending = recs.filter((r) => r.status === 'Pending');
  const inProg = recs.filter((r) => r.status === 'In Progress');
  const done = recs.filter((r) => r.status === 'Completed');
  const totIn = done.reduce((t, r) => t + r.input, 0);
  const totLoss = done.reduce((t, r) => t + r.loss, 0);
  const totOut = done.reduce((t, r) => t + r.output, 0);

  const rows = useMemo(() => {
    const order = { 'In Progress': 0, Pending: 1, Completed: 2 } as const;
    return recs
      .filter((r) => (filter === 'all' ? true : filter === 'active' ? r.status !== 'Completed' : r.status === filter))
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
        subtitle={cfg.desc}
        flow={stage}
        actions={
          stage === 'cutting' && (
            <button className="btn btn-primary" onClick={() => openAction({ kind: 'newJob' })}>
              <Plus size={16} /> Create Cutting Order
            </button>
          )
        }
      />

      <div className="kpis">
        <Kpi label={`Pending ${stage === 'cutting' ? 'Cutting' : STAGE_LABEL[stage]}`} value={pending.length} unit="jobs" hint={`${fmtNum(pending.reduce((t, r) => t + r.input, 0))} PCS waiting`} icon={Clock} tone="amber" onClick={() => setFilter('Pending')} />
        <Kpi label="In Progress" value={inProg.length} unit="jobs" hint={`${fmtNum(inProg.reduce((t, r) => t + r.input, 0))} PCS on machines`} icon={Play} tone="blue" onClick={() => setFilter('In Progress')} />
        <Kpi label="Completed" value={done.length} unit="jobs" hint={`${fmtNum(totIn)} PCS processed`} icon={CheckCircle2} tone="green" onClick={() => setFilter('Completed')} />
        <Kpi label={`Output to ${cfg.to}`} value={totOut} unit="PCS" hint="Moved to next stage" icon={ArrowRight} tone="teal" />
        <Kpi label="Loss / Rejection" value={totLoss} unit="PCS" hint={totIn ? `${((totLoss / totIn) * 100).toFixed(2)}% of input` : 'No completed jobs'} icon={TrendingDown} tone="red" />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>{STAGE_LABEL[stage]} Jobs</h3>
            <div className="sub">
              {stage === 'cutting' ? 'Cutting orders released from production planning' : `Only jobs that have completed ${cfg.from} are listed here`}
            </div>
          </div>
        </div>
        <div className="toolbar">
          <Tabs
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'active', label: 'Open', count: pending.length + inProg.length },
              { value: 'Pending', label: 'Pending', count: pending.length },
              { value: 'In Progress', label: 'In Progress', count: inProg.length },
              { value: 'Completed', label: 'Completed', count: done.length },
              { value: 'all', label: 'All', count: recs.length },
            ]}
          />
          <Search value={q} onChange={setQ} placeholder="Search job, product, customer, machine…" />
          <select className="filter" value={productF} onChange={(e) => setProductF(e.target.value)}>
            <option value="">All products</option>
            {state.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {rows.length === 0 ? (
          <Empty
            title={filter === 'active' ? `No open ${STAGE_LABEL[stage]} jobs` : 'No matching jobs'}
            text={stage === 'cutting' ? 'Create a cutting order to start a new production job.' : `Jobs appear here automatically once ${cfg.from} is completed.`}
            action={stage === 'cutting' && <button className="btn btn-primary" onClick={() => openAction({ kind: 'newJob' })}><Plus size={15} /> Create Cutting Order</button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Job No.</th>
                  <th>Product</th>
                  {stage === 'cutting' && <th>Raw Material</th>}
                  {stage === 'heatTreatment' && <th className="r">Temp.</th>}
                  <th>Received</th>
                  <th className="r">Input</th>
                  <th className="r">Loss</th>
                  <th className="r">Output</th>
                  <th>Machine / Operator</th>
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

      {upstream.length > 0 && (
        <div className="callout info" style={{ marginTop: 14 }}>
          <Waypoints size={16} />
          <div>
            <b>Upstream pipeline — not yet available for {STAGE_LABEL[stage]}:</b>{' '}
            {upstream.map((j, i) => (
              <span key={j.jobNo}>
                {i > 0 && ', '}
                <span className="mono">{j.jobNo}</span> (at {STAGE_LABEL[j.currentStage]})
              </span>
            ))}
            . These jobs arrive here automatically when their current stage is completed.
          </div>
        </div>
      )}

    </>
  );
}

function Row({ r, onProcess }: { r: StageRecord; onProcess: () => void }) {
  const { state, openTrace } = useStore();
  const job = getJob(state, r.jobNo);
  const p = getProduct(state, job.productId);
  const mat = parseMaterialKey(job.materialKey);
  return (
    <tr>
      <td>
        <JobLink jobNo={r.jobNo} />
      </td>
      <td>
        <div className="strong">{p.name}</div>
        <div className="sub">{job.customer}</div>
      </td>
      {r.stage === 'cutting' && (
        <td>
          <div>{mat.material}</div>
          <div className="sub">
            OD {mat.od} mm · cut {r.params.cuttingLength} mm
          </div>
        </td>
      )}
      {r.stage === 'heatTreatment' && <td className="r strong nowrap">{r.params.temperature}°C</td>}
      <td className="nowrap">{fmtDateTime(r.receivedAt)}</td>
      <td className="r qty-cell">{fmtNum(r.input)}</td>
      <td className="r">{r.status === 'Completed' ? r.loss ? <span className="loss">−{r.loss}</span> : <span className="muted">0</span> : <span className="muted">—</span>}</td>
      <td className="r">{r.status === 'Completed' ? <span className="gain">{fmtNum(r.output)}</span> : <span className="muted">—</span>}</td>
      <td>
        {r.machine ? (
          <>
            <div>{r.machine}</div>
            <div className="sub">{r.operator}</div>
          </>
        ) : (
          <span className="muted">Not assigned</span>
        )}
      </td>
      <td>
        <Badge status={r.status} />
      </td>
      <td className="r nowrap">
        {r.status === 'Pending' && (
          <button className="btn btn-sm btn-primary" onClick={onProcess}>
            <Play size={13} /> Start
          </button>
        )}
        {r.status === 'In Progress' && (
          <button className="btn btn-sm btn-success" onClick={onProcess}>
            <CheckCircle2 size={13} /> Complete
          </button>
        )}
        {r.status === 'Completed' && <InlineQty input={r.input} loss={r.loss} output={r.output} />}
        <button className="icon-btn" style={{ display: 'inline-grid', verticalAlign: 'middle', marginLeft: 4 }} title="View traceability" onClick={() => openTrace(r.jobNo)}>
          <Eye size={16} />
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
export function StageModal({ stage, jobNo, onClose }: { stage: ProcessStage; jobNo: string; onClose: () => void }) {
  const { state, run } = useStore();
  const rec = stageRecords(state, stage).find((r) => r.jobNo === jobNo && r.status !== 'Completed');
  const job = getJob(state, jobNo);
  const p = getProduct(state, job.productId);
  const cfg = CFG[stage];
  const isPending = rec?.status === 'Pending';

  const [inputQty, setInputQty] = useState(String(rec?.input ?? 0));
  const [loss, setLoss] = useState('0');
  const [machine, setMachine] = useState(rec?.machine || MACHINES[stage][0]);
  const [operator, setOperator] = useState(rec?.operator || OPERATORS[PROCESS_STAGES.indexOf(stage)]);
  const [date, setDate] = useState(todayISO());
  const [lossReason, setLossReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [params, setParams] = useState<Record<string, string | number>>(() => ({ ...(rec?.params ?? {}) }));
  const setParam = (k: string, v: string | number) => setParams((x) => ({ ...x, [k]: v }));

  if (!rec) return null;
  const mat = parseMaterialKey(job.materialKey);
  const editableInput = stage === 'cutting' && isPending;
  const inN = editableInput ? Number(inputQty) : rec.input;
  const lossN = Number(loss);
  const out = inN - lossN;
  const prevRec = stage === 'cutting' ? null : stageRecords(state, PROCESS_STAGES[PROCESS_STAGES.indexOf(stage) - 1]).find((r) => r.jobNo === jobNo);
  const rawAvail = state.rawMaterials.filter((l) => `${l.material}|${l.od}` === job.materialKey).reduce((t, l) => t + l.availableQty, 0);

  const errIn = editableInput ? (!(inN > 0) || !Number.isInteger(inN) ? 'Enter a whole quantity' : inN > rawAvail ? `Only ${rawAvail} PCS in raw stock` : null) : null;
  const errLoss = loss === '' || lossN < 0 || !Number.isInteger(lossN) ? 'Whole number ≥ 0' : lossN > inN ? `Cannot exceed input (${inN})` : null;
  const errTemp = stage === 'heatTreatment' && !(Number(params.temperature) > 0) ? 'Enter temperature' : null;

  const cleanParams = () => {
    const o: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(params)) o[k] = typeof v === 'string' && v !== '' && !isNaN(Number(v)) && k !== 'dieNo' && k !== 'trimDie' ? Number(v) : v;
    return o;
  };

  const doStart = () => {
    if (errIn || errTemp) return;
    const ok = run(
      (d, now) => startStage(d, stage, jobNo, { inputQty: editableInput ? inN : undefined, machine, operator, params: cleanParams() }, tsFor(date, now)),
      {
        title: `${STAGE_LABEL[stage]} started`,
        message: stage === 'cutting' ? `${jobNo}: ${inN} PCS issued from raw inventory (FIFO).` : `${jobNo}: ${rec.input} PCS now in progress.`,
      },
    );
    if (ok) onClose();
  };
  const doComplete = () => {
    if (errIn || errLoss || errTemp) return;
    const ok = run(
      (d, now) =>
        completeStage(
          d,
          stage,
          jobNo,
          { inputQty: editableInput ? inN : undefined, loss: lossN, machine, operator, remarks: [lossN > 0 ? lossReason : '', remarks.trim()].filter(Boolean).join(' — '), params: cleanParams() },
          tsFor(date, now),
        ),
      {
        title: `${STAGE_LABEL[stage]} completed`,
        message: out > 0 ? `${jobNo}: ${inN} in − ${lossN} loss = ${out} PCS moved to ${cfg.to}.` : `${jobNo}: entire batch rejected.`,
      },
    );
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={FLOW_STEPS.find((f) => f.key === stage)!.icon}
      title={`${isPending ? 'Start' : 'Complete'} ${STAGE_LABEL[stage]} — ${jobNo}`}
      subtitle={`${p.name} · ${job.customer}`}
      footer={
        <>
          <span className="left">Output = Input − Loss / Rejection</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {isPending && (
            <button className="btn" disabled={!!errIn || !!errTemp} onClick={doStart}>
              <Play size={14} /> Start only (In Progress)
            </button>
          )}
          <button className="btn btn-success" disabled={!!errIn || !!errLoss || !!errTemp} onClick={doComplete}>
            <CheckCircle2 size={15} /> Complete &amp; move to {cfg.to}
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
          <div className="l">Received from</div>
          <div className="v">{cfg.from}</div>
        </div>
        <div>
          <div className="l">{stage === 'cutting' ? 'Planned Qty' : 'Received Qty'}</div>
          <div className="v">{fmtNum(stage === 'cutting' ? job.plannedQty : rec.input)} PCS</div>
        </div>
        <div>
          <div className="l">Status</div>
          <div className="v">
            <Badge status={rec.status} />
          </div>
        </div>
      </div>

      <div className="form-grid three">
        {stage === 'cutting' && (
          <>
            <Field label="Raw Material">
              <input className="input" readOnly value={mat.material} />
            </Field>
            <Field label="Raw Material OD">
              <NumInput value={mat.od} readOnly suffix="mm" />
            </Field>
            <Field label="Cutting Length" hint={`Standard: ${p.cuttingLength} mm`}>
              <NumInput value={params.cuttingLength ?? ''} onChange={(v) => setParam('cuttingLength', v)} suffix="mm" step="any" />
            </Field>
          </>
        )}
        <Field
          label={stage === 'cutting' ? 'Actual Input Quantity' : 'Input Quantity'}
          required
          error={errIn}
          hint={
            editableInput
              ? `${fmtNum(rawAvail)} PCS in raw stock`
              : stage === 'cutting'
                ? 'Issued from raw stock'
                : `= ${cfg.from} output${prevRec ? ` (${prevRec.input} − ${prevRec.loss})` : ''} · locked`
          }
        >
          <NumInput value={editableInput ? inputQty : rec.input} onChange={setInputQty} readOnly={!editableInput} bad={!!errIn} />
        </Field>
        <Field label="Loss / Rejection" required error={errLoss} hint="Enter on completion">
          <NumInput value={loss} onChange={setLoss} bad={!!errLoss} autoFocus={!isPending} />
        </Field>
        <Field label="Output Quantity" hint="Auto-calculated">
          <NumInput value={Number.isFinite(out) && out >= 0 ? out : ''} readOnly />
        </Field>

        {stage === 'forging' && (
          <Field label="Die No." hint="Linked to Die & Tool Management (Phase 2)">
            <input className="input mono" value={params.dieNo ?? ''} onChange={(e) => setParam('dieNo', e.target.value)} />
          </Field>
        )}
        {stage === 'trimming' && (
          <Field label="Trim Die No.">
            <input className="input mono" value={params.trimDie ?? ''} onChange={(e) => setParam('trimDie', e.target.value)} />
          </Field>
        )}
        {stage === 'heatTreatment' && (
          <>
            <Field label="Heat Treatment Temperature" required error={errTemp} hint={`${p.name} standard: ${p.htTemperature}°C`}>
              <NumInput value={params.temperature ?? ''} onChange={(v) => setParam('temperature', v)} suffix="°C" />
            </Field>
            <Field label="Soak Time" hint={`Standard: ${p.htSoakMinutes} min`}>
              <NumInput value={params.soakMinutes ?? ''} onChange={(v) => setParam('soakMinutes', v)} suffix="min" />
            </Field>
            <Field label="Process">
              <select value={params.process ?? ''} onChange={(e) => setParam('process', e.target.value)}>
                {[...new Set([String(params.process ?? ''), ...HT_PROCESSES])].filter(Boolean).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
            <Field label="Cooling / Quench">
              <select value={params.quench ?? ''} onChange={(e) => setParam('quench', e.target.value)}>
                {['Still air', 'Forced air', 'Oil quench', 'Water quench', 'Furnace cool'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
          </>
        )}
        <Field label={stage === 'heatTreatment' ? 'Furnace' : 'Machine'}>
          <select value={machine} onChange={(e) => setMachine(e.target.value)}>
            {MACHINES[stage].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Operator">
          <select value={operator} onChange={(e) => setOperator(e.target.value)}>
            {OPERATORS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Process Date">
          <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Loss Reason" hint={lossN > 0 ? 'Why the pieces were lost' : 'Only needed when there is a loss'}>
          <select value={lossReason} onChange={(e) => setLossReason(e.target.value)} disabled={!(lossN > 0)}>
            <option value="">{lossN > 0 ? 'Select reason…' : 'No loss'}</option>
            {LOSS_REASONS[stage].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Remarks">
          <input className="input" value={remarks} placeholder="Optional notes" onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>

      <div style={{ marginTop: 18 }}>
        <QtyFlow input={Number.isFinite(inN) ? inN : 0} loss={Number.isFinite(lossN) ? lossN : 0} output={Number.isFinite(out) && out >= 0 ? out : '—'} />
      </div>
      {editableInput ? (
        <FifoPreview keyId={job.materialKey} qty={inN} />
      ) : (
        stage === 'cutting' && (
          <div className="callout info">
            <Layers size={16} />
            <div>
              Issued via FIFO: {job.issues.map((i) => `${i.lotId} (${i.qty} PCS)`).join(' + ')}
            </div>
          </div>
        )
      )}
      {!errLoss && out >= 0 && (
        <div className={`callout ${out === 0 ? 'err' : 'ok'}`}>
          <Info size={16} />
          <div>
            {out === 0 ? (
              <>Entire batch will be marked as rejected — nothing moves forward.</>
            ) : (
              <>
                On completion, <b>{fmtNum(out)} PCS</b> move to <b>{cfg.to}</b> under the same job number <span className="mono">{jobNo}</span>
                {stage === 'heatTreatment' ? ' for inspection.' : '.'} The next stage cannot receive more than this.
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
