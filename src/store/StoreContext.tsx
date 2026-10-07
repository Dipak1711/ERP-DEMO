import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ERPError } from './engine';
import { loadState, resetState, saveState } from './storage';
import type { ERPState, ProcessStage } from './types';

/** A shop-floor action that opens its form wherever the user is (page, dashboard, drawer, bell menu). */
export type Action =
  | { kind: 'newJob' }
  | { kind: 'inward'; material?: string; od?: number }
  | { kind: 'stage'; stage: ProcessStage; jobNo: string }
  | { kind: 'qc'; jobNo: string }
  | { kind: 'dispatch'; fgId: string };

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  message?: string;
}

interface StoreValue {
  state: ERPState;
  /** Runs an engine mutation on a draft copy; persists on success, toasts on error. Returns true on success. */
  run: (fn: (draft: ERPState, ts: string) => void, success?: { title: string; message?: string }) => boolean;
  reset: () => void;
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
  const [state, setState] = useState<ERPState>(() => loadState());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [traceJob, setTraceJob] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const prev = useRef<ERPState | undefined>(undefined);
  const seq = useRef(0);

  // Navigating to another page closes any open form or job drawer.
  useEffect(() => {
    const close = () => {
      setAction(null);
      setTraceJob(null);
    };
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, []);

  useEffect(() => {
    if (prev.current && prev.current !== state) saveState(state, prev.current);
    prev.current = state;
  }, [state]);

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
    (fn, success) => {
      try {
        const draft = structuredClone(state);
        fn(draft, new Date().toISOString());
        setState(draft);
        if (success) toast({ kind: 'success', ...success });
        return true;
      } catch (e) {
        const msg = e instanceof ERPError ? e.message : 'Unexpected error — see console.';
        if (!(e instanceof ERPError)) console.error(e);
        toast({ kind: 'error', title: 'Action not allowed', message: msg });
        return false;
      }
    },
    [state, toast],
  );

  const reset = useCallback(() => {
    setState(resetState());
    setTraceJob(null);
    setAction(null);
    toast({ kind: 'info', title: 'All data cleared', message: 'Raw material stock and all jobs have been removed. Products and other masters are kept.' });
  }, [toast]);

  const value = useMemo(
    () => ({ state, run, reset, toast, toasts, dismiss, traceJob, openTrace: setTraceJob, action, openAction: setAction }),
    [state, run, reset, toast, toasts, dismiss, traceJob, action],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}
