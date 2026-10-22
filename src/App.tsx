import { ROUTE_RESOURCE, RoleProvider, useAccess } from './auth/access';
import { actionPage, useStore } from './store/StoreContext';
import { dieUiResource, useDies } from './dies/DieContext';
import { formParent } from './store/forms';
import { SALES_PAGES, SalesDashboard, SalesListPage } from './pages/SalesPages';
import { dbConfigured } from './db/client';
import { LoginPage } from './auth/LoginPage';
import { AccessPage } from './pages/AccessPage';
import { UnitsPage } from './pages/UnitsPage';
import { JobWorkPage } from './pages/JobWorkPage';
import { NoAccess } from './pages/NoAccess';
import { Empty, go } from './components/ui';
import { useCallback, useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { Toasts } from './components/Toasts';
import { TraceDrawer } from './components/TraceDrawer';
import { ActionHost } from './components/ActionHost';
import { Dashboard } from './pages/Dashboard';
import { RawInventoryPage } from './pages/RawInventoryPage';
import { StagePage } from './pages/StagePage';
import { QCPage } from './pages/QCPage';
import { FinishedGoodsPage } from './pages/FinishedGoodsPage';
import { DispatchPage } from './pages/DispatchPage';
import { LedgerPage, ProductsPage, TraceabilityPage } from './pages/ReportPages';
import { StoreProvider } from './store/StoreContext';
import { DieProvider } from './dies/DieContext';
import { DieHost } from './dies/DieHost';
import { DieDetailsPage, DieMasterPage, DieRegisterPage } from './dies/pages';
import { SupplierMasterPage } from './purchase/pages/SupplierMasterPage';
import { PurchaseOrderRouter } from './purchase/pages/PurchaseOrderListPage';
import { PurchaseDashboardPage } from './purchase/pages/PurchaseDashboardPage';
import { PurchaseRequisitionPage } from './purchase/pages/PurchaseRequisitionPage';
import { RFQPage } from './purchase/pages/RFQPage';
import { SupplierQuotationPage } from './purchase/pages/SupplierQuotationPage';
import { QuotationComparisonPage } from './purchase/pages/QuotationComparisonPage';
import { SupplierPerformancePage } from './purchase/pages/SupplierPerformancePage';
import { PurchaseReportsPage } from './purchase/pages/PurchaseReportsPage';
import './dies/dies.css';

/** Minimal hash router: #/route?query — survives refresh, no server config needed. */
function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const h = () => setHash(read());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const navigate = useCallback((r: string) => {
    window.location.hash = `/${r}`;
    window.scrollTo({ top: 0 });
  }, []);
  const [route, qs = ''] = hash.split('?');
  return { route, query: new URLSearchParams(qs), hash, navigate };
}

/** A shop-floor form as a page (#/form/…): refused for roles without Write access, even by typing the address. */
function FormRoute() {
  const { action } = useStore();
  const { canWrite } = useAccess();
  if (!action || action.kind === 'hardnessView') return <NotAForm />;
  const res = actionPage(action);
  if (res && !canWrite(res.key)) return <NoAccess />;
  return <ActionHost page />;
}

/** A die form as a page (#/dieform/…). */
function DieFormRoute() {
  const { ui } = useDies();
  const { canWrite } = useAccess();
  if (!ui || ui.kind === 'die-view') return <NotAForm />;
  if (!canWrite(dieUiResource(ui).key)) return <NoAccess />;
  return <DieHost page />;
}

function NotAForm() {
  return (
    <div className="card">
      <Empty title="Nothing to show here" text="This form address is not complete." action={<button className="btn btn-primary" onClick={() => go('dashboard')}>Go to the dashboard</button>} />
    </div>
  );
}

function Page({ route, query, navigate }: { route: string; query: URLSearchParams; navigate: (r: string) => void }) {
  const { canRead, canManageAccess } = useAccess();
  // a page that is Hidden for this role cannot be opened, even by typing its address
  if (route.startsWith('form/')) return <FormRoute />;
  if (route.startsWith('dieform/')) return <DieFormRoute />;
  if (route === 'settings') return canManageAccess ? <AccessPage /> : <NoAccess />;
  if (route === 'units') return canManageAccess ? <UnitsPage /> : <NoAccess />;
  const resource = (route === 'quotation-comparison' ? 'supplier_quotations' : ROUTE_RESOURCE[route]) ?? 'dashboard';
  if (!canRead(resource)) return <NoAccess />;
  if (route === 'job-work') return <JobWorkPage />;
  if (route === 'sales-dashboard') return <SalesDashboard navigate={navigate} />;
  if (route === 'purchase-dashboard') return <PurchaseDashboardPage navigate={navigate} />;
  if (route === 'purchase-requisitions') return <PurchaseRequisitionPage query={query} navigate={navigate} />;
  if (route === 'rfqs') return <RFQPage query={query} navigate={navigate} />;
  if (route === 'supplier-quotations') return <SupplierQuotationPage query={query} navigate={navigate} />;
  if (route === 'quotation-comparison') return <QuotationComparisonPage query={query} navigate={navigate} />;
  if (route === 'supplier-performance') return <SupplierPerformancePage navigate={navigate} />;
  if (route === 'purchase-reports') return <PurchaseReportsPage query={query} navigate={navigate} />;
  if (route === 'purchase-orders') return <PurchaseOrderRouter query={query} navigate={navigate} />;
  if (route === 'suppliers') return <SupplierMasterPage />;
  if (SALES_PAGES.some((p) => p.route === route)) return <SalesListPage route={route} query={query} />;
  switch (route) {
    case 'raw-inventory':
      return <RawInventoryPage />;
    case 'cutting':
      return <StagePage stage="cutting" />;
    case 'forging':
      return <StagePage stage="forging" />;
    case 'trimming':
      return <StagePage stage="trimming" />;
    case 'heat-treatment':
      return <StagePage stage="heatTreatment" />;
    case 'qc':
      return <QCPage />;
    case 'finished-goods':
      return <FinishedGoodsPage navigate={navigate} />;
    case 'dispatch':
      return <DispatchPage />;
    case 'traceability':
      return <TraceabilityPage />;
    case 'ledger':
      return <LedgerPage />;
    case 'products':
      return <ProductsPage />;
    case 'die-master':
      return <DieMasterPage />;
    case 'forging-die-master':
      return <DieRegisterPage kind="forging" />;
    case 'trimming-die-master':
      return <DieRegisterPage kind="trimming" />;
    case 'die-details':
      return <DieDetailsPage query={query} />;
    default:
      return <Dashboard navigate={navigate} />;
  }
}

function Splash({ text }: { text: string }) {
  return (
    <div className="login-page">
      <div className="login-card" style={{ gridTemplateColumns: '1fr', maxWidth: 420, padding: 34, textAlign: 'center' }}>
        <h2 style={{ margin: 0 }}>{text}</h2>
      </div>
    </div>
  );
}

function SetupNeeded() {
  return (
    <div className="login-page">
      <div className="login-card" style={{ gridTemplateColumns: '1fr', maxWidth: 520, padding: 34 }}>
        <h2 style={{ margin: '0 0 8px' }}>Database not connected</h2>
        <p className="muted" style={{ margin: 0 }}>
          Add your Supabase project URL and anon key as <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b>: in the <b>.env</b> file (then restart <b>npm run dev</b>), or on a host such as Vercel under <b>Settings → Environment Variables</b> (then redeploy).
        </p>
      </div>
    </div>
  );
}

/** Nothing of the ERP is mounted until someone has signed in; a role switch or logout remounts it, so no screen keeps data from the previous user. */
function Shell() {
  const { route, query, hash, navigate } = useHashRoute();
  const { user, loading } = useAccess();
  if (!dbConfigured) return <SetupNeeded />;
  if (loading) return <Splash text="Checking your session…" />;
  if (!user) return <LoginPage />;
  return (
    <StoreProvider key={user.email}>
      <DieProvider>
        <Layout route={formParent(route, query) ?? route}>
          {/* key on full hash so pages reset their local filters/modals on navigation, and replay the arrival */}
          <div className="page-in" key={hash}>
            <Page route={route} query={query} navigate={navigate} />
          </div>
        </Layout>
        <TraceDrawer />
        <ActionHost />
        <DieHost />
        <Toasts />
      </DieProvider>
    </StoreProvider>
  );
}

export default function App() {
  return (
    <RoleProvider>
      <Shell />
    </RoleProvider>
  );
}
