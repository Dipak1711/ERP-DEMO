import * as api from '../db/api';
import { useState } from 'react';
import { Clock, Hash, Pencil, Plus, Ruler, Scale, Trash2, type LucideIcon } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { dbMessage } from '../db/client';
import { Confirm, Field, Modal, PageHeader } from '../components/ui';
import { KINDS, REFERENCE_UNITS, useUnits, type Unit, type UnitKind } from '../units/useUnits';

const KIND_ICON: Record<UnitKind, LucideIcon> = { quantity: Hash, weight: Scale, length: Ruler, time: Clock };
const trim = (n: number) => String(Math.round(n * 1e6) / 1e6);

/** Settings → Units: every measuring unit used in the software, in one place. Director / Plant Head only. */
export function UnitsPage() {
  const { all, reload } = useUnits();
  const { toast } = useStore();
  const [editing, setEditing] = useState<{ unit?: Unit; kind: UnitKind } | null>(null);
  const [deleting, setDeleting] = useState<Unit | null>(null);

  const fail = (e: unknown) => toast({ kind: 'error', title: 'Action not allowed', message: dbMessage(e) });

  const toggle = async (u: Unit) => {
    try {
      await api.saveUnit(u.code, u.name, u.kind, u.factor, !u.active);
      await reload();
    } catch (e) {
      fail(e);
    }
  };
  const remove = async (u: Unit) => {
    try {
      await api.deleteUnit(u.code);
      toast({ kind: 'success', title: 'Unit deleted', message: u.code });
      await reload();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Settings" title="Units" />
      <div className="units-grid">
        {KINDS.map((k) => {
          const Icon = KIND_ICON[k.kind];
          const list = all.filter((u) => u.kind === k.kind);
          return (
            <section className="card unit-card" key={k.kind}>
              <header className="unit-card-head">
                <span className="unit-card-ic">
                  <Icon size={18} />
                </span>
                <div>
                  <h3>{k.label}</h3>
                  <div className="sub">Measured in {k.ref}</div>
                </div>
                <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing({ kind: k.kind })}>
                  <Plus size={14} /> Add
                </button>
              </header>
              <ul className="unit-list">
                {list.map((u) => {
                  const ref = REFERENCE_UNITS.includes(u.code);
                  return (
                    <li key={u.code} className={`unit-row ${u.active ? '' : 'off'}`}>
                      <span className="mono strong unit-code">{u.code}</span>
                      <span className="unit-name">{u.name}</span>
                      <span className="unit-eq">{ref ? 'Base unit' : `= ${trim(u.factor)} ${k.ref}`}</span>
                      <button role="switch" aria-checked={u.active} aria-label={`${u.code} in use`} title={u.active ? 'Shown in forms — click to hide' : 'Hidden from forms — click to show'} className={`tg ${u.active ? 'on' : ''}`} disabled={ref} onClick={() => toggle(u)} />
                      <span className="icon-actions">
                        <button className="icon-btn" title="Edit" aria-label={`Edit ${u.code}`} onClick={() => setEditing({ unit: u, kind: u.kind })}>
                          <Pencil size={16} />
                        </button>
                        {ref ? (
                          <span className="icon-btn ghost" aria-hidden="true" />
                        ) : (
                          <button className="icon-btn danger" title="Delete" aria-label={`Delete ${u.code}`} onClick={() => setDeleting(u)}>
                            <Trash2 size={16} />
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <Confirm open={!!deleting} title="Delete unit" message={deleting ? `Delete ${deleting.code}? Records already saved are not changed.` : ''} confirmLabel="Delete" tone="danger" onConfirm={() => deleting && void remove(deleting)} onClose={() => setDeleting(null)} />
      {editing && (
        <UnitModal
          unit={editing.unit}
          kind={editing.kind}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

function UnitModal({ unit, kind: kind0, onClose, onSaved }: { unit?: Unit; kind: UnitKind; onClose: () => void; onSaved: () => void }) {
  const { toast } = useStore();
  const kind: UnitKind = kind0; // fixed by the card it was opened from
  const [code, setCode] = useState(unit?.code ?? '');
  const [name, setName] = useState(unit?.name ?? '');
  const [factor, setFactor] = useState(unit ? trim(unit.factor) : '');
  const [active, setActive] = useState(unit?.active ?? true);
  const [busy, setBusy] = useState(false);
  const ref = !!unit && REFERENCE_UNITS.includes(unit.code);
  const refCode = KINDS.find((k) => k.kind === kind)!.ref;
  const valid = code.trim() !== '' && name.trim() !== '' && (ref || Number(factor) > 0);

  const submit = async () => {
    setBusy(true);
    try {
      await api.saveUnit(code, name, kind, ref ? 1 : Number(factor), ref ? true : active);
      toast({ kind: 'success', title: unit ? 'Unit updated' : 'Unit added', message: code.trim() });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Action not allowed', message: dbMessage(e) });
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={Ruler}
      title={unit ? `Edit ${unit.code}` : 'Add Unit'}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
            {unit ? 'Save Changes' : 'Add Unit'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Measures">
          <select value={kind} disabled>
            {KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Code" required hint={unit ? undefined : 'Short, e.g. BOX'}>
          <input className="input mono" value={code} disabled={!!unit} onChange={(e) => setCode(e.target.value)} maxLength={12} autoFocus={!unit} />
        </Field>
        <Field label="Name" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Box" autoFocus={!!unit} />
        </Field>
        {!ref && (
          <Field label="One holds" required hint={Number(factor) > 0 && code.trim() ? `1 ${code.trim()} = ${trim(Number(factor))} ${refCode}` : `How many ${refCode} make one`}>
            <input className="input num" type="number" min="0" step="any" value={factor} onChange={(e) => setFactor(e.target.value)} />
          </Field>
        )}
        {!ref && (
          <Field label="In forms">
            <select value={active ? 'on' : 'off'} onChange={(e) => setActive(e.target.value === 'on')}>
              <option value="on">Shown</option>
              <option value="off">Hidden</option>
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
