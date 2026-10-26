import { useMemo } from 'react';
import { AlertTriangle, BellRing, CheckCircle, Clock, FileText, Percent, RefreshCw, ThumbsDown, ThumbsUp, TrendingUp, Wallet, XCircle } from 'lucide-react';
import { useAccess } from '../auth/access';
import { Empty, Kpi, PageHeader } from '../components/ui';
import { fmtDate, fmtNum } from '../components/format';
import { dashboardStats, sum } from './analytics';
import { inr, pct } from './calc';
import { useOrders, useQuotations } from './hooks';
import { useFollowups } from '../followups/useFollowups';
import type { QuotationRow } from './types';

const short = (v: number) => (v >= 1e7 ? `₹ ${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹ ${(v / 1e5).toFixed(2)} L` : inr(v, 0));

function Bars({ items, money = true }: { items: { label: string; value: number; tone?: string; hint?: string }[]; money?: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map((i) => (
        <div key={i.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span className="strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{i.label}</span>
            <span className="mono">{money ? short(i.value) : fmtNum(i.value)}{i.hint ? <span className="muted"> · {i.hint}</span> : null}</span>
          </div>
          <div style={{ background: 'var(--border)', borderRadius: 6, height: 8, marginTop: 4 }}>
            <div style={{ width: `${(i.value / max) * 100}%`, height: 8, borderRadius: 6, background: i.tone ?? 'var(--primary, #259392)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListWidget({ rows, empty, right, onOpen, showCustomer }: { rows: QuotationRow[]; empty: string; right: (r: QuotationRow) => React.ReactNode; onOpen: (r: QuotationRow) => void; showCustomer: boolean }) {
  if (rows.length === 0) return <Empty title={empty} />;
  return (
    <ul className="feed">
      {rows.slice(0, 6).map((r) => (
        <li key={r.id}>
          <div style={{ flex: 1 }}>
            <div className="tx"><button className="btn-link mono" onClick={() => onOpen(r)}>{r.docNo}</button>{showCustomer && r.customer ? ` · ${r.customer}` : ''}</div>
            <div className="tm">{right(r)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SalesDashboardPage({ navigate }: { navigate: (r: string) => void }) {
  const { quotations, loading, error, reload } = useQuotations();
  const { orders } = useOrders();
  const { can, canRead } = useAccess();
  const { due: followDue, loading: followLoading } = useFollowups();
  const st = useMemo(() => dashboardStats(quotations), [quotations]);
  const money = can('sales_rates');
  const margins = can('margins');
  const cust = can('party_names');
  const min = quotations[0]?.minMargin ?? 15;
  const open = (r: QuotationRow) => navigate(canRead('quotation_approvals') && r.status === 'Pending Approval' ? `quotation-approvals?id=${r.id}` : `sales-quotation?id=${r.id}`);

  const topCustomers = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of st.pipeline) if (r.customer) m.set(r.customer, (m.get(r.customer) ?? 0) + (r.amount ?? 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }));
  }, [st.pipeline]);

  const marginBuckets = useMemo(() => {
    const rows = st.pipeline.filter((r) => r.marginPct != null);
    const b = [
      { label: `Below ${min}% (flagged)`, test: (m: number) => m < min, tone: '#dc2626' },
      { label: `${min}% – ${min + 10}%`, test: (m: number) => m >= min && m < min + 10, tone: '#d97706' },
      { label: `${min + 10}% – ${min + 20}%`, test: (m: number) => m >= min + 10 && m < min + 20, tone: '#259392' },
      { label: `${min + 20}% and above`, test: (m: number) => m >= min + 20, tone: '#16a34a' },
    ];
    return b.map((x) => ({ label: x.label, tone: x.tone, value: rows.filter((r) => x.test(r.marginPct!)).length }));
  }, [st.pipeline, min]);

  const wonValue = sum(st.won.map((r) => r.amount));
  const lostValue = sum(st.lost.map((r) => r.amount));
  const orderOpen = orders.filter((o) => ['Draft', 'Confirmed'].includes(o.status)).length;
  const orderProd = orders.filter((o) => o.status === 'In Production').length;
  const orderDone = orders.filter((o) => o.status === 'Delivered').length;

  return (
    <>
      <PageHeader eyebrow="Sales & Orders" title="Sales Dashboard" actions={<button className="btn btn-subtle" onClick={() => reload()} disabled={loading}><RefreshCw size={14} /> Refresh</button>} />
      {error && <div className="card" style={{ marginBottom: 16 }}><div className="card-center-msg text-red">{error}</div></div>}

      <div className="kpis">
        <Kpi label="Pending Approval" value={loading ? 0 : st.pendingApproval.length} icon={Clock} tone="amber" hint="waiting for the Director" onClick={() => navigate('quotation-approvals')} />
        <Kpi label="Approved" value={loading ? 0 : st.approved.length} icon={CheckCircle} tone="green" hint="given a quotation number" />
        <Kpi label="Rejected" value={loading ? 0 : st.rejected.length} icon={XCircle} tone="red" />
        <Kpi label="Pending Customer Response" value={loading ? 0 : st.pendingResponse.length} icon={FileText} tone="violet" hint="sent, no answer yet" />
        <Kpi label="Won" value={loading ? 0 : st.won.length} icon={ThumbsUp} tone="green" hint={money ? short(wonValue) : undefined} />
        <Kpi label="Lost" value={loading ? 0 : st.lost.length} icon={ThumbsDown} tone="red" hint={money ? short(lostValue) : undefined} />
        {money && <Kpi label="Expected Sales Value" value={short(st.expected)} icon={TrendingUp} tone="green" hint="open quotations waiting for the customer" />}
        <Kpi label="Follow-ups Due" value={followLoading ? 0 : followDue.length} icon={BellRing} tone={followDue.length ? 'amber' : 'teal'} hint="tomorrow, today or overdue" onClick={() => navigate('follow-ups')} />
        {money && <Kpi label="Total Quotation Value" value={short(st.totalValue)} icon={Wallet} tone="blue" hint="awaiting approval or approved" />}
        {margins && <Kpi label="Average Margin" value={pct(st.avgMargin == null ? null : Math.round(st.avgMargin * 10) / 10)} icon={TrendingUp} tone={st.avgMargin != null && st.avgMargin < min ? 'red' : 'teal'} hint={`minimum ${min}%`} />}
        <Kpi label="Quotation → Order" value={pct(st.conversion == null ? null : Math.round(st.conversion * 10) / 10)} icon={Percent} tone="teal" hint={`${st.won.length} won of ${st.submitted.length} submitted`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 20 }}>
        <div className="card">
          <div className="card-head"><h3>Pending Approval</h3><div className="right text-xs muted">{st.pendingApproval.length} waiting</div></div>
          <ListWidget rows={st.pendingApproval} empty="Nothing is waiting for approval" showCustomer={cust} onOpen={open}
            right={(r) => `${money ? inr(r.amount, 0) + ' · ' : ''}${margins && r.marginPct != null ? 'margin ' + pct(r.marginPct) + (r.belowMin ? ' ⚠ below minimum' : '') + ' · ' : ''}by ${r.salesperson || '—'}`} />
        </div>

        <div className="card">
          <div className="card-head"><h3>Pending Customer Response</h3><div className="right text-xs muted">{st.pendingResponse.length} sent</div></div>
          <ListWidget rows={[...st.pendingResponse].sort((a, b) => (b.daysPending ?? 0) - (a.daysPending ?? 0))} empty="No quotation is waiting for the customer" showCustomer={cust} onOpen={open}
            right={(r) => `${r.daysPending ?? 0} day(s) since sent${r.nextFollowup ? ' · next follow-up ' + fmtDate(r.nextFollowup) : ''}`} />
        </div>

        <div className="card">
          <div className="card-head"><h3>Won vs Lost</h3></div>
          <div style={{ padding: 16 }}>
            {st.won.length + st.lost.length === 0 ? <Empty title="No customer responses yet" /> : (
              <Bars money={false} items={[
                { label: 'Won', value: st.won.length, tone: '#16a34a', hint: money ? short(wonValue) : undefined },
                { label: 'Lost', value: st.lost.length, tone: '#dc2626', hint: money ? short(lostValue) : undefined },
              ]} />
            )}
          </div>
        </div>

        {margins && (
          <div className="card">
            <div className="card-head"><h3>Margin Analysis</h3><div className="right text-xs muted">quotations by gross margin</div></div>
            <div style={{ padding: 16 }}>
              {marginBuckets.every((b) => b.value === 0) ? <Empty title="No costed quotations yet" /> : <Bars money={false} items={marginBuckets} />}
            </div>
          </div>
        )}

        {money && cust && (
          <div className="card">
            <div className="card-head"><h3>Top Customers</h3><div className="right text-xs muted">by quotation value</div></div>
            <div style={{ padding: 16 }}>{topCustomers.length === 0 ? <Empty title="No quotations yet" /> : <Bars items={topCustomers} />}</div>
          </div>
        )}

        <div className="card">
          <div className="card-head"><h3>Expired Quotations</h3><div className="right text-xs muted">{st.expired.length}</div></div>
          <ListWidget rows={st.expired} empty="No quotation has expired" showCustomer={cust} onOpen={open}
            right={(r) => `expired ${fmtDate(r.validUntil ?? undefined)} · ${r.status}${money ? ' · ' + inr(r.amount, 0) : ''}`} />
        </div>

        <div className="card">
          <div className="card-head"><h3>Sales Orders</h3><button className="btn btn-sm btn-subtle" onClick={() => navigate('sales-order')}>Open</button></div>
          <div style={{ padding: 16 }}>
            <Bars money={false} items={[
              { label: 'Draft / Confirmed', value: orderOpen, tone: '#6366f1' },
              { label: 'In Production', value: orderProd, tone: '#259392' },
              { label: 'Delivered', value: orderDone, tone: '#16a34a' },
            ]} />
          </div>
        </div>
      </div>
      {st.pendingApproval.some((r) => r.belowMin) && margins && (
        <div className="callout warn" style={{ marginTop: 16 }}><AlertTriangle size={14} /> Some quotations waiting for approval are below the minimum margin of {min}%.</div>
      )}
    </>
  );
}
