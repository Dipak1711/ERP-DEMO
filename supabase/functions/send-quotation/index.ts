// send-quotation — e-mails an APPROVED sales quotation to the customer with the final PDF attached, and records the send.
//
// POST  { quotationId: number, to?: string, cc?: string, note?: string, nextDate?: 'yyyy-mm-dd' }     (Authorization: Bearer <the signed-in user's JWT>)
//   200 { ok: true,  status: 'Sent', sentTo, cc, sentAt, logId, pdfPath, messageId }
//   4xx/5xx { ok: false, error: string, logId?: number }   400 bad input · 401 not signed in · 403 not allowed · 404 no such quotation
//                                                           409 not in a sendable state · 429 sent a moment ago · 502 mail provider failed
//
// Same order of work as send-po: (1) can_send_quotation with THE CALLER'S login → (2) service role: load the quotation, (3) reserve the send in
// sales_quotation_emails (queue_quotation_send also refuses a second send within 30 s), (4) build + store the PDF, (5) send the mail,
// (6) mark_quotation_sent records Sent (an Approved quotation becomes Sent, the first follow-up date is saved) or Failed (error logged,
// status unchanged). Until the mail secrets are set (see ../README.md) step 5 fails with "E-mail is not set up yet" and nothing changes.
import { adminClient, bearer, callerName, corsHeaders, HttpError, json, userClient } from '../_shared/http.ts';
import { loadQuotation, quotationPdfPath, storeQuotationPdf } from '../_shared/quotation-data.ts';
import { buildQuotationPdf } from '../_shared/quotation-pdf.ts';
import { getMailSender, isEmail, parseAddresses, quotationEmail, toBase64 } from '../_shared/mail.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);

  let logId: number | undefined;
  let admin: ReturnType<typeof adminClient> | undefined;
  let id = 0;
  let sentBy = 'User';
  let recipient = '';
  let path: string | undefined;
  try {
    const jwt = bearer(req);
    if (!jwt) throw new HttpError(401, 'Sign in to send a quotation.');
    const body = await req.json().catch(() => ({}));
    id = Number(body?.quotationId);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'quotationId is required.');

    // (1) permission, as the caller
    const user = userClient(jwt);
    const { data: allowed, error: permErr } = await user.rpc('can_send_quotation', { p_id: id });
    if (permErr || allowed !== true) throw new HttpError(403, 'You are not allowed to send this quotation (it must be Approved or Sent, and you need Write access to Sales Quotation with access to customer names and prices).');
    sentBy = await callerName(user, jwt);

    // (2) from here on the service role does the work
    admin = adminClient();
    const q = await loadQuotation(admin, id);
    if (!['Approved', 'Sent'].includes(q.status)) throw new HttpError(409, `The quotation is ${q.status}; only an approved quotation can be sent.`);

    const to = String(body?.to ?? '').trim() || q.customerEmail || '';
    if (!to) throw new HttpError(400, 'The quotation has no customer e-mail address. Type it in the To box.');
    if (!isEmail(to)) throw new HttpError(400, `"${to}" is not a valid e-mail address.`);
    const cc = parseAddresses(body?.cc);
    if (cc.bad.length) throw new HttpError(400, `Not valid e-mail addresses in CC: ${cc.bad.join(', ')}`);
    const note = String(body?.note ?? '').trim().slice(0, 1000);
    const nextDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.nextDate ?? '')) ? String(body.nextDate) : null;
    recipient = to;

    // (3) reserve the send (also the double-click guard)
    const { data: r, error: rErr } = await admin.rpc('queue_quotation_send', { p_id: id, p_email: to, p_cc: cc.ok.join(', ') || null, p_note: note || null, p_user: sentBy });
    if (rErr) throw new HttpError(/just sent/i.test(rErr.message) ? 429 : 409, rErr.message);
    logId = Number(r);

    // (4) PDF
    const bytes = await buildQuotationPdf(q.pdf);
    path = quotationPdfPath(q.pdf.quotation.qt_no);
    await storeQuotationPdf(admin, path, bytes);

    // (5) mail
    const mail = quotationEmail({ company: q.pdf.company.name, qtNo: q.pdf.quotation.qt_no, customer: q.pdf.customer.name, validUntil: q.validUntil, note, sender: sentBy });
    const sent = await getMailSender()({
      to: [to],
      cc: cc.ok,
      ...mail,
      attachments: [{ filename: `${q.pdf.quotation.qt_no}.pdf`, contentBase64: toBase64(bytes) }],
    });

    // (6) record the success
    const { error: markErr } = await admin.rpc('mark_quotation_sent', { p_id: id, p_email: to, p_user: sentBy, p_ok: true, p_error: null, p_log_id: logId, p_pdf_path: path, p_message_id: sent.id ?? null, p_next_date: nextDate });
    if (markErr) throw new Error(`The mail was sent but the log could not be updated: ${markErr.message}`);
    return json({ ok: true, status: 'Sent', sentTo: to, cc: cc.ok, sentAt: new Date().toISOString(), logId, pdfPath: path, messageId: sent.id ?? null });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502;
    const message = e instanceof Error ? e.message : 'The send failed.';
    console.error('send-quotation failed:', status, message); // never the API key or the PDF
    if (admin && logId) {
      await admin.rpc('mark_quotation_sent', { p_id: id, p_email: recipient, p_user: sentBy, p_ok: false, p_error: message, p_log_id: logId, p_pdf_path: path ?? null, p_message_id: null, p_next_date: null }).catch(() => {});
    }
    return json({ ok: false, error: message, logId }, status);
  }
});
