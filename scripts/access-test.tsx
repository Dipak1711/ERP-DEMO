// Role-permission test for the confidential-data masking:  npm run test:access
//
// For every role it renders every page, form, drawer, print template and Excel/CSV export, then scans the output for any
// real party name, invoice number, rate or cost. Authorised roles must see them (proves the scan works); masked roles
// must see none of them anywhere.
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';

// Data comes from scripts/fixtures (the app itself starts empty).
// ---- tiny DOM stand-in so print / export helpers can run in Node ----
const printed: string[] = [];
const blobs: Blob[] = [];
const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  documentElement: { getAttribute: () => 'light', setAttribute() {} },
  body: { appendChild() {} },
  createElement: (tag: string) =>
    tag === 'iframe'
      ? { style: {}, contentDocument: { open() {}, write: (s: string) => printed.push(s), close() {} }, contentWindow: { focus() {}, print() {} }, remove() {} }
      : { click() {} },
};
g.window = { matchMedia: () => ({ matches: true }), innerWidth: 1400, location: { hash: '' }, addEventListener() {}, removeEventListener() {}, scrollTo() {}, print() {} };
URL.createObjectURL = (b: Blob | MediaSource) => (blobs.push(b as Blob), 'blob:test');

const { RoleProvider, ROLES, MASK, canSeeConfidential, canSeeManagement, searchable } = await import('../src/auth/access');
type R = import('../src/auth/access').Role;
const { StoreProvider } = await import('../src/store/StoreContext');
const { DieProvider } = await import('../src/dies/DieContext');
const { buildSample } = await import('./fixtures/sample');
const { buildDieSeed } = await import('./fixtures/dieSample');
const { Dashboard } = await import('../src/pages/Dashboard');
const { RawInventoryPage, InwardModal } = await import('../src/pages/RawInventoryPage');
const { StagePage } = await import('../src/pages/StagePage');
const { QCPage } = await import('../src/pages/QCPage');
const { FinishedGoodsPage } = await import('../src/pages/FinishedGoodsPage');
const { DispatchPage, NewDispatchModal } = await import('../src/pages/DispatchPage');
const { TraceabilityPage, LedgerPage, ProductsPage } = await import('../src/pages/ReportPages');
const { HardnessRegister, HardnessForm, HardnessSheet, sheetHtml } = await import('../src/pages/HardnessPage');
const { TraceDrawer } = await import('../src/components/TraceDrawer');
const { DieMasterPage, DieRegisterPage, DieDetailsPage } = await import('../src/dies/pages');
const { MainDieForm, DieForm, ReplaceForm, DieView } = await import('../src/dies/components');
const { printRouteCard } = await import('../src/components/routeCard');
const { printDieCard, exportDies, exportMainDies } = await import('../src/dies/print');

const state = buildSample();
const dieData = buildDieSeed();

// Load the fixtures into the app's storage keys, so every provider starts from this data (the app itself starts empty).
const store = new Map<string, string>();
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
for (const [k, v] of Object.entries(state)) store.set('forgeflow.v1.' + k, JSON.stringify(v));
store.set('forgeflow.v1.meta', JSON.stringify({ version: 6 }));
for (const [k, v] of Object.entries(dieData)) store.set('forgeflow.dies.v1.' + k, JSON.stringify(v));
store.set('forgeflow.dies.v1.meta', JSON.stringify({ version: 2 }));

// ---- everything that is confidential in the sample data ----
const secrets = new Set<string>();
const add = (v?: string) => v && v.trim() && secrets.add(v.trim());
state.jobs.forEach((j) => add(j.customer));
state.products.forEach((p) => add(p.defaultCustomer));
state.rawMaterials.forEach((l) => (add(l.supplier), add(l.invoiceNo)));
state.dispatches.forEach((d) => (add(d.customer), add(d.invoiceNo)));
state.hardnessReports.forEach((r) => add(r.supplier));
dieData.mainDies.forEach((m) => add(m.customer));
[...dieData.forgingDies, ...dieData.trimmingDies].forEach((d) => add(d.maker));
assert.ok(secrets.size > 15, 'sample data should contain plenty of confidential values');
const esc = (t: string) => t.replace(/&/g, '&amp;');
const RATE_RE = /₹\s?\d/; // any rupee amount (rates, values, die cost)
const COST_NUMBERS = [...dieData.forgingDies, ...dieData.trimmingDies].map((d) => d.cost).filter((c): c is number => !!c);

const jobWithDispatch = state.jobs.find((j) => state.dispatches.some((d) => d.jobNo === j.jobNo))!.jobNo;
const dispatch = state.dispatches[0];
const report = state.hardnessReports[0];

function wrap(role: R, node: ReactNode, trace?: string) {
  return renderToString(
    <RoleProvider initialRole={role}>
      <StoreProvider initialTrace={trace}>
        <DieProvider>{node}</DieProvider>
      </StoreProvider>
    </RoleProvider>,
  );
}
const nav = () => {};
const close = () => {};

const SCREENS: Record<string, (role: R) => string> = {
  Dashboard: (r) => wrap(r, <Dashboard navigate={nav} />),
  'Raw Inventory': (r) => wrap(r, <RawInventoryPage />),
  'Inward form': (r) => wrap(r, <InwardModal onClose={close} />),
  Cutting: (r) => wrap(r, <StagePage stage="cutting" />),
  Forging: (r) => wrap(r, <StagePage stage="forging" />),
  'Heat Treatment': (r) => wrap(r, <StagePage stage="heatTreatment" />),
  QC: (r) => wrap(r, <QCPage />),
  'Hardness register': (r) => wrap(r, <HardnessRegister />),
  'Hardness form (edit)': (r) => wrap(r, <HardnessForm id={report.id} onClose={close} />),
  'Hardness sheet': (r) => wrap(r, <HardnessSheet id={report.id} onClose={close} />),
  'Finished Goods': (r) => wrap(r, <FinishedGoodsPage navigate={nav} />),
  Dispatch: (r) => wrap(r, <DispatchPage query={new URLSearchParams()} />),
  'Dispatch form': (r) => wrap(r, <NewDispatchModal fgId={state.finishedGoods[0].id} onClose={close} />),
  Traceability: (r) => wrap(r, <TraceabilityPage />),
  'Trace drawer': (r) => wrap(r, <TraceDrawer />, jobWithDispatch),
  Ledger: (r) => wrap(r, <LedgerPage />),
  'Product master': (r) => wrap(r, <ProductsPage />),
  'Die master': (r) => wrap(r, <DieMasterPage />),
  'Forging die master': (r) => wrap(r, <DieRegisterPage kind="forging" />),
  'Trimming die master': (r) => wrap(r, <DieRegisterPage kind="trimming" />),
  'Die details': (r) => wrap(r, <DieDetailsPage query={new URLSearchParams('id=DIE-0001')} />),
  'Die details · history': (r) => wrap(r, <DieDetailsPage query={new URLSearchParams('id=DIE-0003&tab=history')} />),
  'Main die form (edit)': (r) => wrap(r, <MainDieForm code="DIE-0001" onClose={close} />),
  'Die form (edit)': (r) => wrap(r, <DieForm kind="forging" code="FGD-0002" onClose={close} />),
  'Replace die form': (r) => wrap(r, <ReplaceForm kind="forging" code="FGD-0002" onClose={close} />),
  'Die view': (r) => wrap(r, <DieView kind="forging" code="FGD-0002" onClose={close} />),
};

async function printsAndExports(role: R): Promise<Record<string, string>> {
  wrap(role, <></>); // sets the active role for non-React code
  const out: Record<string, string> = {};
  const grab = (name: string, fn: () => void) => {
    printed.length = 0;
    blobs.length = 0;
    fn();
    return (out[name] = printed.join('\n'));
  };
  grab('Print: route card', () => state.jobs.forEach((j) => printRouteCard(state, j.jobNo)));
  grab('Print: hardness report', () => void printed.push(sheetHtml(report)));
  grab('Print: die card (all)', () => dieData.mainDies.forEach((m) => printDieCard(m, dieData)));
  grab('Print: die card (single)', () => printDieCard(dieData.mainDies[0], dieData, dieData.forgingDies[0]));
  printed.length = 0;
  blobs.length = 0;
  exportMainDies(dieData.mainDies, dieData);
  exportDies('forging', dieData.forgingDies, dieData);
  exportDies('trimming', dieData.trimmingDies, dieData);
  out['Excel: die master + die registers'] = (await Promise.all(blobs.map((b) => b.text()))).join('\n');
  return out;
}

const leaks = (html: string) => {
  const found: string[] = [];
  for (const s of secrets) if (html.includes(s) || html.includes(esc(s))) found.push(s);
  if (RATE_RE.test(html)) found.push('₹ amount');
  for (const c of COST_NUMBERS) if (html.includes(String(c)) || html.includes(c.toLocaleString('en-IN'))) found.push(`cost ${c}`);
  return found;
};

// ---- run ----
const summary: Record<string, Record<string, string>> = {};
let failures = 0;

for (const role of ROLES.map((r) => r.value) as R[]) {
  const priv = canSeeConfidential(role);
  const all: Record<string, string> = {};
  for (const [name, fn] of Object.entries(SCREENS)) all[`Screen: ${name}`] = fn(role);
  Object.assign(all, await printsAndExports(role));

  let totalLeaks = 0;
  let screensWithData = 0;
  for (const [name, html] of Object.entries(all)) {
    const l = leaks(html);
    if (l.length) screensWithData++;
    if (!priv && l.length) {
      failures++;
      console.error(`  ✗ ${role}: "${name}" leaks → ${l.slice(0, 4).join(' | ')}`);
    }
    totalLeaks += l.length;
  }
  const masked = Object.values(all).filter((h) => h.includes(MASK)).length;
  // feeds visible to everybody must never carry party names, whatever the role
  const feeds = wrap(role, <Dashboard navigate={nav} />) + wrap(role, <LedgerPage />) + wrap(role, <DieDetailsPage query={new URLSearchParams('id=DIE-0001&tab=history')} />);
  for (const s of secrets) if (feeds.includes(s) && !priv) { failures++; console.error(`  ✗ ${role}: feed shows ${s}`); }
  assert.ok(!/Made by /.test(feeds), 'die history must not name the maker');
  if (priv) {
    if (screensWithData < 8) { failures++; console.error(`  ✗ ${role}: authorised role sees confidential data on only ${screensWithData} outputs (expected ≥ 8)`); }
  } else if (masked < 8) {
    failures++;
    console.error(`  ✗ ${role}: only ${masked} outputs show the mask (expected ≥ 8)`);
  }
  summary[role] = {
    'sees confidential': priv ? 'yes' : 'NO (masked)',
    'management dashboards': canSeeManagement(role) ? 'yes' : 'no',
    'outputs checked': String(Object.keys(all).length),
    'outputs showing real data': String(screensWithData),
    'outputs showing mask': String(masked),
    result: priv ? (screensWithData >= 8 ? 'PASS (full access)' : 'FAIL') : totalLeaks === 0 ? 'PASS (nothing leaked)' : 'FAIL',
  };
}

// ---- helpers behave per role ----
wrap('operator', <></>);
assert.equal(searchable('Sigma Valves'), '', 'masked role must not be able to search hidden names');
wrap('accounts', <></>);
assert.equal(searchable('Sigma Valves'), 'Sigma Valves');
wrap('viewer', <></>);

console.table(summary);
if (failures) {
  console.error(`\n${failures} access-control failure(s)`);
  process.exit(1);
}
console.log('\nAll role-permission checks passed.');
