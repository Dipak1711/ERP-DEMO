import { ROUTE_RESOURCE, RoleProvider, useAccess } from './auth/access';
import { dbConfigured } from './db/client';
import { LoginPage } from './auth/LoginPage';
import { AccessPage } from './pages/AccessPage';
import { NoAccess } from './pages/NoAccess';
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

function Page({ route, query, navigate }: { route: string; query: URLSearchParams; navigate: (r: string) => void }) {
  const { canRead, canManageAccess } = useAccess();
  // a page that is Hidden for this role cannot be opened, even by typing its address
  if (route === 'settings') return canManageAccess ? <AccessPage /> : <NoAccess />;
  const resource = ROUTE_RESOURCE[route] ?? 'dashboard';
  if (!canRead(resource)) return <NoAccess />;
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
      return <DispatchPage query={query} />;
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
          Put your Supabase project URL and anon key in the <b>.env</b> file (<b>VITE_SUPABASE_URL</b>, <b>VITE_SUPABASE_ANON_KEY</b>), then restart <b>npm run dev</b>.
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
        <Layout route={route}>
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
