// ---------------------------------------------------------------------------
// Role-based access to confidential commercial data.
//
//   Director, Plant Head → everything (confidential data + management dashboards)
//   Accounts             → confidential data: party names, purchase / sales rates, invoices, financial values
//   QC, Operator, Viewer → every confidential field is MASKED: the real value is never rendered, printed or exported,
//                          so there is nothing to select, copy, inspect or download.
//
// Confidential = party names (customer, supplier, die maker), invoice numbers, purchase / sales rates, die cost, values.
//
// The demo keeps data in the browser, so this layer is presentation-level only. In the Supabase build the same rules are
// enforced by the database (supabase/migrations 02, 13, 14) — see supabase/PLAN.md §10.
// ---------------------------------------------------------------------------
import { Fragment, createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Role = 'director' | 'plant_head' | 'accounts' | 'qc' | 'operator' | 'viewer';

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'director', label: 'Director', hint: 'Full access' },
  { value: 'plant_head', label: 'Plant Head', hint: 'Full access' },
  { value: 'accounts', label: 'Accounts Team', hint: 'Parties, rates, financials' },
  { value: 'qc', label: 'QC Inspector', hint: 'Confidential data masked' },
  { value: 'operator', label: 'Production / Store', hint: 'Confidential data masked' },
  { value: 'viewer', label: 'Viewer', hint: 'Confidential data masked' },
];

export const MASK = '••••••';

export const canSeeConfidential = (r: Role) => r === 'director' || r === 'plant_head' || r === 'accounts';
export const canSeeManagement = (r: Role) => r === 'director' || r === 'plant_head';

const KEY = 'forgeflow.role';
const isRole = (v: unknown): v is Role => ROLES.some((r) => r.value === v);

function readRole(): Role {
  try {
    const v = localStorage.getItem(KEY);
    if (isRole(v)) return v;
  } catch {
    /* private mode */
  }
  return 'director';
}

// Module-level mirror of the current role, for code that is not a React component (print templates, Excel export).
// Defaults to the LEAST privileged role, so anything that runs before the provider mounts is masked, never open.
let current: Role = 'viewer';
export const currentRole = () => current;
export const isConfidentialAllowed = () => canSeeConfidential(current);

/** Text for printouts / exports: the real value, or the mask. */
export const maskText = (v: string | number | null | undefined): string => (v == null || v === '' ? '' : isConfidentialAllowed() ? String(v) : MASK);
/** Numbers for exports: the real number, or the mask text. */
export const maskNum = (v: number | null | undefined): number | string => (v == null ? '' : isConfidentialAllowed() ? v : MASK);
/** For search filters: a masked user must not be able to probe hidden names by typing them. */
export const searchable = (v: string | undefined): string | undefined => (isConfidentialAllowed() ? v : '');

interface AccessValue {
  role: Role;
  setRole: (r: Role) => void;
  /** may see party names, rates, invoices, financial values */
  conf: boolean;
  /** may see management dashboards */
  mgmt: boolean;
}
const Ctx = createContext<AccessValue | null>(null);

export function RoleProvider({ children, initialRole }: { children: ReactNode; initialRole?: Role }) {
  const [role, setRoleState] = useState<Role>(() => {
    const r = initialRole ?? readRole();
    current = r;
    return r;
  });
  const setRole = useCallback((r: Role) => {
    current = r;
    try {
      localStorage.setItem(KEY, r);
    } catch {
      /* ignore */
    }
    setRoleState(r);
  }, []);
  current = role;
  const value = useMemo(() => ({ role, setRole, conf: canSeeConfidential(role), mgmt: canSeeManagement(role) }), [role, setRole]);
  // Re-mount the app below on a role switch, so no screen keeps values it rendered under the previous role.
  return (
    <Ctx.Provider value={value}>
      <Fragment key={role}>{children}</Fragment>
    </Ctx.Provider>
  );
}

export function useAccess() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAccess outside RoleProvider');
  return v;
}

/** Renders its children for authorised roles, a non-selectable masked placeholder for everyone else. */
export function Conf({ children, empty = '—' }: { children?: ReactNode; empty?: ReactNode }) {
  const { conf } = useAccess();
  if (children == null || children === '') return <>{empty}</>;
  if (conf) return <>{children}</>;
  return (
    <span className="masked" role="img" aria-label="Confidential — hidden" title="Confidential — you do not have access">
      {MASK}
    </span>
  );
}
