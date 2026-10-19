import { Lock } from 'lucide-react';
import { ROUTE_RESOURCE, useAccess } from '../auth/access';
import { Empty, go, PageHeader } from '../components/ui';

/** Order the menu lists pages in: where to send someone whose page is hidden */
const ORDER = ['dashboard', 'sales-dashboard', 'sales-quotation', 'leads', 'inquiry', 'purchase-order', 'sales-order', 'final-order', 'task-assignment', 'raw-inventory', 'cutting', 'job-work', 'forging', 'trimming', 'heat-treatment', 'qc', 'finished-goods', 'dispatch', 'die-master', 'forging-die-master', 'trimming-die-master', 'die-details', 'traceability', 'ledger', 'products'];

export function firstAllowedRoute(canRead: (resource: string) => boolean) {
  return ORDER.find((r) => canRead(ROUTE_RESOURCE[r]));
}

export function NoAccess() {
  const { canRead } = useAccess();
  const next = firstAllowedRoute(canRead);
  return (
    <>
      <PageHeader eyebrow="Access" title="No access" />
      <div className="card">
        <Empty
          icon={Lock}
          title="You do not have access to this page"
          text="The Director or Plant Head decides which pages each role can open. Ask them if you need it."
          action={next ? <button className="btn btn-primary" onClick={() => go(next)}>Go to an allowed page</button> : undefined}
        />
      </div>
    </>
  );
}
