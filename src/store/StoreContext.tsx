import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dbMessage } from '../db/client';
import { loadERPState, loadMasters, type Masters } from '../db/load';
import { useAccess } from '../auth/access';
import type { ERPState, ProcessStage } from './types';

/** A shop-floor action that opens its form wherever the user is (page, dashboard, drawer, bell menu). */
export type Action =
  | { kind: 'newJob' }
  | { kind: 'product'; id?: string }
  | { kind: 'inward'; material?: string; od?: number }
  | { kind: 'stage'; stage: ProcessStage; jobNo: string }
  | { kind: 'qc'; jobNo: string }
  | { kind: 'hardness'; id?: string; jobNo?: string }
  | { kind: 'hardnessView'; id: string }
  | { kind: 'dispatch'; fgId: string };

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  message?: string;
}

interface StoreValue {
  /** Everything the screens read — loaded from Supabase (confidential columns already withheld by the database). */
  state: ERPState;
  /** dropdown lists (suppliers / customers are empty for roles without access) */
  masters: Masters;
  /** re-reads everything from the database */
  refresh: () => Promise<void>;
  /**
   * Runs one database action (a single transaction on the server). On success the data is re-read and a toast shown;
   * on failure the database's own message is shown. Resolves to true on success.
   */
  run: (fn: (nowIso: string) => Promise<unknown>, success?: { title: string; message?: string }) => Promise<boolean>;
  toast: (t: Omit<Toast, 'id'>) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
  traceJob: string | null;
  openTrace: (jobNo: string | null) => void;
  action: Action | null;
  openAction: (a: Action | null) => void;
}

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { logout } = useAccess();
  const [data, setData] = useState<{ state: ERPState; masters: Masters } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [traceJob, setTraceJob] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const seq = useRef(0);

  const fetchAll = useCallback(async () => {
    const [state, masters] = await Promise.all([loadERPState(), loadMasters()]);
    setData({ state, masters });
  }, []);

  const load = useCallback(() => {
    setLoadError('');
    fetchAll().catch((e) => setLoadError(dbMessage(e)));
  }, [fetchAll]);
  useEffect(load, [load]);

  // Navigating to another page closes any open form or job drawer.
  useEffect(() => {
    const close = () => {
      setAction(null);
      setTraceJob(null);
    };
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq.current;
      setToasts((list) => [...list.slice(-1), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === 'error' ? 6000 : 4000);
    },
    [dismiss],
  );

  const run = useCallback<StoreValue['run']>(
    async (fn, success) => {
      try {
        await fn(new Date().toISOString());
      } catch (e) {
        toast({ kind: 'error', title: 'Action not allowed', message: dbMessage(e) });
        return false;
      }
      try {
        await fetchAll();
      } catch (e) {
        toast({ kind: 'error', title: 'Saved, but the screen could not refresh', message: dbMessage(e) });
        return true;
      }
      if (success) toast({ kind: 'success', ...success });
      return true;
    },
    [fetchAll, toast],
  );

  const refresh = useCallback(() => fetchAll().catch((e) => toast({ kind: 'error', title: 'Could not refresh', message: dbMessage(e) })), [fetchAll, toast]);

  const value = useMemo(
    () =>
      data && {
        state: data.state,
        masters: data.masters,
        refresh,
        run,
        toast,
        toasts,
        dismiss,
        traceJob,
        openTrace: setTraceJob,
        action,
        openAction: setAction,
      },
    [data, refresh, run, toast, toasts, dismiss, traceJob, action],
  );

  if (!value) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ gridTemplateColumns: '1fr', maxWidth: 440, padding: 36, textAlign: 'center' }}>
          {loadError ? (
            <>
              <h2 style={{ margin: '0 0 8px' }}>Could not load the plant data</h2>
              <p className="muted" style={{ margin: '0 0 18px', wordBreak: 'break-word' }}>{loadError}</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={load}>
                  Try again
                </button>
                <button className="btn" onClick={() => void logout()}>
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ margin: '0 0 8px' }}>Loading plant data…</h2>
              <p className="muted" style={{ margin: 0 }}>Reading from the database.</p>
            </>
          )}
        </div>
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}
