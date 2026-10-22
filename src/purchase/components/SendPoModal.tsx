import { useState } from 'react';
import { Paperclip, Send } from 'lucide-react';
import { Field, Modal } from '../../components/ui';
import { fmtDate } from '../../components/format';
import { useStore } from '../../store/StoreContext';
import { sendPO } from '../services/poService';
import type { PODetail } from '../types';

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** "Send to Supplier": the released PO goes out by e-mail with its final PDF attached (Edge Function send-po). */
export function SendPoModal({ po, onClose, onDone }: { po: PODetail; onClose: () => void; onDone: (sent: boolean) => void }) {
  const { toast } = useStore();
  const [to, setTo] = useState(po.supplierEmail ?? '');
  const [cc, setCc] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revTag = po.revNo > 0 ? ` (REV ${po.revNo})` : '';
  const fileName = `${po.poNo}${po.revNo > 0 ? `-REV${po.revNo}` : ''}.pdf`;
  const toOk = EMAIL.test(to.trim());
  const ccBad = cc.split(/[,;\s]+/).filter(Boolean).filter((a) => !EMAIL.test(a));
  const again = po.emailLogs.some((l) => l.revNo === po.revNo && l.deliveryStatus === 'Sent');

  const submit = async () => {
    try {
      setSending(true);
      setError(null);
      const r = await sendPO(po.id, { to: to.trim(), cc: cc.trim(), note: note.trim() });
      toast({ kind: 'success', title: 'Purchase order sent', message: `${po.poNo}${revTag} was e-mailed to ${r.sentTo ?? to}.` });
      onDone(true);
    } catch (e) {
      // keep the dialog open: the person can fix the address and try again. The failure is also written to the Email Logs tab.
      setError(e instanceof Error ? e.message : 'The purchase order could not be sent.');
      onDone(false); // the parent reloads so the Failed row shows in the Email Logs tab
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={Send}
      title={again ? 'Send Purchase Order Again' : 'Send to Supplier'}
      subtitle={`${po.poNo}${revTag}${po.supplierName ? ' · ' + po.supplierName : ''}`}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={sending}>
            Close
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={sending || !toOk || ccBad.length > 0}>
            <Send size={15} /> {sending ? 'Sending…' : again ? 'Send again' : 'Send'}
          </button>
        </>
      }
    >
      <Field label="To" required error={to && !toOk ? 'Enter a valid e-mail address' : null} hint={po.supplierEmail ? undefined : 'The supplier has no e-mail in Supplier Master — type one here'}>
        <input type="email" value={to} onChange={(e) => setTo(e.target.value)} autoFocus />
      </Field>
      <Field label="CC" error={ccBad.length ? `Not valid: ${ccBad.join(', ')}` : null} hint="Optional. Separate several addresses with commas">
        <input value={cc} onChange={(e) => setCc(e.target.value)} />
      </Field>
      <Field label="Note to the supplier" hint="Optional. Added to the e-mail text">
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>

      <div className="callout info">
        <Paperclip size={16} />
        <div>
          <b>Attached:</b> {fileName} — the final approved PO with its approval details.
          {po.deliveryDate ? ` The e-mail asks the supplier to acknowledge and mentions the delivery date ${fmtDate(po.deliveryDate)}.` : ' The e-mail asks the supplier to acknowledge.'}
          {again && ' This revision was already sent once.'}
        </div>
      </div>
      {error && (
        <div className="callout err" role="alert">
          <Send size={16} />
          <div>
            <b>Not sent.</b> {error}
          </div>
        </div>
      )}
    </Modal>
  );
}
