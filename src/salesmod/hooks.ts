import { useCallback, useEffect, useState } from 'react';
import { fetchOrder, fetchOrders, fetchQuotation, fetchQuotations } from './service';

/** loads something, keeps loading / error state, and can load again */
function useLoad<T>(load: () => Promise<T>, deps: unknown[], initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setData(await load());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, loading, error, reload };
}

export const useQuotations = () => {
  const r = useLoad(fetchQuotations, [], [] as Awaited<ReturnType<typeof fetchQuotations>>);
  return { quotations: r.data, loading: r.loading, error: r.error, reload: r.reload };
};
export const useQuotationDetail = (id: number) => {
  const r = useLoad(() => fetchQuotation(id), [id], null as Awaited<ReturnType<typeof fetchQuotation>> | null);
  return { detail: r.data, loading: r.loading, error: r.error, reload: r.reload };
};
export const useOrders = () => {
  const r = useLoad(fetchOrders, [], [] as Awaited<ReturnType<typeof fetchOrders>>);
  return { orders: r.data, loading: r.loading, error: r.error, reload: r.reload };
};
export const useOrderDetail = (id: number) => {
  const r = useLoad(() => fetchOrder(id), [id], null as Awaited<ReturnType<typeof fetchOrder>> | null);
  return { detail: r.data, loading: r.loading, error: r.error, reload: r.reload };
};
