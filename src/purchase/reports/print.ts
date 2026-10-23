// Printout of a purchase report in the same look as the Purchase Order: company logo, the navy / teal header card, the same table and footer.
import { printHtml } from '../../components/printHtml';
import { PO_UFLOW_CSS } from '../../sales/print';
import type { ReportCol } from './config';

type Row = Record<string, unknown>;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const REPORT_CSS = `
@page { size: A4 landscape; margin: 10mm 12mm 14mm 12mm; }
.po-doc { max-width: none; }
.po-meta-card { width: 270px; }
.po-meta-val { white-space: nowrap; }
.rp-title { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; border: 1px solid #bce8e7; border-radius: 4px; overflow: hidden; }
.rp-title .band { background: #e6f6f6 !important; color: #166564 !important; font-weight: 700; font-size: 10.5px; padding: 9px 14px; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.rp-title .name { font-size: 15px; font-weight: 800; color: #0f172a; padding: 6px 4px; }
.rp-filters { display: flex; flex-wrap: wrap; gap: 4px 18px; border: 1px solid #e2e8f0; border-radius: 4px; padding: 7px 12px; margin-bottom: 12px; font-size: 10px; color: #475569; background: #fff; }
.rp-filters b { color: #0f172a; }
.rp-note { font-size: 9.5px; color: #64748b; margin: -4px 0 10px; }
.rp-table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; margin-bottom: 14px; }
.rp-table thead { display: table-header-group; }
.rp-table tr { page-break-inside: avoid; }
.rp-table th { background: #f8fafc !important; color: #0f172a; font-size: 9px; font-weight: 700; padding: 7px 6px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #259392; border-right: 1px solid #e2e8f0; text-align: left; vertical-align: bottom; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.rp-table td { padding: 6px 6px; font-size: 10px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; vertical-align: top; color: #1e293b; }
.rp-table th:last-child, .rp-table td:last-child { border-right: none; }
.rp-table .r { text-align: right; }
.rp-table tbody tr:nth-child(even) td { background: #fafcfc; }
.rp-table .tot td { background: #1a3c61 !important; color: #fff !important; font-weight: 700; font-size: 10.5px; padding: 8px 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact; border-color: #1a3c61; }
.rp-empty { padding: 24px; text-align: center; color: #64748b; }
`;

export interface ReportPrint {
  title: string;
  group: string;
  cols: ReportCol[];
  rows: Row[];
  totals: Row | null;
  /** text of one cell, formatted the way the screen shows it */
  show: (c: ReportCol, v: unknown) => string;
  /** [label, value] of every filter that is set */
  filters: [string, string][];
  printedBy: string;
  note?: string;
  /** the box at the top right, e.g. SALES REPORT (default PURCHASE REPORT) */
  heading?: string;
}

export function printReport(p: ReportPrint) {
  const right = (c: ReportCol) => c.kind === 'num' || c.kind === 'money' || c.kind === 'pct';
  const head = p.cols.map((c) => `<th class="${right(c) ? 'r' : ''}">${esc(c.label)}</th>`).join('');
  const body = p.rows
    .map((r) => `<tr>${p.cols.map((c) => `<td class="${right(c) ? 'r' : ''}">${esc(p.show(c, r[c.key]))}</td>`).join('')}</tr>`)
    .join('');
  const foot = p.totals
    ? `<tr class="tot">${p.cols.map((c, i) => `<td class="${right(c) ? 'r' : ''}">${i === 0 ? 'Total' : c.total ? esc(p.show(c, p.totals![c.key])) : ''}</td>`).join('')}</tr>`
    : '';
  const now = new Date();
  const when = now.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const filters = p.filters.length
    ? `<div class="rp-filters">${p.filters.map(([k, v]) => `<span>${esc(k)}: <b>${esc(v)}</b></span>`).join('')}</div>`
    : '';

  const html = `
<div class="po-doc">
  <table class="po-top-table">
    <tr>
      <td style="width: 68%;">
        <div class="po-header-left">
          <img src="/everest-logo.png" alt="Everest Auto Forge" class="po-logo" onerror="this.style.display='none'" />
        </div>
      </td>
      <td style="width: 32%; text-align: right;">
        <div class="po-meta-card">
          <div class="po-meta-title">${esc(p.heading ?? 'PURCHASE REPORT')}</div>
          <table class="po-meta-table">
            <tr><td class="po-meta-label">Printed</td><td class="po-meta-val">${esc(when)}</td></tr>
            <tr><td class="po-meta-label">By</td><td class="po-meta-val">${esc(p.printedBy)}</td></tr>
            <tr><td class="po-meta-label">Rows</td><td class="po-meta-val">${p.rows.length}</td></tr>
          </table>
        </div>
      </td>
    </tr>
  </table>

  <div class="rp-title"><div class="band">${esc(p.group)}</div><div class="name">${esc(p.title)}</div></div>
  ${filters}
  ${p.note ? `<div class="rp-note">${esc(p.note)}</div>` : ''}

  ${
    p.rows.length === 0
      ? '<div class="rp-empty">No rows for the selected filters.</div>'
      : `<table class="rp-table"><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table>`
  }

  <div class="po-foot-meta">
    <span>This is a computer-generated report. &nbsp;·&nbsp; Everest Auto Forge Pvt. Ltd. &nbsp;·&nbsp; E.&amp;O.E.</span>
    <span>${esc(p.title)} &nbsp;•&nbsp; ${esc(when)}</span>
  </div>
</div>`;

  printHtml(p.title, html, PO_UFLOW_CSS + REPORT_CSS);
}
