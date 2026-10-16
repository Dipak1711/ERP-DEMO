import { ClipboardCheck, FileText, Inbox, ListChecks, ReceiptText, ShoppingCart, UserPlus } from 'lucide-react';
import type { Icon } from '../components/ui';

export type SalesKind = 'lead' | 'inquiry' | 'quotation' | 'purchase_order' | 'sales_order' | 'final_order' | 'task';

/** One row of v_sales_records (party / rate columns are null when the role may not see them). */
export interface SalesRecord {
  id: number;
  kind: SalesKind;
  docNo: string;
  docDate: string;
  party: string;
  contact: string;
  phone: string;
  email: string;
  source: string;
  title: string;
  product: string;
  qty: number | null;
  rate: number | null;
  amount: number | null;
  refNo: string;
  extRef: string;
  dueDate: string | null;
  priority: string;
  status: string;
  assignee: string;
  remarks: string;
  createdAt: string;
}

export type FieldKey = 'docDate' | 'party' | 'contact' | 'phone' | 'email' | 'source' | 'title' | 'product' | 'qty' | 'rate' | 'refNo' | 'extRef' | 'dueDate' | 'priority' | 'assignee' | 'remarks';
/** columns the list can show — the form fields, plus the number, status and the computed amount */
export type ColKey = FieldKey | 'docNo' | 'status' | 'amount';

export interface FieldDef {
  key: FieldKey;
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface KindCfg {
  kind: SalesKind;
  route: string;
  resource: string;
  label: string;
  singular: string;
  icon: Icon;
  statuses: string[];
  /** statuses that count as "still open" on the dashboard */
  openStatuses: string[];
  /** has a printout (Lead and Task Assignment are internal, so they have none) */
  printable: boolean;
  fields: FieldDef[];
  cols: ColKey[];
}

export const LEAD_SOURCES = ['Website', 'Referral', 'Exhibition', 'Phone call', 'Email', 'Existing customer', 'Other'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const party = (label = 'Customer / Company'): FieldDef => ({ key: 'party', label, required: true, placeholder: 'e.g. Sigma Valves' });
const product = (required = false): FieldDef => ({ key: 'product', label: 'Product', required, placeholder: 'e.g. Brass Bush' });
const qty: FieldDef = { key: 'qty', label: 'Quantity', required: true };
const rate: FieldDef = { key: 'rate', label: 'Rate' };
const remarks: FieldDef = { key: 'remarks', label: 'Remarks' };

export const SALES_KINDS: KindCfg[] = [
  {
    kind: 'quotation',
    route: 'sales-quotation',
    resource: 'sales_quotation',
    label: 'Sales Quotation',
    singular: 'Quotation',
    icon: FileText,
    statuses: ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'],
    openStatuses: ['Draft', 'Sent'],
    printable: true,
    fields: [party(), { key: 'refNo', label: 'Inquiry no.', placeholder: 'e.g. INQ-2026-0001' }, product(true), qty, rate, { key: 'dueDate', label: 'Valid until' }, remarks],
    cols: ['docNo', 'docDate', 'party', 'product', 'qty', 'rate', 'amount', 'dueDate', 'status'],
  },
  {
    kind: 'lead',
    route: 'leads',
    resource: 'leads',
    label: 'Lead Management',
    singular: 'Lead',
    icon: UserPlus,
    statuses: ['New', 'Contacted', 'Qualified', 'Lost', 'Converted'],
    openStatuses: ['New', 'Contacted', 'Qualified'],
    printable: false,
    fields: [
      party('Company / Name'),
      { key: 'contact', label: 'Contact person' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
      { key: 'source', label: 'Source', options: LEAD_SOURCES },
      { key: 'product', label: 'Interested in', placeholder: 'e.g. Brass Bush' },
      remarks,
    ],
    cols: ['docNo', 'docDate', 'party', 'contact', 'phone', 'source', 'product', 'status'],
  },
  {
    kind: 'inquiry',
    route: 'inquiry',
    resource: 'inquiries',
    label: 'Inquiry',
    singular: 'Inquiry',
    icon: Inbox,
    statuses: ['Open', 'Quoted', 'Closed', 'Lost'],
    openStatuses: ['Open'],
    printable: true,
    fields: [party(), { key: 'contact', label: 'Contact person' }, { key: 'phone', label: 'Phone' }, { key: 'refNo', label: 'Lead no.', placeholder: 'e.g. LD-2026-0001' }, product(), { ...qty, required: false }, { key: 'dueDate', label: 'Required by' }, remarks],
    cols: ['docNo', 'docDate', 'party', 'product', 'qty', 'dueDate', 'refNo', 'status'],
  },
  {
    kind: 'purchase_order',
    route: 'purchase-order',
    resource: 'purchase_orders',
    label: 'Purchase Order',
    singular: 'Purchase Order',
    icon: ReceiptText,
    statuses: ['Received', 'Accepted', 'Cancelled'],
    openStatuses: ['Received'],
    printable: true,
    fields: [{ key: 'extRef', label: 'Customer PO no.', placeholder: 'The number on their order' }, party(), { key: 'refNo', label: 'Quotation no.', placeholder: 'e.g. QT-2026-0001' }, product(true), qty, rate, { key: 'dueDate', label: 'Delivery date' }, remarks],
    cols: ['docNo', 'extRef', 'docDate', 'party', 'product', 'qty', 'rate', 'amount', 'dueDate', 'status'],
  },
  {
    kind: 'sales_order',
    route: 'sales-order',
    resource: 'sales_orders',
    label: 'Sales Order',
    singular: 'Sales Order',
    icon: ShoppingCart,
    statuses: ['Draft', 'Confirmed', 'Delivered', 'Cancelled'],
    openStatuses: ['Draft', 'Confirmed'],
    printable: true,
    fields: [{ key: 'extRef', label: 'Customer PO no.', placeholder: 'The number on their order' }, party(), { key: 'refNo', label: 'Quotation no.', placeholder: 'e.g. QT-2026-0001' }, product(true), qty, rate, { key: 'dueDate', label: 'Delivery date' }, remarks],
    cols: ['docNo', 'extRef', 'docDate', 'party', 'product', 'qty', 'rate', 'amount', 'dueDate', 'status'],
  },
  {
    kind: 'final_order',
    route: 'final-order',
    resource: 'final_orders',
    label: 'Final Order',
    singular: 'Final Order',
    icon: ClipboardCheck,
    statuses: ['Confirmed', 'In Production', 'Completed', 'Cancelled'],
    openStatuses: ['Confirmed', 'In Production'],
    printable: true,
    fields: [party(), { key: 'refNo', label: 'PO no.', placeholder: 'e.g. PO-2026-0001' }, product(true), qty, rate, { key: 'dueDate', label: 'Delivery date' }, remarks],
    cols: ['docNo', 'docDate', 'party', 'product', 'qty', 'rate', 'amount', 'dueDate', 'refNo', 'status'],
  },
  {
    kind: 'task',
    route: 'task-assignment',
    resource: 'task_assignment',
    label: 'Task Assignment',
    singular: 'Task',
    icon: ListChecks,
    statuses: ['Open', 'In Progress', 'Done', 'Cancelled'],
    openStatuses: ['Open', 'In Progress'],
    printable: false,
    fields: [
      { key: 'title', label: 'Task', required: true, placeholder: 'What has to be done' },
      { key: 'assignee', label: 'Assigned to', placeholder: 'Name' },
      { key: 'refNo', label: 'Related to', placeholder: 'Lead / quotation / order no.' },
      { key: 'dueDate', label: 'Due date' },
      { key: 'priority', label: 'Priority', options: PRIORITIES },
      remarks,
    ],
    cols: ['docNo', 'title', 'assignee', 'refNo', 'dueDate', 'priority', 'status'],
  },
];

export const KIND_BY_ROUTE = Object.fromEntries(SALES_KINDS.map((k) => [k.route, k])) as Record<string, KindCfg>;

/** column heading for the list */
export const COL_LABEL: Record<ColKey, string> = {
  docNo: 'No.',
  docDate: 'Date',
  party: 'Customer',
  contact: 'Contact',
  phone: 'Phone',
  email: 'Email',
  source: 'Source',
  title: 'Task',
  product: 'Product',
  qty: 'Qty',
  rate: 'Rate',
  amount: 'Amount',
  refNo: 'Linked to',
  extRef: 'Customer PO',
  dueDate: 'Date due',
  priority: 'Priority',
  assignee: 'Assigned to',
  remarks: 'Remarks',
  status: 'Status',
};
