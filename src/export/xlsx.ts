// Real .xlsx export (write-excel-file). Numbers stay numbers so a sheet can add them up.
import writeExcelFile from 'write-excel-file/browser';

export interface XlsxCol {
  key: string;
  label: string;
  kind?: 'text' | 'num' | 'money' | 'pct' | 'date' | 'badge' | string;
  total?: boolean;
}
type Row = Record<string, unknown>;
type Cell = { value?: string | number | Date | boolean; type?: StringConstructor | NumberConstructor | DateConstructor | BooleanConstructor; fontWeight?: 'bold'; format?: string; backgroundColor?: string; align?: 'left' | 'right' | 'center' } | null;

const body = (v: unknown, kind?: string): Cell => {
  if (v == null || v === '') return null;
  if (kind === 'num' || kind === 'money' || kind === 'pct') {
    const x = Number(v);
    if (Number.isNaN(x)) return { value: String(v), type: String };
    return { value: Math.round(x * 1000) / 1000, type: Number, format: kind === 'money' ? '#,##0.00' : kind === 'pct' ? '0.00"%"' : '#,##0.###' };
  }
  if (kind === 'date') return { value: String(v).slice(0, 10), type: String };
  if (typeof v === 'boolean') return { value: v ? 'Yes' : 'No', type: String };
  return { value: String(v), type: String };
};

export async function downloadXlsx(filename: string, sheet: string, cols: XlsxCol[], rows: Row[], totals?: Row | null) {
  const head: Cell[] = cols.map((c) => ({ value: c.label, type: String, fontWeight: 'bold', backgroundColor: '#e8eef5' }));
  const data: Cell[][] = [head, ...rows.map((r) => cols.map((c) => body(r[c.key], c.kind)))];
  if (totals) {
    data.push(cols.map((c, i) => (i === 0 ? { value: 'Total', type: String, fontWeight: 'bold' } : c.total ? { ...body(totals[c.key], c.kind), fontWeight: 'bold' } as Cell : null)));
  }
  const columns = cols.map((c) => ({ width: Math.max(12, Math.min(34, c.label.length + 4)) }));
  await writeExcelFile(data as never, { columns, sheet: sheet.slice(0, 31), stickyRowsCount: 1 } as never).toFile(filename.endsWith('.xlsx') ? filename : filename + '.xlsx');
}
