// Plain CSV, no library. Numbers are written raw (no ₹, no lakh commas) so a spreadsheet can add them up.
import type { ReportCol } from './config';

type Row = Record<string, unknown>;

const cell = (v: unknown): string => {
  if (v == null) return '';
  const t = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

const raw = (v: unknown, kind?: ReportCol['kind']): unknown => {
  if (v == null || v === '') return '';
  if (kind === 'date') return String(v).slice(0, 10);
  if (kind === 'num' || kind === 'money' || kind === 'pct') {
    const x = Number(v);
    return Number.isNaN(x) ? v : Math.round(x * 1000) / 1000;
  }
  return v;
};

export function toCsv(cols: ReportCol[], rows: Row[], totals?: Row | null): string {
  const head = cols.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => cols.map((c) => cell(raw(r[c.key], c.kind))).join(','));
  const foot = totals ? [cols.map((c, i) => (i === 0 ? 'Total' : c.total ? cell(raw(totals[c.key], c.kind)) : '')).join(',')] : [];
  // BOM so Excel opens ₹ / accented text correctly
  return '﻿' + [head, ...body, ...foot].join('\r\n');
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
