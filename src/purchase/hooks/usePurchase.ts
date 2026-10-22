import { useCallback, useEffect, useState } from 'react';
import { fetchSuppliers } from '../services/supplierService';
import { fetchPORegister, fetchPOUrgent } from '../services/poService';
import { fetchPRs, fetchPRDetail } from '../services/prService';
import { fetchRFQs, fetchRFQDetail } from '../services/rfqService';
import { fetchQuotations, fetchQuotationDetail, fetchComparison } from '../services/quotationService';
import type {
  ComparisonMatrix,
  PRDetail,
  PurchaseOrder,
  PurchaseRequisition,
  RFQ,
  RFQDetail,
  SQDetail,
  Supplier,
  SupplierQuotation,
} from '../types';

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

export function usePurchaseRequisitions() {
  const [requisitions, setRequisitions] = useState<PurchaseRequisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchPRs();
      setRequisitions(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRequisitions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { requisitions, loading, error, reload };
}

export function usePRDetail(id: number | null) {
  const [pr, setPr] = useState<PRDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) {
      setPr(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await fetchPRDetail(id);
      setPr(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPr(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { pr, loading, error, reload };
}

export function useRFQs() {
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchRFQs();
      setRfqs(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRfqs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rfqs, loading, error, reload };
}

export function useRFQDetail(id: number | null) {
  const [rfq, setRfq] = useState<RFQDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) {
      setRfq(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await fetchRFQDetail(id);
      setRfq(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRfq(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rfq, loading, error, reload };
}

export function useQuotations() {
  const [quotations, setQuotations] = useState<SupplierQuotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchQuotations();
      setQuotations(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setQuotations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { quotations, loading, error, reload };
}

export function useQuotationDetail(id: number | null) {
  const [quotation, setQuotation] = useState<SQDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) {
      setQuotation(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await fetchQuotationDetail(id);
      setQuotation(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setQuotation(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { quotation, loading, error, reload };
}

export function useComparison(prId?: number, rfqId?: number) {
  const [matrix, setMatrix] = useState<ComparisonMatrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!prId && !rfqId) {
      setMatrix(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await fetchComparison(prId, rfqId);
      setMatrix(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMatrix(null);
    } finally {
      setLoading(false);
    }
  }, [prId, rfqId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { matrix, loading, error, reload };
}

export function usePurchaseDashboard() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [urgent, setUrgent] = useState<PurchaseOrder[]>([]);
  const [pendingPRCount, setPendingPRCount] = useState(0);
  const [openRFQCount, setOpenRFQCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const [allData, urgentData, prData, rfqData] = await Promise.all([
        fetchPORegister(),
        fetchPOUrgent().catch(() => []),
        fetchPRs().catch(() => []),
        fetchRFQs().catch(() => []),
      ]);
      setOrders(allData);
      setUrgent(urgentData);
      setPendingPRCount(prData.filter((p) => p.status === 'Approval Pending').length);
      setOpenRFQCount(rfqData.filter((r) => r.status === 'Open').length);
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
    pendingPRs: pendingPRCount,
    openRFQs: openRFQCount,
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

