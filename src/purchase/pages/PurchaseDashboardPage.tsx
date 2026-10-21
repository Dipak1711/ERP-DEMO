import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  Eye,
  FileCheck,
  Plus,
  Printer,
  RefreshCw,
  ShoppingBag,
  XCircle,
} from 'lucide-react';
import { Conf, Write, useAccess } from '../../auth/access';
import { Badge, Kpi, PageHeader, Priority } from '../../components/ui';
import { fmtDate, fmtNum } from '../../components/format';
import { useStore } from '../../store/StoreContext';
import { usePurchaseDashboard } from '../hooks/usePurchase';
import { decidePO, fetchPODetail } from '../services/poService';
import { printPurchaseOrder } from '../print';

const inr = (v: number) => `₹ ${v.toLocaleString('en-IN')}`;

export function PurchaseDashboardPage({ navigate }: { navigate: (r: string) => void }) {
  const { orders, urgent, kpis, loading, reload } = usePurchaseDashboard();
  const { user, canWrite } = useAccess();
  const { toast } = useStore();
  const [acting, setActing] = useState(false);

  const pendingApprovals = orders.filter((o) => o.status === 'Approval Pending');
  const canApprove = canWrite('purchase_approvals');

  const quickDecide = async (id: number, approve: boolean, poNo: string) => {
    try {
      setActing(true);
      const userName = user?.name || user?.email || 'Plant Head';
      await decidePO(id, approve, approve ? 'Approved via Dashboard' : 'Rejected via Dashboard', userName);
      toast({
        kind: approve ? 'success' : 'info',
        title: approve ? 'PO Approved' : 'PO Returned to Draft',
        message: `${poNo} has been processed.`,
      });
      void reload();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Action failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setActing(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Plant Head Overview"
        title="Purchase & Procurement Dashboard"
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => reload()} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <Write res="procurement_po">
              <button className="btn btn-primary" onClick={() => navigate('purchase-orders?new=1')}>
                <Plus size={15} /> New Purchase Order
              </button>
            </Write>
          </>
        }
      />

      {/* KPI Cards */}
      <div className="kpis k4">
        <Kpi
          label="Pending Approvals"
          value={kpis.pendingApprovals}
          unit="orders"
          hint={kpis.pendingApprovals > 0 ? 'Requires management review' : 'All caught up'}
          icon={Clock}
          tone={kpis.pendingApprovals > 0 ? 'amber' : 'blue'}
        />
        <Kpi
          label="Approved (Not Released)"
          value={kpis.approvedNotReleased}
          unit="orders"
          hint="Ready for release to vendor"
          icon={FileCheck}
          tone="blue"
        />
        <Kpi
          label="Active Open Orders"
          value={kpis.openOrders}
          unit="orders"
          hint="In process / awaiting delivery"
          icon={ShoppingBag}
          tone="teal"
          onClick={() => navigate('purchase-orders')}
        />
        <Kpi
          label="Overdue Orders"
          value={kpis.overdue}
          unit="orders"
          hint={kpis.overdue > 0 ? 'Passed promised delivery date' : 'No overdue orders'}
          icon={AlertCircle}
          tone={kpis.overdue > 0 ? 'red' : 'blue'}
        />
      </div>

      {/* Urgent / Critical Open POs Panel */}
      <div className="card" style={{ marginBottom: 20, borderLeft: urgent.length > 0 ? '4px solid #ef4444' : undefined }}>
        <div className="card-head">
          <div className="card-title-group">
            <AlertTriangle size={18} className={urgent.length > 0 ? 'text-red' : 'muted'} />
            <h3 style={{ margin: 0 }}>Urgent &amp; Critical Open Orders</h3>
            {urgent.length > 0 && <span className="badge b-red">{urgent.length} Requires Attention</span>}
          </div>
          <div className="right">
            <button className="btn btn-sm btn-subtle" onClick={() => navigate('purchase-orders')}>
              View All POs
            </button>
          </div>
        </div>

        <div className="card-body" style={{ padding: urgent.length === 0 ? '0 22px 14px' : '0 22px 20px' }}>
          {urgent.length === 0 ? (
            <div className="card-center-msg">
              No critical or urgent purchase orders are currently open.
            </div>
          ) : (
            <div className="table-wrap" style={{ borderRadius: 8, border: '1px solid var(--border)' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>PO Number</th>
                    <th style={{ width: 90 }}>Priority</th>
                    <Conf g="party_names">
                      <th>Supplier</th>
                    </Conf>
                    <th style={{ width: 110 }}>Delivery Date</th>
                    <th style={{ width: 95 }} className="r">Ordered</th>
                    <th style={{ width: 95 }} className="r">Pending</th>
                    <Conf g="purchase_rates">
                      <th style={{ width: 120 }} className="r">Total Value</th>
                    </Conf>
                    <th style={{ width: 130 }} className="center">Status</th>
                    <th className="act">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {urgent.map((o) => (
                    <tr key={o.id}>
                      <td className="mono strong">{o.poNo}</td>
                      <td>
                        <Priority p={o.urgency} />
                      </td>
                      <Conf g="party_names">
                        <td className="strong">{o.supplierName || '—'}</td>
                      </Conf>
                      <td className="nowrap">
                        {o.deliveryDate ? fmtDate(o.deliveryDate) : '—'}
                        {o.isOverdue && <span className="badge b-red text-xs ml-1">Overdue</span>}
                      </td>
                      <td className="r num">{fmtNum(o.orderedQty || 0)}</td>
                      <td className="r num text-amber font-medium">{fmtNum(o.pendingQty || 0)}</td>
                      <Conf g="purchase_rates">
                        <td className="r num strong">{inr(o.totalAmount)}</td>
                      </Conf>
                      <td className="center">
                        <Badge status={o.status} />
                      </td>
                      <td className="act nowrap">
                        <div className="icon-actions">
                          <button
                            className="icon-btn"
                            title="View PO Details"
                            aria-label={`View PO ${o.poNo}`}
                            onClick={() => navigate(`purchase-orders?id=${o.id}`)}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            title="Print Purchase Order"
                            aria-label={`Print PO ${o.poNo}`}
                            onClick={async () => {
                              try {
                                const detail = await fetchPODetail(o.id);
                                printPurchaseOrder(detail);
                              } catch (e) {
                                toast({ kind: 'error', title: 'Could not load PO for print', message: String(e) });
                              }
                            }}
                          >
                            <Printer size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Pending Approvals Review Section */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <div className="card-title-group">
            <Clock size={18} className={pendingApprovals.length > 0 ? 'text-amber' : 'muted'} />
            <h3 style={{ margin: 0 }}>Pending Approval Action Required</h3>
            <span className="chip">{pendingApprovals.length} pending</span>
          </div>
        </div>

        <div className="card-body" style={{ padding: pendingApprovals.length === 0 ? '0 22px 14px' : '0 22px 20px' }}>
          {pendingApprovals.length === 0 ? (
            <div className="card-center-msg">
              All purchase orders are up to date. No pending approvals waiting for review.
            </div>
          ) : (
            <div className="table-wrap" style={{ borderRadius: 8, border: '1px solid var(--border)' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>PO Number</th>
                    <th style={{ width: 95 }}>PO Date</th>
                    <Conf g="party_names">
                      <th>Supplier</th>
                    </Conf>
                    <th style={{ width: 90 }}>Priority</th>
                    <Conf g="purchase_rates">
                      <th style={{ width: 120 }} className="r">Amount</th>
                    </Conf>
                    <th>Created By</th>
                    <th className="act">Review / Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingApprovals.map((po) => (
                    <tr key={po.id}>
                      <td className="mono strong">
                        {po.poNo}
                        {po.revNo > 0 && <span className="chip text-xs ml-1">R{po.revNo}</span>}
                      </td>
                      <td className="nowrap">{fmtDate(po.poDate)}</td>
                      <Conf g="party_names">
                        <td className="strong">{po.supplierName || '—'}</td>
                      </Conf>
                      <td>
                        <Priority p={po.urgency} />
                      </td>
                      <Conf g="purchase_rates">
                        <td className="r num strong">{inr(po.totalAmount)}</td>
                      </Conf>
                      <td>{po.createdBy || 'Purchase Team'}</td>
                      <td className="act nowrap">
                        <div className="icon-actions">
                          <button
                            className="icon-btn"
                            title="Review Details"
                            aria-label={`Review PO ${po.poNo}`}
                            onClick={() => navigate(`purchase-orders?id=${po.id}`)}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            title="Print Purchase Order"
                            aria-label={`Print PO ${po.poNo}`}
                            onClick={async () => {
                              try {
                                const detail = await fetchPODetail(po.id);
                                printPurchaseOrder(detail);
                              } catch (e) {
                                toast({ kind: 'error', title: 'Could not load PO for print', message: String(e) });
                              }
                            }}
                          >
                            <Printer size={16} />
                          </button>
                          {canApprove && (
                            <>
                              <button
                                className="icon-btn text-good"
                                title="Approve PO"
                                aria-label={`Approve PO ${po.poNo}`}
                                onClick={() => quickDecide(po.id, true, po.poNo)}
                                disabled={acting}
                              >
                                <CheckCircle size={16} />
                              </button>
                              <button
                                className="icon-btn danger"
                                title="Reject to Draft"
                                aria-label={`Reject PO ${po.poNo}`}
                                onClick={() => quickDecide(po.id, false, po.poNo)}
                                disabled={acting}
                              >
                                <XCircle size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
