import { useCallback, useEffect, useState } from 'react';
import { fetchSuppliers } from '../services/supplierService';
import { fetchPORegister, fetchPOUrgent } from '../services/poService';
import type { PurchaseOrder, Supplier } from '../types';

export function useSuppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchSuppliers();
      setSuppliers(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { suppliers, loading, error, reload };
}

export function usePurchaseOrders() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchPORegister();
      setOrders(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { orders, loading, error, reload };
}

export function usePurchaseDashboard() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [urgent, setUrgent] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const [allData, urgentData] = await Promise.all([
        fetchPORegister(),
        fetchPOUrgent().catch(() => []),
      ]);
      setOrders(allData);
      setUrgent(urgentData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const kpis = {
    pendingApprovals: orders.filter((o) => o.status === 'Approval Pending').length,
    approvedNotReleased: orders.filter((o) => o.status === 'Approved').length,
    openOrders: orders.filter((o) =>
      ['Released', 'Sent to Supplier', 'Partially Received'].includes(o.status)
    ).length,
    overdue: orders.filter((o) => o.isOverdue).length,
    urgentCount: urgent.length,
  };

  return { orders, urgent, kpis, loading, error, reload };
}
