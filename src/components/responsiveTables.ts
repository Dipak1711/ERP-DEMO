import { useEffect } from 'react';

/**
 * On a phone every `table.tbl` turns into a stack of cards (see "responsive" at the end of styles.css). The card needs to know what each
 * value is, so every cell gets a `data-label` copied from its column heading. Tables written once, working everywhere: no page has to
 * change. A table that must stay a table can carry the attribute `data-keep-table`.
 */
function label(root: ParentNode) {
  root.querySelectorAll<HTMLTableElement>('table.tbl').forEach((t) => {
    if (t.hasAttribute('data-keep-table')) return;
    const head = t.tHead?.rows[0];
    if (!head) return;
    const labels: string[] = [];
    Array.from(head.cells).forEach((c) => {
      const text = (c.textContent ?? '').replace(/\s+/g, ' ').replace(/\*/g, '').trim();
      for (let i = 0; i < Math.max(1, c.colSpan); i++) labels.push(text);
    });
    Array.from(t.tBodies).forEach((b) =>
      Array.from(b.rows).forEach((r) => {
        let i = 0;
        Array.from(r.cells).forEach((c) => {
          let l = c.colSpan > 1 ? '' : labels[i] ?? '';
          if (l === '#') l = 'Line';
          if (c.getAttribute('data-label') !== l) c.setAttribute('data-label', l);
          // an unlabelled cell with nothing to read or click (just an arrow) is left out of the card
          const decor = l === '' && !(c.textContent ?? '').trim() && !c.querySelector('button, a, input, select, textarea');
          if (decor !== c.hasAttribute('data-decor')) (decor ? c.setAttribute('data-decor', '') : c.removeAttribute('data-decor'));
          i += Math.max(1, c.colSpan);
        });
      }),
    );
    if (!t.hasAttribute('data-cards')) t.setAttribute('data-cards', '');
  });
}

export function useResponsiveTables() {
  useEffect(() => {
    const main = document.querySelector('main.content');
    if (!main) return;
    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => label(document));
    };
    run();
    const mo = new MutationObserver(run);
    // the pop-up and full-page forms render outside <main>, so watch the whole page
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
}
