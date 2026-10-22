// send-po — e-mails a RELEASED purchase order to the supplier with the final PDF attached, and records the send.
//
// POST  { poId: number, to?: string, cc?: string, note?: string }          (Authorization: Bearer <the signed-in user's JWT>)
//   200 { ok: true,  status: 'Sent to Supplier', sentTo, cc, sentAt, logId, pdfPath, messageId }
//   4xx/5xx { ok: false, error: string, logId?: number }   400 bad input · 401 not signed in · 403 not allowed · 404 no such PO
//                                                           409 not in a sendable state · 429 sent a moment ago · 502 mail provider failed
//
// Order of work: (1) check the caller with can_send_po using THEIR login → (2) only then switch to the service role: load the PO,
// (3) reserve the send in po_email_log (queue_po_send refuses a second send of the same revision within 30 s), (4) build + store the PDF,
// (5) send the mail, (6) mark_po_sent records Sent (PO → Sent to Supplier) or Failed (error logged, status unchanged).
import { adminClient, bearer, callerName, corsHeaders, HttpError, json, userClient } from '../_shared/http.ts';
import { loadPo, pdfPath, storePdf } from '../_shared/po-data.ts';
import { buildPoPdf } from '../_shared/po-pdf.ts';
import { getMailSender, isEmail, parseAddresses, poEmail, toBase64 } from '../_shared/mail.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);

  let logId: number | undefined;
  let admin: ReturnType<typeof adminClient> | undefined;
  let poId = 0;
  let sentBy = 'User';
  let recipient = '';
  let path: string | undefined;
  try {
    const jwt = bearer(req);
    if (!jwt) throw new HttpError(401, 'Sign in to send a purchase order.');
    const body = await req.json().catch(() => ({}));
    poId = Number(body?.poId);
    if (!Number.isInteger(poId) || poId <= 0) throw new HttpError(400, 'poId is required.');

    // (1) permission, as the caller
    const user = userClient(jwt);
    const { data: allowed, error: permErr } = await user.rpc('can_send_po', { p_po_id: poId });
    if (permErr || allowed !== true) throw new HttpError(403, 'You are not allowed to send this purchase order (it must be Released or Sent to Supplier, and you need Write access to Purchase Orders or Purchase Approvals).');
    sentBy = await callerName(user, jwt);

    // (2) from here on the service role does the work
    admin = adminClient();
    const po = await loadPo(admin, poId);
    if (!['Released', 'Sent to Supplier'].includes(po.status)) throw new HttpError(409, `PO is ${po.status}; only a released PO can be sent.`);

    const to = String(body?.to ?? '').trim() || po.supplierEmail || '';
    if (!to) throw new HttpError(400, 'The supplier has no e-mail address. Add one in Supplier Master or type it in the To box.');
    if (!isEmail(to)) throw new HttpError(400, `"${to}" is not a valid e-mail address.`);
    const cc = parseAddresses(body?.cc);
    if (cc.bad.length) throw new HttpError(400, `Not valid e-mail addresses in CC: ${cc.bad.join(', ')}`);
    const note = String(body?.note ?? '').trim().slice(0, 1000);
    recipient = to;

    // (3) reserve the send (also the double-click guard)
    const { data: q, error: qErr } = await admin.rpc('queue_po_send', { p_po_id: poId, p_email: to, p_cc: cc.ok.join(', ') || null, p_note: note || null, p_user: sentBy });
    if (qErr) throw new HttpError(/just sent/i.test(qErr.message) ? 429 : 409, qErr.message);
    logId = Number(q);

    // (4) PDF
    const bytes = await buildPoPdf(po.pdf);
    path = pdfPath(po.pdf.po.po_no, po.pdf.po.rev_no);
    await storePdf(admin, path, bytes);

    // (5) mail
    const revTag = po.pdf.po.rev_no > 0 ? ` (REV ${po.pdf.po.rev_no})` : '';
    const mail = poEmail({ company: po.pdf.company.name, poLabel: `${po.pdf.po.po_no}${revTag}`, supplier: po.pdf.supplier.name, deliveryDate: po.deliveryDate, note, sender: sentBy });
    const sent = await getMailSender()({
      to: [to],
      cc: cc.ok,
      ...mail,
      attachments: [{ filename: `${po.pdf.po.po_no}${po.pdf.po.rev_no > 0 ? `-REV${po.pdf.po.rev_no}` : ''}.pdf`, contentBase64: toBase64(bytes) }],
    });

    // (6) record the success
    const { error: markErr } = await admin.rpc('mark_po_sent', { p_id: poId, p_email: to, p_user: sentBy, p_ok: true, p_error: null, p_log_id: logId, p_pdf_path: path, p_message_id: sent.id ?? null });
    if (markErr) throw new Error(`The mail was sent but the log could not be updated: ${markErr.message}`);
    return json({ ok: true, status: 'Sent to Supplier', sentTo: to, cc: cc.ok, sentAt: new Date().toISOString(), logId, pdfPath: path, messageId: sent.id ?? null });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502;
    const message = e instanceof Error ? e.message : 'The send failed.';
    console.error('send-po failed:', status, message); // never the API key or the PDF
    // a reserved send that did not complete is recorded as Failed (the PO status does not change)
    if (admin && logId) {
      await admin.rpc('mark_po_sent', { p_id: poId, p_email: recipient, p_user: sentBy, p_ok: false, p_error: message, p_log_id: logId, p_pdf_path: path ?? null, p_message_id: null }).catch(() => {});
    }
    return json({ ok: false, error: message, logId }, status);
  }
});
