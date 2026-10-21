import { Lock } from 'lucide-react';
import { APP_RESOURCES, ROUTE_RESOURCE, useAccess } from '../auth/access';
import { Empty, go, PageHeader } from '../components/ui';

export function firstAllowedRoute(canRead: (resource: string) => boolean) {
  return APP_RESOURCES.map((r) => r.route).find((r) => canRead(ROUTE_RESOURCE[r]));
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
