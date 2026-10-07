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
    default:
      return <Dashboard navigate={navigate} />;
  }
}

export default function App() {
  const { route, query, hash, navigate } = useHashRoute();
  return (
    <StoreProvider>
      <Layout route={route}>
        {/* key on full hash so pages reset their local filters/modals on navigation */}
        <Page key={hash} route={route} query={query} navigate={navigate} />
      </Layout>
      <TraceDrawer />
      <ActionHost />
      <Toasts />
    </StoreProvider>
  );
}
