// ---------------------------------------------------------------------------
// Sign-in (Supabase Auth) + role-based access to confidential commercial data.
//
//   Director, Plant Head → everything (confidential data + management dashboards)
//   Accounts             → confidential data: party names, purchase / sales rates, invoices, financial values
//   QC, Operator, Viewer → every confidential column / line / field is HIDDEN: it is not rendered, printed or exported at all.
//
// Confidential = party names (customer, supplier, die maker), invoice numbers, purchase / sales rates, die cost, values.
//
// The role is read from the database (view v_me ← profiles.role), never from the browser. The database itself withholds
// the confidential values from roles without access (supabase/migrations 02, 13, 14, 16); the flags below only decide
// which columns / lines the screens draw. See supabase/PLAN.md §10.
// ---------------------------------------------------------------------------
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase, dbConfigured, dbMessage } from '../db/client';

export type Role = 'director' | 'plant_head' | 'accounts' | 'qc' | 'operator' | 'viewer';

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'director', label: 'Director', hint: 'Full access' },
  { value: 'plant_head', label: 'Plant Head', hint: 'Full access' },
  { value: 'accounts', label: 'Accounts Team', hint: 'Parties, rates, financials' },
  { value: 'qc', label: 'QC Inspector', hint: 'Confidential data hidden' },
  { value: 'operator', label: 'Production / Store', hint: 'Confidential data hidden' },
  { value: 'viewer', label: 'Viewer', hint: 'Confidential data hidden' },
];

export interface Session {
  email: string;
  name: string;
  role: Role;
  /** may see party names, rates, invoices, financial values (from the database) */
  conf: boolean;
  /** may see management dashboards and edit master data (from the database) */
  mgmt: boolean;
}

// Module-level mirror of the current permission, for code that is not a React component (print templates, Excel export).
// Defaults to NO access, so anything that runs while signed out shows nothing confidential.
let currentConf = false;
let currentRole: Role = 'viewer';
export const isConfidentialAllowed = () => currentConf;
export const roleNow = () => currentRole;

/** Text for printouts / exports: the real value, or nothing at all (callers also drop the column / line title). */
export const maskText = (v: string | number | null | undefined): string => (v == null || v === '' || !currentConf ? '' : String(v));
/** For search filters: a role without access must not be able to probe hidden names by typing them. */
export const searchable = (v: string | undefined): string | undefined => (currentConf ? v : '');

interface AccessValue {
  /** null = signed out */
  user: Session | null;
  /** true while the stored session is being checked on start-up */
  loading: boolean;
  role: Role;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  conf: boolean;
  mgmt: boolean;
}
const Ctx = createContext<AccessValue | null>(null);

type Meta = { full_name?: string };

/** Reads who the database says this user is. null = no active profile (e.g. deactivated). */
async function loadSession(): Promise<Session | null> {
  const { data: auth } = await supabase.auth.getSession();
  const u = auth.session?.user;
  if (!u) return null;
  const { data, error } = await supabase.from('v_me').select('role, can_see_confidential, can_see_management').maybeSingle();
  if (error || !data) return null;
  return {
    email: u.email ?? '',
    name: (u.user_metadata as Meta | undefined)?.full_name || u.email || 'User',
    role: data.role as Role,
    conf: !!data.can_see_confidential,
    mgmt: !!data.can_see_management,
  };
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Session | null>(null);
  const [loading, setLoading] = useState(dbConfigured);

  const apply = useCallback((s: Session | null) => {
    currentConf = !!s?.conf;
    currentRole = s?.role ?? 'viewer';
    setUser(s);
  }, []);

  useEffect(() => {
    if (!dbConfigured) return;
    let alive = true;
    loadSession()
      .then((s) => alive && apply(s))
      .catch(() => alive && apply(null))
      .finally(() => alive && setLoading(false));
    // signed out in another tab, or the session expired
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') apply(null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [apply]);

  const login = useCallback(
    async (email: string, password: string) => {
      if (!dbConfigured) return 'Supabase is not configured — fill in .env and restart.';
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return /invalid login/i.test(error.message) ? 'Invalid email or password.' : dbMessage(error);
      const s = await loadSession();
      if (!s) {
        await supabase.auth.signOut();
        return 'Your account is not active. Ask the Director to enable it.';
      }
      apply(s);
      return null;
    },
    [apply],
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    apply(null);
  }, [apply]);

  const value = useMemo<AccessValue>(
    () => ({ user, loading, role: user?.role ?? 'viewer', login, logout, conf: !!user?.conf, mgmt: !!user?.mgmt }),
    [user, loading, login, logout],
  );
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
