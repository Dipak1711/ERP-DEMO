const nf = new Intl.NumberFormat('en-IN');
const kgf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

export const fmtNum = (n: number) => nf.format(n);
/** "1 job", "2 jobs", "1 dispatch", "3 dispatches" */
export const plural = (n: number, one: string, many = `${one}s`) => `${nf.format(n)} ${n === 1 ? one : many}`;
export const fmtKg = (n: number) => `${kgf.format(n)} KG`;

export function fmtDate(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const matches = (q: string, ...fields: (string | number | undefined)[]) => {
  const n = q.trim().toLowerCase();
  return !n || fields.some((f) => String(f ?? '').toLowerCase().includes(n));
};
