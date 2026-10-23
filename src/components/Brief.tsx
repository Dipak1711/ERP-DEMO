import type { ReactNode } from 'react';

/** the few facts a person needs to see in a confirmation pop-up before they confirm */
export function Brief({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px 18px', padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(127,127,127,0.07)' }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ minWidth: 0 }}>
          <div className="text-xs muted">{k}</div>
          <div className="strong" style={{ overflowWrap: 'anywhere' }}>{v}</div>
        </div>
      ))}
    </div>
  );
}
