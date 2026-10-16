// Printouts for the Sales & Orders pages. Same family as the Process Route Card and the Hardness Report (Everest Auto Forge
// header block, navy ruled tables, blue values) — only the content changes. Customer names and rates are left out for roles
// that may not see them.
import { canSee } from '../auth/access';
import { printHtml } from '../components/printHtml';
import { ROUTE_CARD_CSS } from '../components/routeCard';
import type { SalesKind, SalesRecord } from './config';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const dmy = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getFullYear()).slice(2)}`;
};
const inr = (n: number) => `₹ ${n.toLocaleString('en-IN')}`;

// ---- amount in words (Indian system: thousand, lakh, crore)
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`);
const below1000 = (n: number) => `${n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : ''}${below100(n % 100)}`;
function wholeInWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1e3);
  const rest = n % 1e3;
  if (crore) parts.push(`${wholeInWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}
export function rupeesInWords(amount: number) {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  return `Rupees ${wholeInWords(rupees)}${paise ? ` and ${below100(paise)} Paise` : ''} Only`;
}

const TITLE: Record<SalesKind, string> = {
  quotation: 'SALES QUOTATION',
  lead: 'LEAD',
  inquiry: 'INQUIRY',
  purchase_order: 'PURCHASE ORDER',
  sales_order: 'SALES ORDER',
  final_order: 'FINAL ORDER',
  task: 'TASK ASSIGNMENT',
};
const NO_LABEL: Record<SalesKind, string> = {
  quotation: 'Quotation No.',
  lead: 'Lead No.',
  inquiry: 'Inquiry No.',
  purchase_order: 'PO No.',
  sales_order: 'Sales Order No.',
  final_order: 'Order No.',
  task: 'Task No.',
};
const DUE_LABEL: Record<SalesKind, string> = {
  quotation: 'Valid Until',
  lead: 'Date',
  inquiry: 'Required By',
  purchase_order: 'Delivery Date',
  sales_order: 'Delivery Date',
  final_order: 'Delivery Date',
  task: 'Due Date',
};
const REF_LABEL: Record<SalesKind, string> = {
  quotation: 'Inquiry No.',
  lead: 'Linked To',
  inquiry: 'Lead No.',
  purchase_order: 'Quotation No.',
  sales_order: 'Quotation No.',
  final_order: 'PO No.',
  task: 'Related To',
};

/** label, value (undefined = hidden for this role, the pair is dropped), full width? */
type Pair = [label: string, value: string | undefined, full?: boolean];
/** a value only for roles that may see it */
const party = (v: string): string | undefined => (canSee('party_names') ? v : undefined);

/** the ruled detail table: two fields per line, full-width ones on their own line */
function detailTable(pairs: Pair[]) {
  const list = pairs.filter((p) => p[1] !== undefined);
  const lines: Pair[][] = [];
  let open: Pair[] = [];
  for (const p of list) {
    if (p[2]) {
      if (open.length) lines.push(open);
      lines.push([p]);
      open = [];
    } else {
      open.push(p);
      if (open.length === 2) {
        lines.push(open);
        open = [];
      }
    }
  }
  if (open.length) lines.push(open);
  // each field reads "Label : value" in one cell — the value sits right after its label, no divider between them
  const cell = ([label, value]: Pair, span = '') => `<td class="l dc"${span}>${esc(label)} : <span class="v">${esc(value)}</span></td>`;
  const line = (l: Pair[]) => {
    if (l.length === 2) return `<tr>${cell(l[0])}${cell(l[1])}</tr>`;
    return `<tr>${cell(l[0], ' colspan="2"')}</tr>`; // a lone pair (full-width, or the odd one out) fills its line
  };
  return `<table class="dt">${lines.map(line).join('')}</table>`;
}

/** the header block has no vertical dividers (only its outer frame); the rest tidies the layout without changing its structure */
export const SALES_CSS = `
.rc .hd td{border-left:0;border-right:0}.rc .hd td:first-child{border-left:1.5px solid #1f3a5f}.rc .hd td:last-child{border-right:1.5px solid #1f3a5f}
.rc.sd td,.rc.sd th{padding:9px 13px;font-size:13px}
.rc.sd .hd td{padding:16px 16px;border-bottom:2.5px solid #1f3a5f}
.rc.sd .ttl{font-size:23px;letter-spacing:.05em}
.rc.sd .fm{font-size:12.5px}
.rc.sd .no td{font-size:14.5px;padding:11px 14px}
.rc.sd .dt{table-layout:fixed}
.rc.sd .dt td.dc{width:50%;padding:12px 14px;font-size:13.5px}
.rc.sd .dt .v{font-size:14.5px}
.rc.sd .pt th{background:#eef3fb;padding:11px 8px;font-size:12px;letter-spacing:.02em}
.rc.sd .pt td{height:44px;font-size:13.5px}
.rc.sd .pt tr.tot td{background:#eef3fb;font-weight:800;font-size:14px}
.rc.sd .words td{background:#f8faff;font-size:12.5px;font-weight:700;color:#1f3a5f}
.rc.sd .rem td{height:120px;vertical-align:top}
.rc.sd .sign td{height:104px;vertical-align:top;position:relative}
.rc.sd .sign small{position:absolute;left:13px;bottom:9px;font-weight:600;color:#6b7a99;font-size:10.5px}
.rc.sd .foot{margin-top:10px;font-size:10px;color:#6b7a99;display:flex;justify-content:space-between}
`;

export function salesRecordHtml(r: SalesRecord) {
  const k = r.kind;
  const rates = canSee('sales_rates');
  const hasItem = k === 'quotation' || k === 'purchase_order' || k === 'sales_order' || k === 'final_order';

  // ---- the detail lines, per kind
  let pairs: Pair[];
  if (k === 'task') {
    pairs = [['Task', r.title, true], ['Assigned To', r.assignee], ['Priority', r.priority], [DUE_LABEL[k], dmy(r.dueDate)], [REF_LABEL[k], r.refNo], ['Status', r.status]];
  } else if (k === 'lead') {
    pairs = [['Company / Name', party(r.party), true], ['Contact Person', party(r.contact)], ['Phone', party(r.phone)], ['Email', party(r.email)], ['Source', r.source], ['Interested In', r.product]];
  } else if (k === 'inquiry') {
    pairs = [['Customer', party(r.party), true], ['Contact Person', party(r.contact)], ['Phone', party(r.phone)], ['Product', r.product], ['Quantity', r.qty == null ? '' : `${r.qty} PCS`], [DUE_LABEL[k], dmy(r.dueDate)], [REF_LABEL[k], r.refNo]];
  } else {
    pairs = [['Customer', party(r.party), true], [DUE_LABEL[k], dmy(r.dueDate)], [REF_LABEL[k], r.refNo]];
    if (k === 'purchase_order' || k === 'sales_order') pairs.push(['Customer PO No.', r.extRef]);
  }

  // ---- the item table (Quotation / Purchase Order / Final Order)
  const item = hasItem
    ? `<table class="pt">
    <tr><th style="width:34px">Sr. No.</th><th>Product</th><th>Quantity (PCS)</th>${rates ? '<th>Rate (₹ / pc)</th><th>Amount (₹)</th>' : ''}</tr>
    <tr><td class="n">1</td><td class="p">${esc(r.product)}</td><td>${r.qty ?? ''}</td>${rates ? `<td>${r.rate == null ? '' : inr(r.rate)}</td><td>${r.amount == null ? '' : inr(r.amount)}</td>` : ''}</tr>
    ${rates ? `<tr class="tot"><td colspan="4" style="text-align:right">Total</td><td>${r.amount == null ? '' : inr(r.amount)}</td></tr>` : ''}
  </table>
  ${rates && r.amount != null ? `<table class="words"><tr><td>Amount in words : ${rupeesInWords(r.amount)}</td></tr></table>` : ''}`
    : '';

  const now = new Date();
  const stamp = `${dmy(now.toISOString())} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return `<div class="rc sd">
  <table class="hd">
    <tr><td style="width:34%"><div class="brand"><div class="logo">E</div><div class="co">Everest<small>Auto Forge Pvt. Ltd.</small></div></div></td>
        <td class="ttl">${TITLE[k]}</td>
        <td class="fm" style="width:24%">${k === 'task' ? '' : `Status : ${esc(r.status)}`}</td></tr>
  </table>
  <table class="no">
    <tr><td class="l" style="width:50%">${NO_LABEL[k]} &nbsp;<span class="v">${esc(r.docNo)}</span></td><td class="l" style="text-align:right">Date : <span class="v">${dmy(r.docDate)}</span></td></tr>
  </table>
  ${detailTable(pairs)}
  ${item}
  <table class="rem">
    <tr><td class="l">Remarks : <span class="v" style="font-weight:600;font-size:13px">${esc(r.remarks)}</span></td></tr>
  </table>
  <table class="sign"><tr><td>Prepared By:<small>Signature &amp; date</small></td><td>Approved By:<small>Signature &amp; date</small></td></tr></table>
  <div class="foot"><span>Everest Auto Forge Pvt. Ltd.</span><span>${esc(r.docNo)} · printed ${stamp}</span></div>
</div>`;
}

export const printSalesRecord = (r: SalesRecord) => printHtml(`${TITLE[r.kind]} ${r.docNo}`, salesRecordHtml(r), ROUTE_CARD_CSS + SALES_CSS);
