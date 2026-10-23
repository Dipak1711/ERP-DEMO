import { Inbox, ListChecks, UserPlus } from 'lucide-react';
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
const remarks: FieldDef = { key: 'remarks', label: 'Remarks' };

export const SALES_KINDS: KindCfg[] = [
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
