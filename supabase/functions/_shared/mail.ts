// Outgoing mail behind one small adapter. Today: Resend's HTTPS API. To use another provider (SMTP relay, SendGrid, …) add a function that
// returns a MailSender and select it with the MAIL_PROVIDER secret; send-po itself does not change.
import { dmy } from './format.ts';

export interface MailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; contentBase64: string }[];
}
export type MailSender = (m: MailMessage) => Promise<{ id?: string }>;

const resend: MailSender = async (m) => {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM');
  if (!key || !from) throw new Error('E-mail is not set up yet: the RESEND_API_KEY and MAIL_FROM secrets are missing.');
  const replyTo = Deno.env.get('MAIL_REPLY_TO');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: m.to,
      ...(m.cc?.length ? { cc: m.cc } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: m.subject,
      text: m.text,
      html: m.html,
      attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, content: a.contentBase64 })),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mail provider refused the message (${res.status}): ${body?.message ?? body?.error ?? 'no details'}`);
  return { id: body?.id };
};

export function getMailSender(): MailSender {
  const provider = (Deno.env.get('MAIL_PROVIDER') ?? 'resend').toLowerCase();
  if (provider === 'resend') return resend;
  throw new Error(`Unknown MAIL_PROVIDER "${provider}".`);
}

export const isEmail = (s: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s);

/** "a@x.com, b@y.com" → ["a@x.com","b@y.com"]; anything that is not an address is reported back */
export function parseAddresses(list: string | undefined | null): { ok: string[]; bad: string[] } {
  const parts = String(list ?? '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  return { ok: parts.filter(isEmail), bad: parts.filter((p) => !isEmail(p)) };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Plain, professional body: PO number, delivery date, request to acknowledge. */
export function poEmail(o: { company: string; poLabel: string; supplier: string; deliveryDate?: string | null; note?: string; sender: string }) {
  const delivery = o.deliveryDate ? dmy(o.deliveryDate) : '';
  const subject = `Purchase Order ${o.poLabel} – ${o.company}`;
  const lines = [
    `Dear ${o.supplier || 'Sir / Madam'},`,
    '',
    `Please find attached our Purchase Order ${o.poLabel}.`,
    delivery ? `Required delivery date: ${delivery}.` : '',
    '',
    ...(o.note ? [o.note, ''] : []),
    `Kindly acknowledge receipt of this order by replying to this e-mail, and quote the PO number on your invoice and delivery challan.`,
    '',
    'Regards,',
    o.sender,
    o.company,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === ''));
  const text = lines.join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">
<p>Dear ${esc(o.supplier || 'Sir / Madam')},</p>
<p>Please find attached our Purchase Order <b>${esc(o.poLabel)}</b>.${delivery ? `<br/>Required delivery date: <b>${esc(delivery)}</b>.` : ''}</p>
${o.note ? `<p>${esc(o.note).replace(/\n/g, '<br/>')}</p>` : ''}
<p>Kindly acknowledge receipt of this order by replying to this e-mail, and quote the PO number on your invoice and delivery challan.</p>
<p>Regards,<br/>${esc(o.sender)}<br/>${esc(o.company)}</p></div>`;
  return { subject, text, html };
}

/** Uint8Array → base64 without blowing the call stack on large files */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
