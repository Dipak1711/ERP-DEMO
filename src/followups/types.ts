export type FollowupKind = 'quotation' | 'order' | 'task' | 'po' | 'rfq' | 'payment';

export const KIND_LABEL: Record<FollowupKind, string> = {
  quotation: 'Quotations',
  order: 'Sales Orders',
  task: 'Tasks & Inquiries',
  po: 'Purchase Orders',
  rfq: 'RFQs',
  payment: 'Supplier Payments',
};
export const KIND_ORDER: FollowupKind[] = ['quotation', 'order', 'task', 'po', 'rfq', 'payment'];

/** One thing somebody has to follow up on, from any part of the system. */
export interface FollowupItem {
  key: string;
  kind: FollowupKind;
  /** document number (QT-…, SO-…, PO-…) */
  ref: string;
  /** customer or supplier ('' when the person may not see names) */
  party: string;
  /** what has to be done, e.g. "Follow up with the customer" */
  what: string;
  /** one line of context */
  detail: string;
  /** yyyy-mm-dd the follow-up is due; null = nobody has set a date */
  due: string | null;
  amount: number | null;
  /** where to open it */
  route: string;
}

export type DueState = 'overdue' | 'today' | 'tomorrow' | 'soon' | 'later' | 'none';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayStr = () => iso(new Date());

export function daysUntil(due: string): number {
  const a = new Date(due.slice(0, 10) + 'T00:00:00').getTime();
  const b = new Date(todayStr() + 'T00:00:00').getTime();
  return Math.round((a - b) / 86400000);
}

export function dueState(due: string | null): DueState {
  if (!due) return 'none';
  const n = daysUntil(due);
  return n < 0 ? 'overdue' : n === 0 ? 'today' : n === 1 ? 'tomorrow' : n <= 7 ? 'soon' : 'later';
}

export const DUE_LABEL: Record<DueState, string> = { overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow', soon: 'This week', later: 'Later', none: 'No date set' };

/** due tomorrow, today or already late: what the bell and the dashboard cards count */
export const needsAttention = (i: FollowupItem) => i.due != null && daysUntil(i.due) <= 1;

export const dueText = (due: string | null): string => {
  if (!due) return 'No date set';
  const n = daysUntil(due);
  if (n < 0) return `Overdue by ${-n} day${n === -1 ? '' : 's'}`;
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return `In ${n} days`;
};
