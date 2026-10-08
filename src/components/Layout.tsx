import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Bell,
  ChevronDown,
  ClipboardList,
  Database,
  Factory,
  LayoutGrid,
  Moon,
  Package,
  PanelLeft,
  RotateCcw,
  ScrollText,
  Search,
  Sun,
  Waypoints,
  Workflow,
} from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { jobSummary, STAGE_LABEL } from '../store/engine';
import { Badge, Confirm, FLOW_STEPS, go, type Icon } from './ui';
import { pendingSteps } from './workflow';

export interface NavItem {
  route: string;
  label: string;
  icon: Icon;
}

const WORKFLOW_NAV: NavItem[] = FLOW_STEPS.map((s) => ({
  route: s.route,
  label: s.key === 'forging' ? 'Forging / Manufacturing' : s.label,
  icon: s.icon,
}));
const REPORT_NAV: NavItem[] = [
  { route: 'traceability', label: 'Job Traceability', icon: Waypoints },
  { route: 'ledger', label: 'Quantity Ledger', icon: ScrollText },
  { route: 'products', label: 'Product Master', icon: Package },
];
export const ALL_NAV: NavItem[] = [{ route: 'dashboard', label: 'Dashboard', icon: LayoutGrid }, ...WORKFLOW_NAV, ...REPORT_NAV];

const SECTIONS: { id: string; title: string; icon: Icon; items: NavItem[] }[] = [
  { id: 'main', title: 'Main Menu', icon: LayoutGrid, items: [ALL_NAV[0]] },
  { id: 'flow', title: 'Workflow', icon: Workflow, items: WORKFLOW_NAV },
  { id: 'reports', title: 'Reports & Masters', icon: BarChart3, items: REPORT_NAV },
];

const readLS = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLS = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode — preference just isn't remembered */
  }
};

/** Closes a popover when clicking anywhere outside `ref`. */
function useOutside(ref: React.RefObject<HTMLElement>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, open, close]);
}

export function Layout({ route, children }: { route: string; children: ReactNode }) {
  const { state, reset, loadSample } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mini, setMini] = useState(() => readLS('forgeflow.sidebar') === 'mini');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmSample, setConfirmSample] = useState(false);
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') ?? 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    writeLS('forgeflow.theme', theme);
  }, [theme]);

  // Jobs waiting at each stage (sidebar badges)
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of state.jobs) {
      const st = FLOW_STEPS.find((f) => f.key === j.currentStage);
      if (st && j.currentStage !== 'dispatched') c[st.route] = (c[st.route] ?? 0) + 1;
    }
    c['dispatch'] = state.dispatches.filter((d) => d.status === 'Ready for Dispatch').length;
    return c;
  }, [state]);

  const toggleSidebar = () => {
    if (window.innerWidth <= 960) return setMobileOpen(true);
    setMini((m) => {
      writeLS('forgeflow.sidebar', m ? 'full' : 'mini');
      return !m;
    });
  };

  return (
    <div className={`app ${mini ? 'mini' : ''}`}>
      <div className={`scrim ${mobileOpen ? 'open' : ''}`} onClick={() => setMobileOpen(false)} />
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">
            <Factory size={22} />
          </div>
          <div>
            <div className="brand-name">FORGEFLOW</div>
            <div className="brand-sub">Forging &amp; Casting</div>
          </div>
        </div>
        <nav className="nav">
          {SECTIONS.map((sec) => {
            const isClosed = !mini && closed[sec.id];
            return (
              <div className="nav-sec" key={sec.id}>
                <button
                  className={`nav-head ${isClosed ? 'closed' : ''}`}
                  onClick={() => setClosed((c) => ({ ...c, [sec.id]: !c[sec.id] }))}
                  title={sec.title}
                  aria-expanded={!isClosed}
                >
                  <span className="gi">
                    <sec.icon size={18} />
                  </span>
                  <span className="t">{sec.title}</span>
                  <ChevronDown size={16} className="chev" />
                </button>
                {!isClosed && (
                  <div className="nav-children">
                    {sec.items.map((n) => (
                      <button
                        key={n.route}
                        className={`nav-item ${route === n.route ? 'active' : ''}`}
                        title={n.label}
                        onClick={() => {
                          go(n.route);
                          setMobileOpen(false);
                        }}
                      >
                        <n.icon size={18} />
                        <span className="lbl">{n.label}</span>
                        {counts[n.route] ? <span className="nav-count">{counts[n.route]}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <div className="storage" title="Data is saved in this browser">
            <span className="dot" />
            <span className="t">Data saved in this browser</span>
          </div>
          <button className="btn btn-sm btn-side" style={{ marginBottom: 8 }} onClick={() => setConfirmSample(true)} title="Load sample data">
            <Database size={14} />
            <span className="t">Load sample data</span>
          </button>
          <button className="btn btn-sm btn-side" onClick={() => setConfirmReset(true)} title="Clear all data">
            <RotateCcw size={14} />
            <span className="t">Clear all data</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={toggleSidebar} aria-label="Toggle sidebar" title="Toggle sidebar">
            <PanelLeft size={21} />
          </button>
          <JobSearch />
          <div className="top-right">
            <ActionBell />
            <button
              className="round-btn"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle dark mode"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="user">
              <div className="avatar">PM</div>
              <div className="meta">
                <div className="name">Plant Manager</div>
                <div className="role">Production Head</div>
              </div>
              <span className="role-badge">Admin</span>
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

      <Confirm
        open={confirmSample}
        title="Load sample data?"
        message="Current entries are replaced by a ready-made example: raw material stock and six jobs at different stages — one fully dispatched like the paper route card, others waiting at Cutting, Forging, Heat Treatment, QC and Finished Goods."
        confirmLabel="Load sample data"
        onConfirm={loadSample}
        onClose={() => setConfirmSample(false)}
      />
      <Confirm
        open={confirmReset}
        title="Clear all data?"
        message="All raw material inward and stock, and every production job, stage entry, QC result, finished good and dispatch will be deleted. Products, material categories and other masters are kept."
        confirmLabel="Clear all data"
        tone="danger"
        onConfirm={reset}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  );
}

/** Bell with every job that is waiting for an operator — one click opens the right form. */
function ActionBell() {
  const { state, openAction } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const steps = useMemo(() => pendingSteps(state), [state]);

  return (
    <div className="rel" ref={ref}>
      <button className="round-btn" onClick={() => setOpen((o) => !o)} aria-label="Pending actions" title="Pending actions">
        <Bell size={18} />
        {steps.length > 0 && <span className="ping">{steps.length}</span>}
      </button>
      {open && (
        <div className="pop">
          <div className="pop-head">
            <b>Pending actions</b>
            <div>{steps.length ? `${steps.length === 1 ? '1 job is' : `${steps.length} jobs are`} waiting for the next step` : 'All jobs are up to date'}</div>
          </div>
          <div className="pop-list">
            {steps.map((n) => {
              const I = FLOW_STEPS.find((f) => f.key === n.stageKey)?.icon ?? ClipboardList;
              return (
                <button
                  key={n.jobNo}
                  className="pop-item"
                  onClick={() => {
                    setOpen(false);
                    if (n.action) openAction(n.action);
                    else if (n.route) go(n.route);
                  }}
                >
                  <span className="ic">
                    <I size={17} />
                  </span>
                  <span>
                    <span className="tt">
                      <span className="mono">{n.jobNo}</span> · {n.label}
                    </span>
                    <div className="ss">{n.detail}</div>
                  </span>
                  <span className="go">Open →</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function JobSearch() {
  const { state, openTrace } = useStore();
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [hl, setHl] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return state.jobs.slice(-6).reverse();
    return state.jobs
      .filter((j) => {
        const p = state.products.find((x) => x.id === j.productId);
        return [j.jobNo, p?.name, j.customer].some((f) => f?.toLowerCase().includes(n));
      })
      .slice(0, 8);
  }, [q, state]);

  const pick = (jobNo: string) => {
    openTrace(jobNo);
    setQ('');
    setFocus(false);
    ref.current?.blur();
  };

  return (
    <div className="top-search">
      <Search size={17} />
      <input
        ref={ref}
        placeholder="Search or trace a job — e.g. JOB-2026-0001"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setHl(0);
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHl((h) => Math.min(h + 1, results.length - 1));
          if (e.key === 'ArrowUp') setHl((h) => Math.max(h - 1, 0));
          if (e.key === 'Enter' && results[hl]) pick(results[hl].jobNo);
        }}
      />
      {focus && (
        <div className="search-pop">
          {results.length === 0 && <div className="muted" style={{ padding: 10 }}>No matching jobs</div>}
          {results.map((j, i) => {
            const s = jobSummary(state, j.jobNo);
            return (
              <button key={j.jobNo} className={i === hl ? 'hl' : ''} onMouseDown={() => pick(j.jobNo)}>
                <ClipboardList size={15} className="muted" />
                <span>
                  <span className="mono strong">{j.jobNo}</span>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {s.product.name} · {STAGE_LABEL[j.currentStage]}
                  </div>
                </span>
                <span style={{ marginLeft: 'auto' }}>
                  <Badge status={s.status} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
