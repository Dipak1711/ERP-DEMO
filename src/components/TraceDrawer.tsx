import { useEffect, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2, ChevronRight, Printer, Scale, X } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { fgAvailable, fgStatus, jobSummary, parseMaterialKey, PROCESS_STAGES, STAGE_LABEL, type JobSummary } from '../store/engine';
import type { ProcessStage, StageRecord } from '../store/types';
import { Badge, FLOW_STEPS, go, Priority, QtyFlow } from './ui';
import { nextStep } from './workflow';
import { fmtDate, fmtDateTime, fmtKg, fmtNum } from './format';

type NodeState = 'done' | 'current' | 'upcoming' | 'final';

function Node({ step, state, title, badge, when, children }: { step: number; state: NodeState; title: string; badge?: ReactNode; when?: string; children: ReactNode }) {
  const I = FLOW_STEPS[step].icon;
  return (
    <div className={`tl-item ${state}`}>
      <div className="tl-dot">
        <I size={20} />
      </div>
      <div className="tl-card">
        <div className="tl-title">
          <h4>{title}</h4>
          {badge}
          {when && <span className="when">{when}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

function stageParams(r: StageRecord) {
  const p = r.params;
  const items: [string, ReactNode][] = [];
  if (r.stage === 'cutting' && p.cuttingLength) items.push(['Cutting length', `${p.cuttingLength} mm`]);
  if (r.stage === 'forging' && p.dieNo) items.push(['Die', p.dieNo]);
  if (r.stage === 'trimming' && p.trimDie) items.push(['Trim die', p.trimDie]);
  if (r.stage === 'heatTreatment') {
    items.push(['Temperature', <b style={{ color: 'var(--crit)' }}>{p.temperature}°C</b>]);
    if (p.soakMinutes) items.push(['Soak', `${p.soakMinutes} min`]);
    if (p.process) items.push(['Process', p.process]);
    if (p.quench) items.push(['Cooling', p.quench]);
  }
  if (r.machine) items.push(['Machine', r.machine]);
  if (r.operator) items.push(['Operator', r.operator]);
  return items;
}

function Meta({ items }: { items: [string, ReactNode][] }) {
  if (!items.length) return null;
  return (
    <div className="tl-meta">
      {items.map(([k, v]) => (
        <span key={k}>
          {k}: <b>{v}</b>
        </span>
      ))}
    </div>
  );
}

function reconcile(j: JobSummary) {
  if (!j.issuedQty) return null;
  const fgQty = j.fg.reduce((t, f) => t + f.qty, 0);
  const parts: string[] = [];
  if (j.processLoss) parts.push(`${j.processLoss} process loss`);
  if (j.qcRejected) parts.push(`${j.qcRejected} QC rejected`);
  let wip = 0;
  if (j.flowIndex >= 1 && j.flowIndex <= 5) {
    wip = j.currentQty;
    parts.push(`${wip} WIP at ${STAGE_LABEL[j.job.currentStage]}`);
  }
  if (fgQty) {
    const res = j.fg.reduce((t, f) => t + f.reservedQty, 0);
    parts.push(`${fgQty} finished goods (${j.dispatchedQty} dispatched, ${res} packed, ${j.fgAvailableQty} in stock)`);
  }
  const ok = j.processLoss + j.qcRejected + wip + fgQty === j.issuedQty;
  return { text: `${j.issuedQty} PCS issued = ${parts.join(' + ')}`, ok };
}

export function TraceDrawer() {
  const { state, traceJob, openTrace, openAction } = useStore();

  useEffect(() => {
    if (!traceJob) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && openTrace(null);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [traceJob, openTrace]);

  if (!traceJob || !state.jobs.some((j) => j.jobNo === traceJob)) return null;
  const j = jobSummary(state, traceJob);
  const { job, product } = j;
  const mat = parseMaterialKey(job.materialKey);
  const cur = j.flowIndex;
  const nodeState = (i: number): NodeState => {
    if (j.status === 'Rejected') {
      // stages that have records are done; nothing current
      return 'upcoming';
    }
    if (i === 7 && cur === 7) return 'final';
    if (i < cur) return 'done';
    if (i === cur) return 'current';
    return 'upcoming';
  };
  const lots = new Map(state.rawMaterials.map((l) => [l.id, l]));
  const rec = reconcile(j);
  const ledger = state.movements.filter((m) => m.jobNo === job.jobNo).slice().reverse();
  const next = nextStep(state, job.jobNo);
  const NextIcon = FLOW_STEPS.find((f) => f.key === next?.stageKey)?.icon ?? CheckCircle2;

  return (
    <>
      <div className="drawer-overlay no-print" onClick={() => openTrace(null)} />
      <aside className="drawer" role="dialog" aria-label={`Traceability ${job.jobNo}`}>
        <div className="drawer-head">
          <div className="row">
            <div>
              <div className="k">Job Traceability · Production Order</div>
              <h2>{job.jobNo}</h2>
              <div className="prod">
                {product.name} · {job.customer}
              </div>
            </div>
            <button className="icon-btn no-print" title="Print job card" onClick={() => window.print()}>
              <Printer size={18} />
            </button>
            <button className="icon-btn no-print" style={{ marginLeft: 0 }} onClick={() => openTrace(null)} aria-label="Close">
              <X size={20} />
            </button>
          </div>
          <div className="trace-sum">
            <div>
              <div className="l">Raw Issued</div>
              <div className="v">{fmtNum(j.issuedQty || 0)}</div>
            </div>
            <div>
              <div className="l">Total Loss</div>
              <div className="v red">{fmtNum(j.totalLoss)}</div>
            </div>
            <div>
              <div className="l">QC Accepted</div>
              <div className="v green">{j.qc && j.qc.status !== 'QC Pending' ? fmtNum(j.qc.accepted) : '—'}</div>
            </div>
            <div>
              <div className="l">Dispatched</div>
              <div className="v">{fmtNum(j.dispatchedQty)}</div>
            </div>
            <div>
              <div className="l">Yield</div>
              <div className="v">{j.yieldPct != null ? `${j.yieldPct.toFixed(1)}%` : '—'}</div>
            </div>
          </div>
        </div>

        <div className="drawer-body">
          {next ? (
            <div className="next-step no-print">
              <span className="ns-ic">
                <NextIcon size={20} />
              </span>
              <div>
                <b>Next step: {next.label}</b>
                <span>{next.detail} — the timeline below updates as soon as you save.</span>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (next.action) openAction(next.action);
                  else if (next.route) {
                    openTrace(null);
                    go(next.route);
                  }
                }}
              >
                {next.label} <ChevronRight size={16} />
              </button>
            </div>
          ) : (
            <div className="next-step done no-print">
              <span className="ns-ic">
                <CheckCircle2 size={20} />
              </span>
              <div>
                <b>{j.status === 'Rejected' ? 'Job closed — batch rejected' : 'Job complete — fully dispatched'}</b>
                <span>
                  {j.status === 'Rejected'
                    ? 'Nothing left to process for this job.'
                    : `${fmtNum(j.dispatchedQty)} PCS delivered to ${job.customer.replace(/\.$/, '')}. Full journey below.`}
                </span>
              </div>
            </div>
          )}
          <div className="info-strip">
            <div>
              <div className="l">Status</div>
              <div className="v">
                <Badge status={j.status} />
              </div>
            </div>
            <div>
              <div className="l">Current Stage</div>
              <div className="v">{STAGE_LABEL[job.currentStage]}</div>
            </div>
            <div>
              <div className="l">Planned Qty</div>
              <div className="v">{fmtNum(job.plannedQty)} PCS</div>
            </div>
            <div>
              <div className="l">Priority</div>
              <div className="v">
                <Priority p={job.priority} />
              </div>
            </div>
            <div>
              <div className="l">Created</div>
              <div className="v">{fmtDate(job.createdAt)}</div>
            </div>
            <div>
              <div className="l">Due</div>
              <div className="v">{fmtDate(job.dueDate)}</div>
            </div>
          </div>

          <div className="timeline">
            {/* 1 · RAW MATERIAL */}
            <Node
              step={0}
              state={j.issuedQty ? 'done' : 'current'}
              title="Raw Material"
              badge={j.issuedQty ? <span className="badge b-green">Issued · FIFO</span> : <Badge status="Pending" />}
              when={j.records.cutting?.startedAt ? fmtDateTime(j.records.cutting.startedAt) : undefined}
            >
              <Meta
                items={[
                  ['Material', `${mat.material}`],
                  ['OD', `${mat.od} mm`],
                  [j.issuedQty ? 'Issued' : 'Planned', `${fmtNum(j.issuedQty || job.plannedQty)} PCS${j.issuedQty ? ` · ${fmtKg(j.issuedWeight)}` : ''}`],
                ]}
              />
              {job.issues.length > 0 ? (
                <table className="mini-tbl">
                  <thead>
                    <tr>
                      <th>Lot</th>
                      <th>Supplier</th>
                      <th>Heat No.</th>
                      <th>Inward</th>
                      <th className="r">Qty</th>
                      <th className="r">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.issues.map((is) => {
                      const l = lots.get(is.lotId);
                      return (
                        <tr key={is.lotId}>
                          <td className="mono">{is.lotId}</td>
                          <td>{l?.supplier}</td>
                          <td className="mono">{l?.heatNo}</td>
                          <td>{fmtDate(l?.inwardDate)}</td>
                          <td className="r num strong">{is.qty}</td>
                          <td className="r num">{fmtKg(is.weight)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="callout info">Material will be issued from the oldest lots first (FIFO) when Cutting starts.</div>
              )}
            </Node>

            {/* 2-5 · PROCESS STAGES */}
            {PROCESS_STAGES.map((st: ProcessStage, idx) => {
              const r = j.records[st];
              const i = idx + 1;
              const s = r ? (r.status === 'Completed' ? 'done' : 'current') : nodeState(i);
              return (
                <Node
                  key={st}
                  step={i}
                  state={s}
                  title={STAGE_LABEL[st]}
                  badge={r ? <Badge status={r.status} /> : undefined}
                  when={r ? fmtDateTime(r.completedAt ?? r.startedAt ?? r.receivedAt) : undefined}
                >
                  {r ? (
                    <>
                      {r.status === 'Completed' ? (
                        <div className="tl-q">
                          <QtyFlow small input={r.input} loss={r.loss} output={r.output} />
                        </div>
                      ) : (
                        <div className="tl-meta">
                          <span>
                            Received: <b>{fmtNum(r.input)} PCS</b>
                          </span>
                          <span>{r.status === 'Pending' ? 'Awaiting start' : `Started ${fmtDateTime(r.startedAt)}`}</span>
                        </div>
                      )}
                      <Meta items={stageParams(r)} />
                      {r.loss > 0 && r.status === 'Completed' && (
                        <div style={{ marginTop: 10 }}>
                          <span className="loss-tag">
                            {r.loss} PCS lost at {STAGE_LABEL[st]}
                            {r.remarks ? ` — ${r.remarks}` : ''}
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="tl-meta">
                      <span className="muted">Not yet reached</span>
                    </div>
                  )}
                </Node>
              );
            })}

            {/* 6 · QC */}
            <Node
              step={5}
              state={j.qc ? (j.qc.status === 'QC Pending' ? 'current' : 'done') : nodeState(5)}
              title="Quality Control"
              badge={j.qc ? <Badge status={j.qc.status} /> : undefined}
              when={j.qc ? fmtDateTime(j.qc.inspectedAt ?? j.qc.receivedAt) : undefined}
            >
              {j.qc ? (
                j.qc.status === 'QC Pending' ? (
                  <div className="tl-meta">
                    <span>
                      Received for inspection: <b>{fmtNum(j.qc.input)} PCS</b>
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="tl-q">
                      <QtyFlow small input={j.qc.input} loss={j.qc.rejected} output={j.qc.accepted} labels={['Inspected', 'Rejected', 'Accepted']} />
                    </div>
                    <Meta
                      items={[
                        ['Inspector', j.qc.inspector],
                        ['Checks', Object.entries(j.qc.checks).filter(([, v]) => v).map(([k]) => k[0].toUpperCase() + k.slice(1)).join(', ') || '—'],
                        ...(j.qc.rejectionReason ? ([['Rejection reason', j.qc.rejectionReason]] as [string, ReactNode][]) : []),
                      ]}
                    />
                  </>
                )
              ) : (
                <div className="tl-meta">
                  <span className="muted">Not yet reached</span>
                </div>
              )}
            </Node>

            {/* 7 · FINISHED GOODS */}
            <Node
              step={6}
              state={j.fg.length ? (cur === 6 ? 'current' : 'done') : nodeState(6)}
              title="Finished Goods"
              badge={j.fg[0] ? <Badge status={fgStatus(j.fg[0])} /> : undefined}
              when={j.fg[0] ? fmtDateTime(j.fg[0].receivedAt) : undefined}
            >
              {j.fg.length ? (
                j.fg.map((f) => (
                  <div key={f.id}>
                    <Meta
                      items={[
                        ['FG Lot', <span className="mono">{f.id}</span>],
                        ['Received', `${fmtNum(f.qty)} PCS`],
                        ['Available', `${fmtNum(fgAvailable(f))} PCS`],
                        ['Packed', `${fmtNum(f.reservedQty)} PCS`],
                        ['Location', f.location],
                      ]}
                    />
                  </div>
                ))
              ) : (
                <div className="tl-meta">
                  <span className="muted">Not yet reached</span>
                </div>
              )}
            </Node>

            {/* 8 · DISPATCH */}
            <Node
              step={7}
              state={j.dispatches.length ? (cur === 7 ? 'final' : 'current') : nodeState(7)}
              title="Dispatch"
              badge={j.dispatchedQty ? <span className="badge b-teal">{fmtNum(j.dispatchedQty)} PCS dispatched</span> : undefined}
            >
              {j.dispatches.length ? (
                j.dispatches
                  .slice()
                  .reverse()
                  .map((d) => (
                    <div key={d.dispatchNo} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                      <div className="tl-title">
                        <span className="mono strong">{d.dispatchNo}</span>
                        <Badge status={d.status} />
                        <span className="when">{fmtDate(d.date)}</span>
                      </div>
                      <Meta
                        items={[
                          ['Customer', d.customer],
                          ['Qty', `${fmtNum(d.qty)} PCS`],
                          ['Vehicle', d.vehicleNo || '—'],
                          ['Bags', `${d.bags.length}`],
                          ['Weight', fmtKg(d.weight)],
                          ['Invoice', d.invoiceNo],
                        ]}
                      />
                      <div className="bags">
                        {d.bags.map((b) => (
                          <div className="bag" key={b.no}>
                            <span className="muted">Bag {b.no}</span>
                            <b>{b.qty} PCS</b>
                            {b.weight.toFixed(3)} kg
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
              ) : (
                <div className="tl-meta">
                  <span className="muted">Not yet reached</span>
                </div>
              )}
            </Node>
          </div>

          {rec && (
            <div className={`callout ${rec.ok ? 'ok' : 'warn'}`} style={{ marginTop: 4 }}>
              {rec.ok ? <CheckCircle2 size={16} /> : <Scale size={16} />}
              <div>
                <b>Quantity reconciliation {rec.ok ? '✓ balanced' : '— check'}</b>
                <div>{rec.text}</div>
              </div>
            </div>
          )}

          {ledger.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-head">
                <h3>Quantity Movement Ledger</h3>
                <span className="sub">Every transfer recorded for this job</span>
              </div>
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date / Time</th>
                      <th>Movement</th>
                      <th className="r">Qty Moved</th>
                      <th className="r">Loss</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((m) => (
                      <tr key={m.id}>
                        <td className="nowrap">{fmtDateTime(m.ts)}</td>
                        <td className="nowrap">
                          {m.from} <ArrowRight size={12} style={{ verticalAlign: -1 }} /> <b>{m.to}</b>
                        </td>
                        <td className="r qty-cell">{fmtNum(m.qty)}</td>
                        <td className="r">{m.loss ? <span className="loss">−{m.loss}</span> : <span className="muted">0</span>}</td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {m.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
