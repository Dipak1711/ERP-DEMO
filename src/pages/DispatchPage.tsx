import { useEffect, useState } from 'react';
import { Eye, FileText, PackageOpen, Plus, Printer, Truck, X } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { createDispatch, fgAvailable, getProduct, isToday, markDispatched, round3 } from '../store/engine';
import type { Dispatch } from '../store/types';
import { Badge, Empty, Field, JobLink, Modal, PageHeader, Search, SummaryLine, Tabs } from '../components/ui';
import { tsFor } from '../components/NewJobModal';
import { fmtDate, fmtKg, fmtNum, matches, todayISO } from '../components/format';

type Filter = 'all' | 'Ready for Dispatch' | 'Dispatched' | 'today';

export function DispatchPage({ query }: { query: URLSearchParams }) {
  const { state, openTrace, openAction } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const newDispatch = (fgId = '') => openAction({ kind: 'dispatch', fgId });
  // deep links from Finished Goods: #/dispatch?fg=FG-… or ?new=1
  useEffect(() => {
    if (!query.get('fg') && !query.get('new')) return;
    newDispatch(query.get('fg') ?? '');
    // drop the one-shot query so a browser refresh doesn't reopen the form
    window.history.replaceState(null, '', '#/dispatch');
  }, []);
  const [shipping, setShipping] = useState<Dispatch | null>(null);
  const [viewing, setViewing] = useState<Dispatch | null>(null);

  const ds = state.dispatches;
  const today = ds.filter((d) => d.status === 'Dispatched' && isToday(d.dispatchedAt));
  const ready = ds.filter((d) => d.status === 'Ready for Dispatch');
  const shipped = ds.filter((d) => d.status === 'Dispatched');
  const fgAvail = state.finishedGoods.reduce((t, f) => t + fgAvailable(f), 0);

  const rows = ds
    .filter((d) => (filter === 'all' ? true : filter === 'today' ? today.includes(d) : d.status === filter))
    .filter((d) => matches(q, d.dispatchNo, d.jobNo, d.customer, d.vehicleNo, getProduct(state, d.productId).name, d.invoiceNo));

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Step 8 of 8"
        title="Dispatch"
        flow="dispatched"
        actions={
          <button className="btn btn-primary" onClick={() => newDispatch()}>
            <Plus size={16} /> New Dispatch
          </button>
        }
      />
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Dispatch Register</h3>
          </div>
          {(ds.length > 0 || fgAvail > 0) && (
            <div className="right">
              <SummaryLine
                items={[
                  { label: 'PCS dispatched today', value: fmtNum(today.reduce((t, d) => t + d.qty, 0)), tone: 'good' },
                  { label: `PCS dispatched in total (${fmtKg(round3(shipped.reduce((t, d) => t + d.weight, 0)))})`, value: fmtNum(shipped.reduce((t, d) => t + d.qty, 0)) },
                  { label: 'PCS in FG to dispatch', value: fmtNum(fgAvail), tone: 'info' },
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
              { value: 'all', label: 'All', count: ds.length },
              ...(ready.length ? [{ value: 'Ready for Dispatch' as const, label: 'Ready for Dispatch', count: ready.length }] : []),
              { value: 'Dispatched', label: 'Dispatched', count: shipped.length },
              { value: 'today', label: 'Today', count: today.length },
            ]}
          />
          <Search value={q} onChange={setQ} placeholder="Search dispatch, job, customer, vehicle…" />
        </div>
        {rows.length === 0 ? (
          <Empty icon={Truck} title="No dispatches in this view" text="Create a dispatch from available finished goods." action={<button className="btn btn-primary" onClick={() => newDispatch()}><Plus size={15} /> New Dispatch</button>} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Dispatch No.</th>
                  <th>Job No.</th>
                  <th>Customer / Product</th>
                  <th className="r">Quantity</th>
                  <th className="r">Bags</th>
                  <th className="r">Weight</th>
                  <th>Vehicle</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="r">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const p = getProduct(state, d.productId);
                  return (
                    <tr key={d.dispatchNo}>
                      <td>
                        <div className="mono strong">{d.dispatchNo}</div>
                        <div className="sub">{d.invoiceNo}</div>
                      </td>
                      <td>
                        <JobLink jobNo={d.jobNo} />
                      </td>
                      <td>
                        <div className="strong">{d.customer}</div>
                        <div className="sub">{p.name}</div>
                      </td>
                      <td className="r qty-cell">{fmtNum(d.qty)}</td>
                      <td className="r num">
                        {d.bags.length}
                        <div className="sub">{d.bags[0]?.qty} / bag</div>
                      </td>
                      <td className="r num nowrap">{fmtKg(d.weight)}</td>
                      <td className="mono nowrap">{d.vehicleNo || <span className="muted">—</span>}</td>
                      <td className="nowrap">{fmtDate(d.date)}</td>
                      <td>
                        <Badge status={d.status} />
                      </td>
                      <td className="r nowrap">
                        {d.status === 'Ready for Dispatch' && (
                          <button className="btn btn-sm btn-success" onClick={() => setShipping(d)}>
                            <Truck size={13} /> Dispatch
                          </button>
                        )}
                        <button className="icon-btn" style={{ display: 'inline-grid', verticalAlign: 'middle', marginLeft: 4 }} title="Packing list" onClick={() => setViewing(d)}>
                          <FileText size={16} />
                        </button>
                        <button className="icon-btn" style={{ display: 'inline-grid', verticalAlign: 'middle' }} title="View traceability" onClick={() => openTrace(d.jobNo)}>
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

      {shipping && <ShipModal d={shipping} onClose={() => setShipping(null)} />}
      {viewing && <PackingList d={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/** Packing / dispatch as on the route card: Vehicle No. and one row per bag (qty + weight). */
export function NewDispatchModal({ fgId: initial, onClose }: { fgId: string; onClose: () => void }) {
  const { state, run } = useStore();
  const lots = state.finishedGoods.filter((f) => fgAvailable(f) > 0);
  const [fgId, setFgId] = useState(lots.find((f) => f.id === initial)?.id ?? lots[0]?.id ?? '');
  const fg = lots.find((f) => f.id === fgId);
  const product = fg ? getProduct(state, fg.productId) : null;
  const avail = fg ? fgAvailable(fg) : 0;
  const [vehicle, setVehicle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [bags, setBags] = useState<{ qty: string; weight: string }[]>([{ qty: '', weight: '' }]);

  const unitKg = product?.finishedWeight ?? 0;
  const rows = bags.map((b) => {
    const q = Number(b.qty);
    const autoKg = q > 0 ? round3(q * unitKg) : 0;
    return { q, kg: Number(b.weight) > 0 ? Number(b.weight) : autoKg, autoKg, bad: b.qty !== '' && (!(q > 0) || !Number.isInteger(q)) };
  });
  const totalQty = rows.reduce((t, r) => t + (r.q > 0 ? r.q : 0), 0);
  const totalKg = round3(rows.reduce((t, r) => t + r.kg, 0));
  const nextNo = `DSP-${new Date().getFullYear()}-${String(state.counters.dispatch + 1).padStart(4, '0')}`;
  const over = totalQty > avail;
  const invalid = !fg || !vehicle.trim() || totalQty === 0 || over || rows.some((r) => r.bad || !(r.q > 0));

  const setBag = (i: number, k: 'qty' | 'weight', v: string) => setBags((list) => list.map((b, j) => (j === i ? { ...b, [k]: v } : b)));

  const submit = () => {
    const ok = run(
      (d, now) =>
        createDispatch(
          d,
          { fgId, vehicleNo: vehicle, date, status: 'Dispatched', bags: rows.map((r) => ({ qty: r.q, weight: r.kg })) },
          tsFor(date, now),
        ),
      { title: 'Goods dispatched', message: `${nextNo}: ${totalQty} PCS in ${bags.length} bag${bags.length === 1 ? '' : 's'} on ${vehicle.toUpperCase()}.` },
    );
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={Truck}
      title="Dispatch"
      subtitle="Bag-wise packing, as on the route card."
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-success" disabled={invalid} onClick={submit}>
            <Truck size={15} /> Dispatch {totalQty > 0 ? `${fmtNum(totalQty)} PCS` : ''}
          </button>
        </>
      }
    >
      {lots.length === 0 ? (
        <Empty icon={PackageOpen} title="No finished goods available" text="Complete QC on a job to add stock to Finished Goods." />
      ) : (
        <>
          <div className="form-grid three">
            <Field label="Job Card No." required hint={product ? `${product.name} · ${fmtNum(avail)} PCS available` : undefined}>
              <select value={fgId} onChange={(e) => setFgId(e.target.value)}>
                {lots.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.jobNo} · {getProduct(state, f.productId).name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Vehicle No." required>
              <input className="input mono" placeholder="GJ13AX3059" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} />
            </Field>
          </div>

          <div className="section-label">Bags</div>
          <table className="bag-tbl">
            <thead>
              <tr>
                <th>Bag</th>
                <th>Qty (PCS)</th>
                <th>Weight (KG)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bags.map((b, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <input className={`input num ${rows[i].bad ? 'bad' : ''}`} type="number" min={1} value={b.qty} autoFocus={i === bags.length - 1 && i > 0} onChange={(e) => setBag(i, 'qty', e.target.value)} />
                  </td>
                  <td>
                    <input className="input num" type="number" min={0} step="any" value={b.weight} placeholder={rows[i].autoKg ? String(rows[i].autoKg) : ''} onChange={(e) => setBag(i, 'weight', e.target.value)} />
                  </td>
                  <td>
                    {bags.length > 1 && (
                      <button className="icon-btn" title="Remove bag" onClick={() => setBags((list) => list.filter((_, j) => j !== i))}>
                        <X size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <button className="btn btn-sm btn-soft" onClick={() => setBags((list) => [...list, { qty: list[list.length - 1]?.qty ?? '', weight: '' }])}>
                    <Plus size={14} /> Add bag
                  </button>
                </td>
                <td className={`strong num ${over ? 'loss' : ''}`}>{fmtNum(totalQty)} PCS</td>
                <td className="strong num">{totalKg.toFixed(3)} KG</td>
                <td />
              </tr>
            </tfoot>
          </table>
          {over && <div className="callout err">Total {fmtNum(totalQty)} PCS is more than the {fmtNum(avail)} PCS available for this job.</div>}
          {!over && totalQty > 0 && <div className="hint muted" style={{ marginTop: 10, fontSize: 12.5 }}>Weight left blank is calculated from {unitKg} kg per piece.</div>}
        </>
      )}
    </Modal>
  );
}

function ShipModal({ d, onClose }: { d: Dispatch; onClose: () => void }) {
  const { run } = useStore();
  const [vehicle, setVehicle] = useState(d.vehicleNo);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Dispatch ${d.dispatchNo}`}
      subtitle={`${d.qty} PCS · ${d.bags.length} bags · ${fmtKg(d.weight)} → ${d.customer}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-success"
            disabled={!vehicle.trim()}
            onClick={() => {
              if (run((s, ts) => markDispatched(s, d.dispatchNo, vehicle, ts), { title: 'Goods dispatched', message: `${d.dispatchNo}: ${d.qty} PCS left on ${vehicle.toUpperCase()}.` })) onClose();
            }}
          >
            <Truck size={15} /> Confirm Dispatch
          </button>
        </>
      }
    >
      <Field label="Vehicle Number" required>
        <input className="input mono" autoFocus placeholder="GJ05AB1234" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} />
      </Field>
    </Modal>
  );
}

function PackingList({ d, onClose }: { d: Dispatch; onClose: () => void }) {
  const { state } = useStore();
  const p = getProduct(state, d.productId);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Packing List — ${d.dispatchNo}`}
      subtitle={`${d.customer} · ${fmtDate(d.date)}`}
      footer={
        <button className="btn" onClick={() => window.print()}>
          <Printer size={15} /> Print
        </button>
      }
    >
      <div className="info-strip">
        <div>
          <div className="l">Job No.</div>
          <div className="v mono">{d.jobNo}</div>
        </div>
        <div>
          <div className="l">Product</div>
          <div className="v">{p.name}</div>
        </div>
        <div>
          <div className="l">Vehicle</div>
          <div className="v mono">{d.vehicleNo || '—'}</div>
        </div>
        <div>
          <div className="l">Invoice</div>
          <div className="v mono">{d.invoiceNo}</div>
        </div>
        <div>
          <div className="l">Status</div>
          <div className="v">
            <Badge status={d.status} />
          </div>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Bag No.</th>
            <th>Product</th>
            <th>Job No.</th>
            <th className="r">Quantity</th>
            <th className="r">Weight</th>
          </tr>
        </thead>
        <tbody>
          {d.bags.map((b) => (
            <tr key={b.no}>
              <td className="mono">
                {d.dispatchNo}/B{String(b.no).padStart(2, '0')}
              </td>
              <td>{p.name}</td>
              <td className="mono">{d.jobNo}</td>
              <td className="r qty-cell">{b.qty} PCS</td>
              <td className="r num">{b.weight.toFixed(3)} KG</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} className="strong">
              Total ({d.bags.length} bags)
            </td>
            <td className="r qty-cell">{d.qty} PCS</td>
            <td className="r strong num">{d.weight.toFixed(3)} KG</td>
          </tr>
        </tbody>
      </table>
    </Modal>
  );
}
