import { useEffect, type ComponentType, type ReactNode } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Boxes,
  Crop,
  Flame,
  Hammer,
  Inbox,
  PackageCheck,
  Scissors,
  Search as SearchIcon,
  ShieldCheck,
  Truck,
  X,
  type LucideProps,
} from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { fmtNum } from './format';
import { useCountUp } from './motion';

export type Icon = ComponentType<LucideProps>;

/** Icons for each step of the Raw → Dispatch flow */
export const FLOW_STEPS: { key: string; label: string; short: string; icon: Icon; route: string }[] = [
  { key: 'raw', label: 'Raw Inventory', short: 'Raw Material', icon: Boxes, route: 'raw-inventory' },
  { key: 'cutting', label: 'Cutting', short: 'Cutting', icon: Scissors, route: 'cutting' },
  { key: 'forging', label: 'Forging', short: 'Forging', icon: Hammer, route: 'forging' },
  { key: 'trimming', label: 'Trimming', short: 'Trimming', icon: Crop, route: 'trimming' },
  { key: 'heatTreatment', label: 'Heat Treatment', short: 'Heat Treat.', icon: Flame, route: 'heat-treatment' },
  { key: 'qc', label: 'QC', short: 'QC', icon: ShieldCheck, route: 'qc' },
  { key: 'finishedGoods', label: 'Finished Goods', short: 'Finished Goods', icon: PackageCheck, route: 'finished-goods' },
  { key: 'dispatched', label: 'Dispatch', short: 'Dispatch', icon: Truck, route: 'dispatch' },
];

// ---------------------------------------------------------------- Badge ---
const TONE: Record<string, string> = {
  Pending: 'b-red',
  'In Progress': 'b-blue b-progress',
  Completed: 'b-green',
  'QC Pending': 'b-amber',
  Approved: 'b-green',
  Rejected: 'b-red',
  'Partially Approved': 'b-orange',
  'Ready for Dispatch': 'b-violet',
  Dispatched: 'b-teal',
  Available: 'b-green',
  'Low Stock': 'b-amber',
  Consumed: 'b-neutral',
  Reserved: 'b-violet',
  'Partially Dispatched': 'b-blue',
};
export function Badge({ status }: { status: string }) {
  return <span className={`badge ${TONE[status] ?? 'b-neutral'}`}>{status}</span>;
}

/** Colour families a filter chip or status rail can take. */
export type Tone = 'neutral' | 'blue' | 'amber' | 'green' | 'red' | 'violet' | 'teal';

/** Same meanings as Badge, expressed as a rail down the row's left edge. */
const ROW_TONE: Record<string, string> = {
  Pending: 'st-pending',
  'In Progress': 'st-info',
  Completed: 'st-good',
  'QC Pending': 'st-warn',
  Approved: 'st-good',
  Rejected: 'st-bad',
  'Partially Approved': 'st-orange',
  'Ready for Dispatch': 'st-violet',
  Dispatched: 'st-teal',
  Available: 'st-good',
  'Low Stock': 'st-warn',
  Consumed: 'st-neutral',
  Reserved: 'st-violet',
  'Partially Dispatched': 'st-info',
};
export const rowTone = (status: string) => ROW_TONE[status] ?? 'st-neutral';

export function Priority({ p }: { p: string }) {
  if (p === 'Normal') return <span className="chip">Normal</span>;
  return <span className={`chip ${p === 'Urgent' ? 'chip-hot' : 'chip-high'}`}>{p}</span>;
}

// -------------------------------------------------------------- JobLink ---
export function JobLink({ jobNo }: { jobNo: string }) {
  const { openTrace } = useStore();
  return (
    <button
      className="job-link"
      title="View complete job traceability"
      // the job number is its own action — don't let it also trigger the row it sits in
      onClick={(e) => {
        e.stopPropagation();
        openTrace(jobNo);
      }}
    >
      {jobNo}
    </button>
  );
}

// --------------------------------------------------------------- Header ---
export const go = (route: string) => {
  window.location.hash = `/${route}`;
  window.scrollTo({ top: 0 });
};

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  flow,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** FLOW_STEPS key — shows previous / next stage buttons */
  flow?: string;
}) {
  return (
    <>
      <div className="page-head">
        <div className="ph-text">
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {(flow || actions) && (
          <div className="page-actions">
            {flow && <StepNav current={flow} />}
            {actions}
          </div>
        )}
      </div>
    </>
  );
}

/** Previous / next stage buttons, so users can walk the flow in order. */
function StepNav({ current }: { current: string }) {
  const i = FLOW_STEPS.findIndex((st) => st.key === current);
  const prev = FLOW_STEPS[i - 1];
  const next = FLOW_STEPS[i + 1];
  return (
    <div className="step-nav">
      {prev && (
        <button className="step-link" onClick={() => go(prev.route)} title={`Go to ${prev.label}`}>
          <ChevronLeft size={16} />
          <span>
            <small>Previous stage</small>
            {prev.label}
          </span>
        </button>
      )}
      {next && (
        <button className="step-link next" onClick={() => go(next.route)} title={`Go to ${next.label}`}>
          <span>
            <small>Next stage</small>
            {next.label}
          </span>
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}

/** One compact line of key numbers, shown in a card header instead of a row of stat cards. */
export function SummaryLine({ items }: { items: { label: string; value: ReactNode; tone?: 'good' | 'bad' | 'info' }[] }) {
  return (
    <div className="sumline">
      {items.map((it) => (
        <span key={it.label} className={`sum ${it.tone ?? ''}`}>
          <b>{it.value}</b> {it.label}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ KPI ---
export function Kpi({
  label,
  value,
  unit,
  hint,
  icon: I,
  tone = 'blue',
  trend,
  onClick,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  icon: Icon;
  tone?: 'blue' | 'amber' | 'green' | 'red' | 'violet' | 'teal';
  /** small chip in the top-right corner */
  trend?: ReactNode;
  onClick?: () => void;
}) {
  const isNum = typeof value === 'number';
  const shown = useCountUp(isNum ? value : 0);
  const body = (
    <>
      <span className="kpi-icon">
        <I size={22} />
      </span>
      {trend && <span className="kpi-trend">{trend}</span>}
      <div className="kpi-value">
        {isNum ? fmtNum(shown) : value}
        {unit && <small>{value === 1 && unit !== 'PCS' && unit.endsWith('s') ? unit.slice(0, -1) : unit}</small>}
      </div>
      <div className="kpi-label">{label}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </>
  );
  return onClick ? (
    <button className={`kpi tone-${tone}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={`kpi tone-${tone}`}>{body}</div>
  );
}

// -------------------------------------------------------- Quantity flow ---
export function QtyFlow({
  input,
  loss,
  output,
  labels = ['Received Qty', 'Rejection Qty', 'OK Qty'],
  small,
}: {
  input: number | string;
  loss: number | string;
  output: number | string;
  labels?: [string, string, string];
  small?: boolean;
}) {
  return (
    <div className={`qflow ${small ? 'sm' : ''}`}>
      <div className="qbox in">
        <div className="l">{labels[0]}</div>
        <div className="v">
          {input}
          <small>PCS</small>
        </div>
      </div>
      <div className="qarrow">−</div>
      <div className="qbox loss">
        <div className="l">{labels[1]}</div>
        <div className="v">
          {loss}
          <small>PCS</small>
        </div>
      </div>
      <div className="qarrow">=</div>
      <div className="qbox out">
        <div className="l">{labels[2]}</div>
        <div className="v">
          {output}
          <small>PCS</small>
        </div>
      </div>
    </div>
  );
}

/** Compact "100 → −2 → 98" for table cells */
export function InlineQty({ input, loss, output }: { input: number; loss: number; output: number }) {
  return (
    <span className="inline-q">
      {fmtNum(input)}
      <ArrowRight size={12} />
      <span className="x">−{loss}</span>
      <ArrowRight size={12} />
      <span className="o">{fmtNum(output)}</span>
    </span>
  );
}

// -------------------------------------------------------------- Stepper ---
/** 8-segment progress bar along Raw → Dispatch */
export function Stepper({ index }: { index: number }) {
  return (
    <span className="stepper" title={index >= 0 ? `Stage ${index + 1} of 8: ${FLOW_STEPS[index]?.label}` : 'Rejected'}>
      {FLOW_STEPS.map((s, i) => (
        <i key={s.key} className={index === 7 && i === 7 ? 'end' : i < index ? 'done' : i === index ? 'cur' : ''} />
      ))}
    </span>
  );
}

// --------------------------------------------------------------- Empty ---
export function Empty({ title, text, icon: I = Inbox, action }: { title: string; text?: string; icon?: Icon; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <I size={24} />
      </div>
      <h4>{title}</h4>
      {text && <p>{text}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

// ------------------------------------------------------- Search / Tabs ---
export function Search({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <SearchIcon size={15} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; count?: number; tone?: Tone }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          className={`tab tone-${it.tone ?? 'neutral'} ${value === it.value ? 'active' : ''}`}
          onClick={() => onChange(it.value)}
        >
          {it.label}
          {it.count !== undefined && <span className="cnt">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Modal ---
export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  size,
  icon: MI,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'lg';
  icon?: Icon;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          {MI && (
            <span className="mh-icon">
              <MI size={20} />
            </span>
          )}
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'primary',
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger' | 'success';
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${tone === 'success' ? 'btn-success' : tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ lineHeight: 1.55, color: 'var(--text-2)' }}>{message}</div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Field ---
export function Field({
  label,
  required,
  hint,
  error,
  full,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <label>
        {label} {required && <span className="req">*</span>}
      </label>
      {children}
      {error ? <div className="err">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function NumInput({
  value,
  onChange,
  suffix = 'PCS',
  readOnly,
  bad,
  min = 0,
  step = 1,
  autoFocus,
}: {
  value: string | number;
  onChange?: (v: string) => void;
  suffix?: string;
  readOnly?: boolean;
  bad?: boolean;
  min?: number;
  step?: number | 'any';
  autoFocus?: boolean;
}) {
  return (
    <div className="input-suffix">
      <input
        className={`input num ${bad ? 'bad' : ''}`}
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={value}
        readOnly={readOnly}
        autoFocus={autoFocus}
        onChange={(e) => onChange?.(e.target.value)}
      />
      <span>{suffix}</span>
    </div>
  );
}
