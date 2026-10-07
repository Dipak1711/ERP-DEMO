import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, Boxes, Layers, PackagePlus, Scale, Send } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { addInward, fifoLots, lotAvailableWeight, lotStatus, materialKey } from '../store/engine';
import { SUPPLIERS } from '../store/seed';
import { findMaterial, MATERIAL_FAMILIES, MATERIAL_MASTER, pieceWeightKg, STANDARD_OD_MM } from '../store/materials';
import { Badge, Empty, Field, JobLink, Kpi, Modal, NumInput, PageHeader, Search, Tabs } from '../components/ui';
import { fmtDate, fmtDateTime, fmtKg, fmtNum, matches, todayISO } from '../components/format';

type View = 'stock' | 'inward' | 'issues';

export function RawInventoryPage() {
  const { state, openAction } = useStore();
  const [view, setView] = useState<View>('stock');
  const [q, setQ] = useState('');
  const [matF, setMatF] = useState('');
  const lots = state.rawMaterials;

  const totalQty = lots.reduce((t, l) => t + l.availableQty, 0);
  const totalKg = lots.reduce((t, l) => t + lotAvailableWeight(l), 0);
  const issues = state.movements.filter((m) => m.from === 'Raw Inventory');
  const issuedQty = issues.reduce((t, m) => t + m.qty, 0);
  const low = lots.filter((l) => lotStatus(l) === 'Low Stock');

  // Summary per material + OD, and which lot is next in FIFO order
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; material: string; od: number; type: string; avail: number; inward: number; kg: number; next?: string }>();
    for (const l of lots) {
      const key = materialKey(l.material, l.od);
      const g = m.get(key) ?? { key, material: l.material, od: l.od, type: l.materialType, avail: 0, inward: 0, kg: 0 };
      g.avail += l.availableQty;
      g.inward += l.inwardQty;
      g.kg += lotAvailableWeight(l);
      m.set(key, g);
    }
    for (const g of m.values()) g.next = fifoLots(state, g.key)[0]?.id;
    return [...m.values()];
  }, [lots, state]);
  const nextLots = new Set(groups.map((g) => g.next));

  const stockRows = lots
    .filter((l) => !matF || materialKey(l.material, l.od) === matF)
    .filter((l) => matches(q, l.id, l.material, l.materialType, l.supplier, l.heatNo, `${l.od}`))
    .slice()
    .sort((a, b) => a.material.localeCompare(b.material) || a.od - b.od || a.inwardDate.localeCompare(b.inwardDate));

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Step 1 of 8"
        title="Raw Inventory"
        subtitle="Round-bar raw material tracked lot-wise by material, OD / size, quantity and weight, with supplier and inward details. Material is issued to Cutting on a FIFO basis and stock reduces automatically."
        flow="raw"
        actions={
          <button className="btn btn-primary" onClick={() => openAction({ kind: 'inward' })}>
            <PackagePlus size={16} /> Add Raw Material Inward
          </button>
        }
      />
      <div className="kpis">
        <Kpi label="Raw Material Stock" value={totalQty} unit="PCS" hint={`${lots.filter((l) => l.availableQty > 0).length} lots in stock`} icon={Boxes} tone="blue" />
        <Kpi label="Stock Weight" value={fmtNum(Math.round(totalKg * 10) / 10)} unit="KG" hint="Available weight" icon={Scale} tone="teal" />
        <Kpi label="Material / Size Variants" value={groups.length} unit="SKUs" hint="Material × OD" icon={Layers} tone="violet" />
        <Kpi label="Issued to Production" value={issuedQty} unit="PCS" hint={`${issues.length} FIFO issues`} icon={Send} tone="amber" onClick={() => setView('issues')} />
        <Kpi label="Low Stock Lots" value={low.length} unit="lots" hint="Below 20% of inward" icon={AlertTriangle} tone="red" />
      </div>

      <div className="card mb">
        <div className="card-head">
          <div>
            <h3>Stock by Material &amp; OD</h3>
            <div className="sub">Click a material to filter the lot table</div>
          </div>
        </div>
        <div className="card-body">
          {groups.length === 0 && (
            <Empty
              icon={Boxes}
              title="No raw material in stock"
              text="Record your first inward — material, OD / size, supplier, quantity and weight. Stock appears here by material and OD."
              action={
                <button className="btn btn-primary" onClick={() => openAction({ kind: 'inward' })}>
                  <PackagePlus size={15} /> Add Raw Material Inward
                </button>
              }
            />
          )}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
            {groups.map((g) => (
              <button
                key={g.key}
                className="kpi"
                style={{ boxShadow: 'none', outline: matF === g.key ? '2px solid var(--primary)' : undefined }}
                onClick={() => {
                  setMatF(matF === g.key ? '' : g.key);
                  setView('stock');
                }}
              >
                <div className="kpi-top">
                  <span className="kpi-label">{g.material}</span>
                  <span className="chip">OD {g.od} mm</span>
                </div>
                <div className="kpi-value">
                  {fmtNum(g.avail)}
                  <small>PCS</small>
                </div>
                <div className="kpi-hint">
                  {fmtKg(Math.round(g.kg * 1000) / 1000)} · {g.type}
                </div>
                <div style={{ height: 6, background: 'var(--neutral-bg)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
                  <div style={{ width: `${g.inward ? (g.avail / g.inward) * 100 : 0}%`, height: '100%', background: '#2a78d6', borderRadius: 3 }} />
                </div>
                <div className="kpi-hint">
                  {fmtNum(g.avail)} of {fmtNum(g.inward)} PCS received remain{g.next ? ` · next FIFO lot ${g.next}` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <Tabs
            value={view}
            onChange={setView}
            items={[
              { value: 'stock', label: 'Raw Material Stock', count: lots.length },
              { value: 'inward', label: 'Inward Register', count: state.rawInwards.length },
              { value: 'issues', label: 'Issues to Production', count: issues.length },
            ]}
          />
          <Search value={q} onChange={setQ} placeholder="Search material, supplier, lot, heat no…" />
          {view === 'stock' && (
            <select className="filter" value={matF} onChange={(e) => setMatF(e.target.value)}>
              <option value="">All materials</option>
              {groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.material} — OD {g.od}
                </option>
              ))}
            </select>
          )}
        </div>

        {view === 'stock' &&
          (stockRows.length === 0 ? (
            <Empty icon={Boxes} title="No raw material found" text="Add a raw material inward to create stock." />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Lot No.</th>
                    <th>Material</th>
                    <th>Material Type</th>
                    <th>OD / Size</th>
                    <th>Supplier</th>
                    <th>Inward Date</th>
                    <th className="r">Inward Qty</th>
                    <th className="r">Available Qty</th>
                    <th className="r">Available Weight</th>
                    <th>Unit</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stockRows.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <div className="mono strong">{l.id}</div>
                        <div className="sub">Heat {l.heatNo}</div>
                      </td>
                      <td className="strong">
                        {l.material}
                        {nextLots.has(l.id) && (
                          <div>
                            <span className="chip chip-high" style={{ marginTop: 4 }}>
                              FIFO · next to issue
                            </span>
                          </div>
                        )}
                      </td>
                      <td>{l.materialType}</td>
                      <td className="nowrap">OD {l.od} mm</td>
                      <td>{l.supplier}</td>
                      <td className="nowrap">{fmtDate(l.inwardDate)}</td>
                      <td className="r num">
                        {fmtNum(l.inwardQty)}
                        <div className="sub">{fmtKg(l.inwardWeight)}</div>
                      </td>
                      <td className="r">
                        <span className="qty-cell" style={{ fontSize: 15 }}>
                          {fmtNum(l.availableQty)}
                        </span>
                        {l.availableQty < l.inwardQty && <div className="sub loss">−{fmtNum(l.inwardQty - l.availableQty)} issued</div>}
                      </td>
                      <td className="r num nowrap">{fmtKg(lotAvailableWeight(l))}</td>
                      <td>{l.unit}</td>
                      <td>
                        <Badge status={lotStatus(l)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {view === 'inward' && (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Inward Date</th>
                  <th>Lot No.</th>
                  <th>Material</th>
                  <th>OD / Size</th>
                  <th>Supplier</th>
                  <th>Invoice</th>
                  <th className="r">Quantity</th>
                  <th className="r">Weight</th>
                </tr>
              </thead>
              <tbody>
                {state.rawInwards
                  .filter((i) => matches(q, i.lotId, i.material, i.supplier, i.invoiceNo))
                  .map((i) => (
                    <tr key={i.id}>
                      <td className="nowrap">{fmtDate(i.date)}</td>
                      <td className="mono strong">{i.lotId}</td>
                      <td>
                        <div className="strong">{i.material}</div>
                        <div className="sub">{i.materialType}</div>
                      </td>
                      <td>OD {i.od} mm</td>
                      <td>{i.supplier}</td>
                      <td className="mono">{i.invoiceNo}</td>
                      <td className="r qty-cell">
                        <span className="gain">+{fmtNum(i.qty)}</span>
                      </td>
                      <td className="r num">{fmtKg(i.weight)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {view === 'issues' &&
          (issues.length === 0 ? (
            <Empty icon={Send} title="No material issued yet" text="Material is issued when a Cutting job starts." />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date / Time</th>
                    <th>Job No.</th>
                    <th>Issued To</th>
                    <th>Lot / Note</th>
                    <th className="r">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {issues
                    .filter((m) => matches(q, m.jobNo, m.note))
                    .map((m) => (
                      <tr key={m.id}>
                        <td className="nowrap">{fmtDateTime(m.ts)}</td>
                        <td>
                          <JobLink jobNo={m.jobNo} />
                        </td>
                        <td>{m.to}</td>
                        <td className="muted">{m.note}</td>
                        <td className="r qty-cell">
                          <span className="loss">−{fmtNum(m.qty)}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>
    </>
  );
}

export function InwardModal({ preset, onClose }: { preset?: { material?: string; od?: number }; onClose: () => void }) {
  const { run } = useStore();
  const first = findMaterial(preset?.material ?? '') ?? MATERIAL_MASTER[0];
  const [material, setMaterial] = useState(first.material);
  const [od, setOd] = useState(String(preset?.od ?? first.defaultOd));
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(todayISO());
  const [invoice, setInvoice] = useState('');
  const [heatNo, setHeatNo] = useState('');
  const [qty, setQty] = useState('');
  const [pieceLength, setPieceLength] = useState('');
  const [weightOverride, setWeightOverride] = useState<string | null>(null);

  const spec = findMaterial(material) ?? first;
  const qN = Number(qty);
  const odN = Number(od);
  const lenN = Number(pieceLength);
  const perPiece = odN > 0 && lenN > 0 ? pieceWeightKg(odN, lenN, spec.density) : 0;
  const theoretical = perPiece && qN > 0 ? Math.round(perPiece * qN * 1000) / 1000 : 0;
  const weight = weightOverride ?? (theoretical ? String(theoretical) : '');
  const wN = Number(weight);

  const errQty = qty !== '' && (!(qN > 0) || !Number.isInteger(qN)) ? 'Enter a whole number of pieces' : null;
  const valid = !!supplier && odN > 0 && qN > 0 && Number.isInteger(qN) && wN > 0;

  const pickMaterial = (m: string) => {
    setMaterial(m);
    const next = findMaterial(m);
    if (next) setOd(String(next.defaultOd));
    setWeightOverride(null);
  };

  const submit = () => {
    if (
      run(
        (d, ts) =>
          addInward(d, { material, materialType: spec.grade, od: odN, supplier, inwardDate: date, qty: qN, weight: wN, heatNo, invoiceNo: invoice }, ts),
        {
          title: 'Raw material received',
          message: `${qN} PCS (${wN} KG) of ${material} OD ${od} mm added to stock.`,
        },
      )
    )
      onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={PackagePlus}
      title="Add Raw Material Inward"
      subtitle="Creates a new stock lot. Lots are consumed oldest-first (FIFO) when Cutting starts."
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid} onClick={submit}>
            <ArrowDownToLine size={15} /> Save Inward
          </button>
        </>
      }
    >
      <div className="section-label">Material</div>
      <div className="form-grid three">
        <Field label="Material" required>
          <select value={material} onChange={(e) => pickMaterial(e.target.value)}>
            {MATERIAL_FAMILIES.map((fam) => (
              <optgroup key={fam} label={fam}>
                {MATERIAL_MASTER.filter((m) => m.family === fam).map((m) => (
                  <option key={m.material} value={m.material}>
                    {m.material}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Grade / Specification" hint={`Density ${spec.density} g/cm³`}>
          <input className="input" readOnly value={spec.grade} />
        </Field>
        <Field label="OD / Size" required hint="Standard bar diameters">
          <select
            value={od}
            onChange={(e) => {
              setOd(e.target.value);
              setWeightOverride(null);
            }}
          >
            {STANDARD_OD_MM.map((d) => (
              <option key={d} value={String(d)}>
                {d} mm
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="section-label">Receipt</div>
      <div className="form-grid">
        <Field label="Supplier" required>
          <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">Select supplier…</option>
            {SUPPLIERS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Inward Date" required>
          <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Supplier Invoice No.">
          <input className="input mono" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="e.g. INV/2026/0412" />
        </Field>
        <Field label="Heat No. / Mill Cert">
          <input className="input mono" value={heatNo} onChange={(e) => setHeatNo(e.target.value)} placeholder="As per mill test certificate" />
        </Field>
      </div>

      <div className="section-label">Quantity &amp; weight</div>
      <div className="form-grid three">
        <Field label="Quantity" required error={errQty}>
          <NumInput value={qty} onChange={(v) => { setQty(v); setWeightOverride(null); }} bad={!!errQty} autoFocus />
        </Field>
        <Field label="Piece Length" hint="Length of each bar / billet — used to calculate weight">
          <NumInput value={pieceLength} onChange={(v) => { setPieceLength(v); setWeightOverride(null); }} suffix="mm" step="any" />
        </Field>
        <Field
          label="Total Weight"
          required
          hint={
            theoretical
              ? weightOverride != null && Number(weightOverride) !== theoretical
                ? `Theoretical ${theoretical} KG — using entered weight`
                : `Auto: ${perPiece.toFixed(3)} kg/pc × ${qN} PCS`
              : 'Enter piece length to auto-calculate, or type the weighed weight'
          }
        >
          <NumInput value={weight} onChange={setWeightOverride} suffix="KG" step="any" />
        </Field>
      </div>

      {valid && (
        <div className="callout info">
          <Layers size={16} />
          <div>
            Adds a new lot of <b>{qN} PCS</b> ({wN} KG, {(wN / qN).toFixed(3)} kg/pc) of <b>{material} · OD {od} mm</b> from {supplier}. It is issued after
            any older lots of the same material and size (FIFO).
          </div>
        </div>
      )}
    </Modal>
  );
}
