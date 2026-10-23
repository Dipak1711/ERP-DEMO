import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccess } from '../auth/access';
import { fetchFollowups } from './service';
import { needsAttention, type FollowupItem, type FollowupKind } from './types';

/** which page a person must be able to open for each kind of follow-up */
const NEEDS: Record<FollowupKind, string[]> = {
  quotation: ['sales_quotation'],
  order: ['sales_orders'],
  task: ['task_assignment', 'inquiries'],
  po: ['procurement_po'],
  rfq: ['rfq'],
  payment: ['purchase_invoices'],
};

/** every follow-up the signed-in person may see; `due` = the ones due tomorrow, today or already late */
export function useFollowups() {
  const { canRead, user } = useAccess();
  const kinds = useMemo(
    () => (Object.keys(NEEDS) as FollowupKind[]).filter((k) => NEEDS[k].some((r) => canRead(r))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user],
  );
  const kindKey = kinds.join(',');
  const [items, setItems] = useState<FollowupItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchFollowups(kinds));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const due = useMemo(() => items.filter(needsAttention).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '')), [items]);
  return { items, due, kinds, loading, reload };
}
