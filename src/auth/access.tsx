// ---------------------------------------------------------------------------
// Sign-in session + role-based access to confidential commercial data.
//
//   Director, Plant Head → everything (confidential data + management dashboards)
//   Accounts             → confidential data: party names, purchase / sales rates, invoices, financial values
//   QC, Operator, Viewer → every confidential column / line / field is HIDDEN: it is not rendered, printed or exported at all,
//                          so there is nothing to select, copy, inspect or download.
//
// Confidential = party names (customer, supplier, die maker), invoice numbers, purchase / sales rates, die cost, values.
//
// The demo keeps data in the browser, so this layer is presentation-level only. In the Supabase build the same rules are
// enforced by the database (supabase/migrations 02, 13, 14) — see supabase/PLAN.md §10.
// ---------------------------------------------------------------------------
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { demoUserByEmail, findDemoUser } from './users';

export type Role = 'director' | 'plant_head' | 'accounts' | 'qc' | 'operator' | 'viewer';

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'director', label: 'Director', hint: 'Full access' },
  { value: 'plant_head', label: 'Plant Head', hint: 'Full access' },
  { value: 'accounts', label: 'Accounts Team', hint: 'Parties, rates, financials' },
  { value: 'qc', label: 'QC Inspector', hint: 'Confidential data masked' },
  { value: 'operator', label: 'Production / Store', hint: 'Confidential data masked' },
  { value: 'viewer', label: 'Viewer', hint: 'Confidential data masked' },
];

export const canSeeConfidential = (r: Role) => r === 'director' || r === 'plant_head' || r === 'accounts';
export const canSeeManagement = (r: Role) => r === 'director' || r === 'plant_head';

const KEY = 'forgeflow.session';

export interface Session {
  email: string;
  name: string;
  role: Role;
}

/** The role is always re-read from the account list, never trusted from storage. */
function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const u = demoUserByEmail((JSON.parse(raw) as { email?: string }).email ?? '');
    return u ? { email: u.email, name: u.name, role: u.role } : null;
  } catch {
    return null;
  }
}

// Module-level mirror of the current role, for code that is not a React component (print templates, Excel export).
// Defaults to the LEAST privileged role, so anything that runs while signed out is masked, never open.
let current: Role = 'viewer';
export const currentRole = () => current;
export const isConfidentialAllowed = () => canSeeConfidential(current);

/** Text for printouts / exports: the real value, or nothing at all (callers also drop the column / line title). */
export const maskText = (v: string | number | null | undefined): string => (v == null || v === '' || !isConfidentialAllowed() ? '' : String(v));
/** For search filters: a masked user must not be able to probe hidden names by typing them. */
export const searchable = (v: string | undefined): string | undefined => (isConfidentialAllowed() ? v : '');

interface AccessValue {
  /** null = signed out */
  user: Session | null;
  /** least-privileged role while signed out */
  role: Role;
  /** returns false for wrong credentials */
  login: (email: string, password: string) => boolean;
  logout: () => void;
  /** may see party names, rates, invoices, financial values */
  conf: boolean;
  /** may see management dashboards */
  mgmt: boolean;
}
const Ctx = createContext<AccessValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Session | null>(() => {
    const s = readSession();
    current = s?.role ?? 'viewer';
    return s;
  });
  const login = useCallback((email: string, password: string) => {
    const u = findDemoUser(email, password);
    if (!u) return false;
    const s: Session = { email: u.email, name: u.name, role: u.role };
    current = s.role;
    try {
      localStorage.setItem(KEY, JSON.stringify({ email: s.email })); // no password, no role: both are looked up again on load
    } catch {
      /* private mode: stays signed in for this tab only */
    }
    setUser(s);
    return true;
  }, []);
  const logout = useCallback(() => {
    current = 'viewer';
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);
  const role = user?.role ?? 'viewer';
  current = role;
  const value = useMemo(() => ({ user, role, login, logout, conf: !!user && canSeeConfidential(role), mgmt: !!user && canSeeManagement(role) }), [user, role, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccess() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAccess outside RoleProvider');
  return v;
}

/**
 * Renders its children only for roles that may see confidential data. For everyone else it renders NOTHING — no blur, no dots —
 * so wrap the whole column (`<th>` and `<td>`), line or field, title included, not just the value.
 */
export function Conf({ children }: { children?: ReactNode }) {
  const { conf } = useAccess();
  return conf ? <>{children}</> : null;
}
