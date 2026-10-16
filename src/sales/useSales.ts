import { useCallback, useEffect, useState } from 'react';
import { dbMessage, supabase } from '../db/client';
import type { SalesKind, SalesRecord } from './config';

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null || v === '' ? null : Number(v));

function toRecord(r: Row): SalesRecord {
  return {
    id: Number(r.id),
    kind: r.kind as SalesKind,
    docNo: s(r.doc_no),
    docDate: s(r.doc_date),
    party: s(r.party),
    contact: s(r.contact),
    phone: s(r.phone),
    email: s(r.email),
    source: s(r.source),
    title: s(r.title),
    product: s(r.product),
    qty: n(r.qty),
    rate: n(r.rate),
    amount: n(r.amount),
    refNo: s(r.ref_no),
    extRef: s(r.ext_ref),
    dueDate: r.due_date ? s(r.due_date) : null,
    priority: s(r.priority),
    status: s(r.status),
    assignee: s(r.assignee),
    remarks: s(r.remarks),
    createdAt: s(r.created_at),
  };
}

/** Sales & Orders records, newest first, read through the masking view (party names / rates are blank for roles that may not see them). */
export function useSalesRecords() {
  const [rows, setRows] = useState<SalesRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: e } = await supabase.from('v_sales_records').select('*').order('created_at', { ascending: false }).order('id', { ascending: false });
    if (e) {
      setError(/v_sales_records|schema cache|does not exist/i.test(e.message) ? 'Sales records are not set up in the database yet. Run migration 21 in the Supabase SQL editor.' : dbMessage(e));
      setRows([]);
    } else {
      setError(null);
      setRows((data as Row[]).map(toRecord));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, loading, error, reload };
}
