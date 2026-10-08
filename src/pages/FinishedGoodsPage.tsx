import { useMemo, useState } from 'react';
import { Eye, PackageCheck, Truck } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { fgAvailable, fgStatus, fgWeight, getJob, getProduct } from '../store/engine';
import { Badge, Empty, JobLink, PageHeader, rowTone, Search, SummaryLine, Tabs } from '../components/ui';
import { fmtDate, fmtKg, fmtNum, matches } from '../components/format';

type Filter = 'stock' | 'dispatched' | 'all';

export function FinishedGoodsPage({ navigate }: { navigate: (r: string) => void }) {
  const { state, openTrace } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const fgs = state.finishedGoods;

  const total = fgs.reduce((t, f) => t + f.qty, 0);
  const avail = fgs.reduce((t, f) => t + fgAvailable(f), 0);
  const reserved = fgs.reduce((t, f) => t + f.reservedQty, 0);
  const dispatched = fgs.reduce((t, f) => t + f.dispatchedQty, 0);
  const availKg = fgs.reduce((t, f) => t + fgWeight(state, f, fgAvailable(f)), 0);
  const inStock = fgs.filter((f) => f.dispatchedQty < f.qty);

  const byProduct = useMemo(() => {
    return state.products
      .map((p) => {
        const lots = fgs.filter((f) => f.productId === p.id);
        const a = lots.reduce((t, f) => t + fgAvailable(f), 0);
        const r = lots.reduce((t, f) => t + f.reservedQty, 0);
        return { p, a, r, kg: a * p.finishedWeight, lots: lots.filter((f) => fgAvailable(f) > 0).length };
      })
      .filter((x) => x.a + x.r > 0 || fgs.some((f) => f.productId === x.p.id));
  }, [state.products, fgs]);

  const rows = fgs
    .filter((f) => (filter === 'all' ? true : filter === 'stock' ? f.dispatchedQty < f.qty : f.dispatchedQty === f.qty))
    .filter((f) => {
      const job = getJob(state, f.jobNo);
      return matches(q, f.id, f.jobNo, getProduct(state, f.productId).name, job.customer, f.location);
    })
    .slice()
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Step 7 of 8"
        title="Finished Goods"
        flow="finishedGoods"
        actions={
          <button className="btn btn-primary" onClick={() => navigate('dispatch?new=1')}>
            <Truck size={16} /> New Dispatch
          </button>
        }
      />
      <div className="card mb">
        <div className="card-head">
          <div>
            <h3>Stock by Product</h3>
          </div>
          {total > 0 && (
            <div className="right">
              <SummaryLine
                items={[
                  { label: `PCS available (${fmtKg(availKg)})`, value: fmtNum(avail), tone: 'good' },
                  { label: 'PCS packed', value: fmtNum(reserved), tone: 'info' },
                  { label: 'PCS dispatched', value: fmtNum(dispatched) },
                ]}
              />
            </div>
          )}
        </div>
        <div className="card-body">
          {byProduct.length === 0 ? (
            <Empty title="No finished goods yet" text="QC-approved quantity will appear here." />
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {byProduct.map(({ p, a, r, kg, lots }) => (
                <div key={p.id} className="kpi" style={{ boxShadow: 'none' }}>
                  <div className="kpi-top">
                    <span className="kpi-label">{p.name}</span>
                    <span className="chip mono">{p.code}</span>
                  </div>
                  <div className="kpi-value">
                    {fmtNum(a)}
                    <small>PCS available</small>
                  </div>
                  <div className="kpi-hint">
                    {fmtKg(kg)} · {lots} lot{lots === 1 ? '' : 's'}
                    {r > 0 && <> · {fmtNum(r)} packed</>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Finished Goods Inventory</h3>
          </div>
        </div>
        <div className="toolbar">
          <Tabs
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: 'All', count: fgs.length, tone: 'blue' },
              { value: 'stock', label: 'In Stock', count: inStock.length, tone: 'green' },
              { value: 'dispatched', label: 'Fully Dispatched', count: fgs.length - inStock.length, tone: 'teal' },
            ]}
          />
          <Search value={q} onChange={setQ} placeholder="Search lot, job, product…" />
        </div>
        {rows.length === 0 ? (
          <Empty icon={PackageCheck} title="No finished goods in this view" text="Finished goods are created automatically when QC approves a batch." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>FG Lot</th>
                  <th>Product</th>
                  <th>Job No.</th>
                  <th className="r">Quantity</th>
                  <th className="r">Weight</th>
                  <th>Completion Date</th>
                  <th className="r">Packed</th>
                  <th className="r">Dispatched</th>
                  <th className="r">Available</th>
                  <th>Status</th>
                  <th className="r">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  const p = getProduct(state, f.productId);
                  const a = fgAvailable(f);
                  return (
                    <tr key={f.id} className={rowTone(fgStatus(f))}>
                      <td>
                        <div className="mono strong">{f.id}</div>
                        <div className="sub">{f.location}</div>
                      </td>
                      <td>
                        <div className="strong">{p.name}</div>
                        <div className="sub">{getJob(state, f.jobNo).customer}</div>
                      </td>
                      <td>
                        <JobLink jobNo={f.jobNo} />
                      </td>
                      <td className="r qty-cell">{fmtNum(f.qty)}</td>
                      <td className="r num nowrap">{fmtKg(fgWeight(state, f))}</td>
                      <td className="nowrap">{fmtDate(f.receivedAt)}</td>
                      <td className="r num">{f.reservedQty || <span className="muted">0</span>}</td>
                      <td className="r num">{f.dispatchedQty || <span className="muted">0</span>}</td>
                      <td className="r">
                        <span className={a ? 'gain' : 'muted'} style={{ fontSize: 15 }}>
                          {fmtNum(a)}
                        </span>
                      </td>
                      <td>
                        <Badge status={fgStatus(f)} />
                      </td>
                      <td className="r nowrap">
                        {a > 0 && (
                          <button className="btn btn-sm btn-primary" onClick={() => navigate(`dispatch?fg=${f.id}`)}>
                            <Truck size={13} /> Dispatch
                          </button>
                        )}
                        <button className="icon-btn" style={{ display: 'inline-grid', verticalAlign: 'middle', marginLeft: 4 }} title="View traceability" onClick={() => openTrace(f.jobNo)}>
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
