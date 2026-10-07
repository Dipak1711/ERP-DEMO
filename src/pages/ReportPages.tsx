import { useState } from 'react';
import { ArrowRight, Eye, Waypoints } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { jobSummary, PROCESS_STAGES, STAGE_LABEL } from '../store/engine';
import { Badge, Empty, JobLink, PageHeader, Priority, Search, Stepper, Tabs } from '../components/ui';
import { fmtDate, fmtDateTime, fmtNum, matches } from '../components/format';

// ------------------------------------------------------- Job Traceability ---
export function TraceabilityPage() {
  const { state, openTrace } = useStore();
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'wip' | 'done'>('all');
  const rows = state.jobs
    .map((j) => jobSummary(state, j.jobNo))
    .filter((s) => (f === 'all' ? true : f === 'wip' ? s.flowIndex >= 1 && s.flowIndex <= 6 : s.flowIndex === 7))
    .filter((s) => matches(q, s.job.jobNo, s.product.name, s.job.customer, STAGE_LABEL[s.job.currentStage]))
    .reverse();
  const wip = state.jobs.filter((j) => !['dispatched', 'scrapped'].includes(j.currentStage)).length;

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Job Traceability"
        subtitle="Every production job with its stage-wise quantities. Open any job to see where its quantity came from, where loss occurred and how much was finally dispatched."
      />
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={f}
            onChange={setF}
            items={[
              { value: 'all', label: 'All jobs', count: state.jobs.length },
              { value: 'wip', label: 'In production / FG', count: wip },
              { value: 'done', label: 'Dispatched', count: state.jobs.filter((j) => j.currentStage === 'dispatched').length },
            ]}
          />
          <Search value={q} onChange={setQ} placeholder="Search job, product, customer, stage…" />
        </div>
        {rows.length === 0 ? (
          <Empty icon={Waypoints} title="No jobs match" />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Job No.</th>
                  <th>Product / Customer</th>
                  <th className="r">Raw Issued</th>
                  {PROCESS_STAGES.map((s) => (
                    <th key={s} className="r">
                      {STAGE_LABEL[s]}
                    </th>
                  ))}
                  <th className="r">QC Acc / Rej</th>
                  <th className="r">Dispatched</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.job.jobNo}>
                    <td>
                      <JobLink jobNo={s.job.jobNo} />
                      <div className="sub">{fmtDate(s.job.createdAt)}</div>
                    </td>
                    <td>
                      <div className="strong">{s.product.name}</div>
                      <div className="sub">
                        {s.job.customer} · <Priority p={s.job.priority} />
                      </div>
                    </td>
                    <td className="r qty-cell">{s.issuedQty ? fmtNum(s.issuedQty) : <span className="muted">—</span>}</td>
                    {PROCESS_STAGES.map((st) => {
                      const r = s.records[st];
                      return (
                        <td key={st} className="r nowrap">
                          {r?.status === 'Completed' ? (
                            <>
                              <span className="gain">{fmtNum(r.output)}</span>
                              {r.loss > 0 && <div className="sub loss">−{r.loss}</div>}
                            </>
                          ) : r ? (
                            <span className="chip">{r.status === 'Pending' ? 'Waiting' : 'Running'}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="r nowrap">
                      {s.qc && s.qc.status !== 'QC Pending' ? (
                        <>
                          <span className="gain">{s.qc.accepted}</span> / <span className={s.qc.rejected ? 'loss' : 'muted'}>{s.qc.rejected}</span>
                        </>
                      ) : s.qc ? (
                        <span className="chip">Waiting</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="r qty-cell">{s.dispatchedQty ? fmtNum(s.dispatchedQty) : <span className="muted">—</span>}</td>
                    <td>
                      <Stepper index={s.flowIndex} />
                    </td>
                    <td>
                      <Badge status={s.status} />
                    </td>
                    <td className="r">
                      <button className="btn btn-sm btn-primary" onClick={() => openTrace(s.job.jobNo)}>
                        <Eye size={14} /> View Job
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------- Quantity Ledger ---
export function LedgerPage() {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const rows = state.movements.filter((m) => matches(q, m.jobNo, m.from, m.to, m.note));
  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Quantity Movement Ledger"
        subtitle="Audit trail of every quantity transfer — supplier inward, FIFO issues, stage-to-stage transfers with loss, QC acceptance and dispatch."
      />
      <div className="card">
        <div className="toolbar">
          <Search value={q} onChange={setQ} placeholder="Search job, stage, lot, vehicle…" />
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
            {rows.length} movements
          </span>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Job No.</th>
                <th>From</th>
                <th />
                <th>To</th>
                <th className="r">Qty Moved</th>
                <th className="r">Loss</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{fmtDateTime(m.ts)}</td>
                  <td>{m.jobNo !== '—' ? <JobLink jobNo={m.jobNo} /> : <span className="muted">—</span>}</td>
                  <td>{m.from}</td>
                  <td>
                    <ArrowRight size={14} className="muted" />
                  </td>
                  <td className="strong">{m.to}</td>
                  <td className="r qty-cell">{fmtNum(m.qty)}</td>
                  <td className="r">{m.loss ? <span className="loss">−{m.loss}</span> : <span className="muted">0</span>}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {m.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// -------------------------------------------------------- Product Master ---
export function ProductsPage() {
  const { state } = useStore();
  return (
    <>
      <PageHeader
        eyebrow="Masters"
        title="Product Master"
        subtitle="Product-wise process parameters. Heat-treatment temperature, raw material, cutting length and die are defined per product and pre-filled at each stage."
      />
      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th>Product</th>
                <th>Raw Material</th>
                <th className="r">Cut Length</th>
                <th className="r">Finished Wt.</th>
                <th>Forging Die</th>
                <th className="r">HT Temp.</th>
                <th>HT Process</th>
                <th>Default Customer</th>
              </tr>
            </thead>
            <tbody>
              {state.products.map((p) => (
                <tr key={p.id}>
                  <td className="mono strong">{p.code}</td>
                  <td className="strong">{p.name}</td>
                  <td>
                    {p.material}
                    <div className="sub">OD {p.od} mm</div>
                  </td>
                  <td className="r num">{p.cuttingLength} mm</td>
                  <td className="r num">{p.finishedWeight} kg</td>
                  <td className="mono">{p.dieNo}</td>
                  <td className="r strong nowrap">{p.htTemperature}°C</td>
                  <td>
                    {p.htProcess}
                    <div className="sub">
                      {p.htSoakMinutes} min · {p.htQuench}
                    </div>
                  </td>
                  <td>{p.defaultCustomer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
