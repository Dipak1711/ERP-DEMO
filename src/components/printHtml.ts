/** Prints an HTML fragment through a hidden iframe — no pop-up blocker involved. */
export function printHtml(title: string, body: string, css = '') {
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const doc = f.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:12px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:24px}${css}</style></head><body>${body}</body></html>`);
  doc.close();
  f.contentWindow!.focus();
  setTimeout(() => {
    f.contentWindow!.print();
    setTimeout(() => f.remove(), 1500);
  }, 250);
}
