# Edge Functions

| Function  | What it does |
| --------- | ------------ |
| `send-po` | E-mails a **Released** purchase order to the supplier with the final PDF attached, and records the send (date, time, user, supplier e-mail). The PO becomes **Sent to Supplier**. |
| `po-pdf`  | Builds the same PDF and returns a short-lived download link. Nothing is e-mailed. |

Shared code is in `_shared/` (PDF builder, mail adapter, helpers, logo). Both functions check the caller first with the database function `can_send_po(poId)` **using the caller's own login**: only people with **Write** on *Purchase Orders* or *Purchase Approvals* can send or download, and only for a PO that is *Released* or *Sent to Supplier*.

## Before you deploy: database

Run the SQL migrations in order up to `33_invoice_payment_pdf.sql` (it creates the `po-pdfs` storage bucket, the `company_settings` table, `can_send_po`, `queue_po_send` and the new `mark_po_sent`).

## Secrets to set (never put these in the repo, in `.env`, or in the web app)

| Secret           | Example value (placeholder) | Meaning |
| ---------------- | --------------------------- | ------- |
| `RESEND_API_KEY` | `re_xxxxxxxx`               | API key from your Resend account (resend.com → API Keys). |
| `MAIL_FROM`      | `Everest Purchase <purchase@your-domain.com>` | Sender. The domain must be verified in Resend. |
| `MAIL_REPLY_TO`  | `purchase@your-domain.com`  | Where the supplier's reply goes (optional but recommended). |
| `MAIL_PROVIDER`  | `resend`                    | Optional. Only `resend` exists today; see `_shared/mail.ts` to add another. |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to every function by Supabase automatically. Nothing to set for them.

Set the secrets (replace the values; do not commit them):

```
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase secrets set RESEND_API_KEY=<key> MAIL_FROM="<name <address>>" MAIL_REPLY_TO=<address>
```

Or in the dashboard: **Project → Edge Functions → Secrets → Add new secret**.

## Deploy

From the project folder (the `supabase` CLI is run through `npx`, no global install needed):

```
npx supabase functions deploy send-po
npx supabase functions deploy po-pdf
```

JWT verification stays **on** (the default): only signed-in users can call the functions.

### If the CLI is not available (dashboard editor)

The dashboard editor deploys one function at a time and does not see the shared `_shared/` folder next to it. The easiest way round it is:

1. In the dashboard open **Edge Functions → Deploy a new function → Via Editor**, name it `send-po`.
2. Add one file for each file in `supabase/functions/_shared/` (same names: `format.ts`, `http.ts`, `logo.ts`, `mail.ts`, `po-data.ts`, `po-pdf.ts`, `deps.ts`) next to `index.ts`, and paste the contents.
3. In every file change `../_shared/` to `./` in the import lines (for example `'../_shared/http.ts'` → `'./http.ts'`).
4. Paste `send-po/index.ts` as `index.ts` and deploy. Repeat for `po-pdf`.

Using the CLI is much less error-prone; use the editor only if you must.

## Company details on the PDF

The header and the delivery box come from the table **`company_settings`** (one row, `id = 1`). To change them:

**Supabase → Table Editor → `company_settings` → edit the row** and fill in `name`, `address`, `gstin`, `phone`, `email`. A blank field is simply left out of the PDF, so the GSTIN and phone are not printed until you fill them in. Users of the app cannot read or change this table; only the Edge Function (service role) and you in the dashboard can.

The logo is embedded in `_shared/logo.ts` (a small copy of `public/everest-logo-transparent.png`). To change it, replace the base64 string in that file and redeploy.

## Test

1. In the app open a **Released** PO as a Director or Plant Head → **Download PDF** (uses `po-pdf`, sends nothing).
2. Make sure the supplier has an e-mail in **Supplier Master**, then **Send to Supplier**. Use your own e-mail as the supplier address first.
3. The PO page's **Email Logs** tab shows the result. A failed send shows the provider's error and leaves the PO status unchanged; fix the cause and send again.

Local run of the functions (needs Docker and the Supabase CLI; put the three secrets in `supabase/functions/.env`, which is git-ignored):

```
npx supabase functions serve --env-file supabase/functions/.env
curl -i http://127.0.0.1:54321/functions/v1/po-pdf -H "Authorization: Bearer <a user JWT>" -H "Content-Type: application/json" -d "{\"poId\": 1}"
```

## Behaviour worth knowing

* A second send of the same PO revision within **30 seconds** is refused (double-click guard).
* A log row left **Queued** for more than 2 minutes (for example the function timed out) is shown in the app as *Unknown — check and retry*, not as sent. Check the supplier's inbox or the Resend dashboard before sending again.
* After an **amendment** is released again the PO has a new revision: send it again; the log row and the PDF (`po/<po no>/rev<n>.pdf`) are labelled with the revision.
* PDF font: the standard Helvetica built into every PDF viewer, so amounts are written **Rs.** (no ₹ sign). Characters outside Western European text are replaced by `?` instead of failing.
