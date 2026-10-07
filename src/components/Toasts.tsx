import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useStore } from '../store/StoreContext';

export function Toasts() {
  const { toasts, dismiss } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="ti">
            {t.kind === 'success' ? <CheckCircle2 size={18} /> : t.kind === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}
          </span>
          <div>
            <div className="t">{t.title}</div>
            {t.message && <div className="m">{t.message}</div>}
          </div>
          <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
