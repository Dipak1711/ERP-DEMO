import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Eye, FileText, Info, PackageOpen, Plus, Printer, Truck } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { createDispatch, fgAvailable, getJob, getProduct, isToday, markDispatched, planBags, round3 } from '../store/engine';
import type { Dispatch } from '../store/types';
import { CUSTOMERS } from '../store/seed';
import { Badge, Empty, Field, JobLink, Kpi, Modal, NumInput, PageHeader, Search, Tabs } from '../components/ui';
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
        subtitle="Final stage. Dispatch finished goods by job, with vehicle number and bag-level quantity / weight for full delivery traceability. Finished Goods stock reduces on dispatch."
        flow="dispatched"
        actions={
          <button className="btn btn-primary" onClick={() => newDispatch()}>
            <Plus size={16} /> New Dispatch
          </button>
        }
      />
      <div className="kpis">
        <Kpi label="Today's Dispatch" value={today.reduce((t, d) => t + d.qty, 0)} unit="PCS" hint={`${today.length} dispatch${today.length === 1 ? '' : 'es'} · ${new Set(today.map((d) => d.vehicleNo)).size} vehicles`} icon={CalendarCheck} tone="teal" onClick={() => setFilter('today')} />
        <Kpi label="Ready for Dispatch" value={ready.reduce((t, d) => t + d.qty, 0)} unit="PCS" hint={`${ready.length} packed, awaiting vehicle`} icon={PackageOpen} tone="violet" onClick={() => setFilter('Ready for Dispatch')} />
        <Kpi label="Total Dispatched" value={shipped.reduce((t, d) => t + d.qty, 0)} unit="PCS" hint={fmtKg(round3(shipped.reduce((t, d) => t + d.weight, 0)))} icon={Truck} tone="blue" onClick={() => setFilter('Dispatched')} />
        <Kpi label="FG Available to Dispatch" value={fgAvail} unit="PCS" hint="From Finished Goods" icon={Info} tone="green" />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Dispatch Register</h3>
            <div className="sub">Every dispatch is linked to its job number and finished-goods lot</div>
          </div>
        </div>
        <div className="toolbar">
          <Tabs
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: 'All', count: ds.length },
              { value: 'Ready for Dispatch', label: 'Ready', count: ready.length },
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

export function NewDispatchModal({ fgId: initial, onClose }: { fgId: string; onClose: () => void }) {
  const { state, run } = useStore();
  const lots = state.finishedGoods.filter((f) => fgAvailable(f) > 0);
  const [fgId, setFgId] = useState(lots.find((f) => f.id === initial)?.id ?? lots[0]?.id ?? '');
  const fg = lots.find((f) => f.id === fgId);
  const product = fg ? getProduct(state, fg.productId) : null;
  const avail = fg ? fgAvailable(fg) : 0;
  const [customer, setCustomer] = useState(fg ? getJob(state, fg.jobNo).customer : CUSTOMERS[0]);
  const [qty, setQty] = useState(String(avail));
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [date, setDate] = useState(todayISO());
  const [bagCount, setBagCount] = useState(String(Math.max(1, Math.ceil(avail / 10))));
  const [weightOverride, setWeightOverride] = useState<string | null>(null);
  const [mode, setMode] = useState<'Dispatched' | 'Ready for Dispatch'>('Dispatched');

  const qN = Number(qty);
  const bN = Number(bagCount);
  const autoWeight = product ? round3(qN * product.finishedWeight) : 0;
  const weight = weightOverride ?? String(autoWeight);
  const bags = useMemo(() => (qN > 0 && bN > 0 && bN <= qN ? planBags(qN, bN, Number(weight)) : []), [qN, bN, weight]);
  const nextNo = `DSP-${new Date().getFullYear()}-${String(state.counters.dispatch + 1).padStart(4, '0')}`;

  const errQty = !(qN > 0) || !Number.isInteger(qN) ? 'Enter a whole quantity' : qN > avail ? `Only ${avail} PCS available in FG` : null;
  const errBags = !(bN > 0) || !Number.isInteger(bN) ? 'Enter bag count' : bN > qN ? 'More bags than pieces' : null;
  const errVeh = mode === 'Dispatched' && !vehicle.trim() ? 'Vehicle number is required' : null;
  const invalid = !fg || !!errQty || !!errBags || !!errVeh || !(Number(weight) > 0);

  const pickLot = (id: string) => {
    const f = lots.find((x) => x.id === id)!;
    setFgId(id);
    setCustomer(getJob(state, f.jobNo).customer);
    setQty(String(fgAvailable(f)));
    setBagCount(String(Math.max(1, Math.ceil(fgAvailable(f) / 10))));
    setWeightOverride(null);
  };

  const submit = () => {
    const ok = run(
      (d, now) =>
        createDispatch(d, { fgId, customer, qty: qN, vehicleNo: vehicle, driver, date, bagCount: bN, weight: Number(weight), status: mode }, tsFor(date, now)),
      {
        title: mode === 'Dispatched' ? 'Goods dispatched' : 'Packed — ready for dispatch',
        message:
          mode === 'Dispatched'
            ? `${nextNo}: ${qN} PCS on ${vehicle.toUpperCase()}. Finished Goods reduced by ${qN} PCS.`
            : `${nextNo}: ${qN} PCS packed in ${bN} bags and reserved in Finished Goods.`,
      },
    );
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={Truck}
      title="New Dispatch"
      subtitle="Dispatch quantity cannot exceed the available finished goods of the selected job."
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-success" disabled={invalid} onClick={submit}>
            <Truck size={15} /> {mode === 'Dispatched' ? 'Confirm Dispatch' : 'Save as Ready for Dispatch'}
          </button>
        </>
      }
    >
      {lots.length === 0 ? (
        <Empty icon={PackageOpen} title="No finished goods available" text="Complete QC on a job to add stock to Finished Goods." />
      ) : (
        <>
          <div className="form-grid three">
            <Field label="Dispatch Number" hint="Auto-generated">
              <input className="input mono" readOnly value={nextNo} />
            </Field>
            <Field label="Job / FG Lot" required full={false}>
              <select value={fgId} onChange={(e) => pickLot(e.target.value)}>
                {lots.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.jobNo} · {getProduct(state, f.productId).name} ({fgAvailable(f)} PCS)
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
            <Field label="Product">
              <input className="input" readOnly value={product?.name ?? ''} />
            </Field>
            <Field label="Available FG Quantity">
              <NumInput value={avail} readOnly />
            </Field>
            <Field label="Dispatch Quantity" required error={errQty}>
              <NumInput value={qty} onChange={(v) => { setQty(v); setWeightOverride(null); }} bad={!!errQty} autoFocus />
            </Field>
            <Field label="Vehicle Number" required={mode === 'Dispatched'} error={errVeh}>
              <input className={`input mono ${errVeh ? 'bad' : ''}`} placeholder="GJ05AB1234" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} />
            </Field>
            <Field label="Driver">
              <input className="input" placeholder="Driver name" value={driver} onChange={(e) => setDriver(e.target.value)} />
            </Field>
            <Field label="Dispatch Date">
              <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Packing / Bags" required error={errBags}>
              <NumInput value={bagCount} onChange={setBagCount} suffix="bags" bad={!!errBags} />
            </Field>
            <Field label="Pieces per Bag" hint="Auto-calculated">
              <NumInput value={bags[0]?.qty ?? ''} readOnly suffix="PCS" />
            </Field>
            <Field label="Total Weight" hint={product ? `${product.finishedWeight} kg/pc × qty` : ''}>
              <NumInput value={weight} onChange={setWeightOverride} suffix="KG" step="any" />
            </Field>
          </div>

          <div className="section-label">Status</div>
          <div className="seg">
            <button className={mode === 'Dispatched' ? 'on' : ''} onClick={() => setMode('Dispatched')}>
              Dispatch now
            </button>
            <button className={mode === 'Ready for Dispatch' ? 'on' : ''} onClick={() => setMode('Ready for Dispatch')}>
              Pack only (Ready for Dispatch)
            </button>
          </div>

          {bags.length > 0 && (
            <>
              <div className="section-label">Bag-level packing</div>
              <div className="bags">
                {bags.map((b) => (
                  <div className="bag" key={b.no}>
                    <span className="muted">Bag {b.no}</span>
                    <b>{b.qty} PCS</b>
                    {b.weight.toFixed(3)} kg
                  </div>
                ))}
              </div>
            </>
          )}
          {fg && !errQty && (
            <div className="callout info">
              <Info size={16} />
              <div>
                Finished Goods for <span className="mono">{fg.jobNo}</span>: {avail} available → <b>{avail - qN} after this dispatch</b>
                {mode === 'Ready for Dispatch' ? ' (reserved until the vehicle leaves)' : ''}.
              </div>
            </div>
          )}
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
