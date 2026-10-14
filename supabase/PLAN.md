# ForgeFlow ERP — Supabase migration plan

Status: **SQL only. Nothing in `src/` is wired to Supabase yet** (no account exists). Everything here can be
applied later to a fresh project with `supabase db push` or by pasting the files, in order, into the SQL editor.

## 1. How the app works today

* React + Vite, hash router, no backend. State = two `localStorage` namespaces:
  * `forgeflow.v1.*` — manufacturing (`ERPState`, 14 collections + `counters` + `meta`)
  * `forgeflow.dies.v1.*` — die management (`DieData`, 6 collections + `images` + `meta`)
* Every write is a pure function that mutates a **cloned** copy of state and throws `ERPError` on bad input
  (`src/store/engine.ts`, `src/dies/DieContext.tsx`). A failed action therefore never half-writes.
  → In Postgres this becomes **one RPC function per action** (a function is one transaction, same guarantee).
* Core invariants (all enforced again in SQL):
  * `OUTPUT = INPUT − LOSS` at every stage; next stage `INPUT` = previous `OUTPUT`.
  * Raw material is issued **FIFO** by `(material, OD)` the moment Cutting starts, never at job creation.
  * `Accepted + Rejected = QC input`. FG: `reserved + dispatched ≤ qty`.
  * A fully rejected batch (output = 0) at any stage or QC ⇒ job `scrapped`.
  * A job is `dispatched` only when every FG lot of it is fully dispatched.
* Flow: Raw Inventory → Cutting → Forging → Trimming → Heat Treatment → QC → Finished Goods → Dispatch.
  One `jobNo` travels through all of it; every transfer is written to the movement ledger and the activity feed.

## 2. Page-by-page analysis → what the database must do

| Page / route | What it does | Reads | Writes (RPC) |
|---|---|---|---|
| **Dashboard** `dashboard` | KPIs: raw stock (pcs + kg), active jobs, FG available/reserved, today's dispatch, pending counts per stage + QC; flow strip; “next step” list sorted by priority then progress; activity feed; loss per stage; low-stock list | `v_raw_stock`, `v_job_summary`, `v_stage_wip`, `v_finished_goods`, `dispatches`, `activity` (the “next step” list is computed in the frontend from `v_job_summary`, as `workflow.ts` does now) | `create_job`, `add_inward` (shortcuts) |
| **Raw Inventory** `raw-inventory` | 3 tabs: Lots (status Available / Low Stock <20 % / Consumed, available weight), Inward history, Issues (movements out of Raw Inventory). “Add inward” form: material (master dropdown), OD, supplier, date, qty, weight (auto from density), heat no., invoice | `v_lots`, `v_raw_inwards`, `movements` | `add_inward` |
| **New Job Card** (modal) | Product, customer, qty, raw material/OD with live stock check, cutting length, piece weight (g), die no., machine no., due date, priority. Blocks if planned > available. Creates job + Pending Cutting order. **Does not consume stock.** | `products`, `v_raw_stock` | `create_job` |
| **Cutting** `cutting` | Pending/In-progress/Completed orders. Enter actual input qty (this triggers FIFO issue), rejection, machine, operator → completes, pushes OK qty to Forging | `stage_records`, `jobs` | `start_stage`, `complete_stage` |
| **Forging** `forging` | Same engine; param `dieNo` | ″ | ″ |
| **Trimming** `trimming` | Same engine; param `trimDie`; **“Not required” tick** → loss 0, `params.skipped=1` | ″ | ″ |
| **Heat Treatment** `heat-treatment` | Same engine; params temperature, soakMinutes, process, quench (defaults from product) | ″ | ″ |
| **QC** `qc` | Queue of jobs awaiting inspection; enter rejection → OK qty; checked-by. Status Approved / Rejected / Partially Approved. Accepted > 0 creates an FG lot (with auto rack location). Second tab = **Hardness Register** | `qc_records`, `v_hardness_reports` | `complete_qc` |
| **Hardness report** (modal, from QC tab) | Client's paper form **F QC 03**: component, material family (Al/Brass/Cu) → grade → auto required range, supplier, inward/inspected qty, cycle no., drawing no., checked-by, scale, up to 50 readings; per-reading OK/Not OK; verdict Pass/Fail/Incomplete; print | `hardness_reports`, `hardness_readings`, `hardness_specs`, `material_master` | `save_hardness_report` |
| **Finished Goods** `finished-goods` | FG lots with available / reserved / dispatched, status (Available, Reserved, Partially Dispatched, Dispatched), location, weight | `v_finished_goods` | — |
| **Dispatch** `dispatch` | Create dispatch from an FG lot: vehicle, date, driver, invoice, bag-wise qty/weight (or qty + bag count → auto split), status *Ready* (reserves FG) or *Dispatched* (ships). “Mark dispatched” later with vehicle no. Prints bag list | `dispatches`, `dispatch_bags`, `v_finished_goods` | `create_dispatch`, `mark_dispatched` |
| **Job Traceability** `traceability` + **Trace drawer** | One row per job with per-stage out/loss, QC acc/rej, dispatched, progress stepper, status; drawer shows full route card, material lots issued, ledger, next step | `v_job_summary`, `stage_records`, `job_material_issues`, `movements`, `activity` | — |
| **Quantity Ledger** `ledger` | Every movement (from → to, qty, loss, note) | `movements` | — (written by RPCs) |
| **Product Master** `products` | Read-only list (code, raw material, cut length, finished weight, die, HT temp/process, default customer) | `products` | director / plant head (`save_product`) |
| **Die Master** `die-master` | Main die (component) register + summary cards; add/edit; Excel/CSV export; print die card | `main_dies`, `dies` | `save_main_die` |
| **Forging / Trimming Die Master** | Register per kind; add/edit die (dims, weights, maker, drawing, revision, images, status, cost, location, pieces); **replace** (old die kept Retired/Damaged, linked both ways); **maintenance**; **issue** to a press; **return** (adds pieces) | `dies`, `die_*` | `save_die`, `replace_die`, `record_maintenance`, `issue_die`, `return_die` |
| **Die Details / History** | Per-component view: forging dies, trimming dies, full history timeline, images | `dies`, `die_history`, `die_issues`, `die_maintenance` | — |
| **Layout / sidebar** | Pending badge per stage, bell menu (= next steps), *Clear all data*, *Load sample data*, theme | `v_stage_wip` | `reset_transactional_data()` (service role only) |

## 3. Design decisions

1. **Keep the frontend's string values** for every enum/label (`'heatTreatment'`, `'In Progress'`, `'Partially Approved'` …)
   so no mapping layer is needed except camelCase ⇄ snake_case.
2. **One `stage_records` table** (with `stage` enum + `params jsonb`) instead of four identical tables. `UNIQUE(job_no, stage)`.
3. **Business rules live in SQL functions** (`SECURITY DEFINER`, `search_path` pinned). Transactional tables are
   **read-only for clients**; the only way to change them is through the RPCs, so a bug or a hand-edited request
   cannot break `output = input − loss`, FIFO or FG balances. Row locks (`FOR UPDATE`) prevent two users issuing the same stock.
4. **Counters → `doc_counters(kind, year)`**: numbers now restart each year (`JOB-2027-0001`), matching the year in the
   ID. (The demo used one global counter under a year prefix.) Die codes (`DIE-/FGD-/TRD-0001`) take `max()+1` under an advisory lock, exactly like the client.
5. **Derived values are views, not columns**: lot status, available weight, FG status, hardness verdict, job summary,
   stage WIP. They can never drift out of sync.
6. **`raw_inwards` was a 1:1 copy of the lot** → now the view `v_raw_inwards`.
7. **`heat_no` / `invoice_no` on lots are nullable.** The demo invented fake values when blank; a real DB should not.
   (Dispatch invoice no. keeps the auto `INV-YYYY-####` default.)
8. **Die images → Supabase Storage** (private bucket `die-images`), tables store only the path. localStorage held
   base64 data URLs.
9. **Die history is trigger-driven**: creating/updating a die appends the same events the client wrote
   (“Die created”, “Status changed”, “Die details updated — Changed: …”, “Die marked damaged”). RPCs pass extra
   context (event date, note) through transaction-local settings `erp.event_date`, `erp.note`.
10. **No deletes anywhere** for dies/production (the app never deleted; dies are Retired/Damaged, main dies Inactive).
11. **Auth/roles (minimal)**: `profiles(role)` auto-created per `auth.users` row; roles `director|plant_head|accounts|qc|operator|viewer` (see §10).
    Today: any active user can run production RPCs; only director / plant head edit masters and see confidential data unmasked. Finer per-role limits (e.g. only `qc` runs
    `complete_qc`) are a one-line `_require_role()` change later.
12. `created_by uuid default auth.uid()` on the main transactional tables for audit.

## 4. localStorage → table map

| localStorage key | Supabase |
|---|---|
| `forgeflow.v1.products` | `products` |
| (consts in `seed.ts`: suppliers, customers, machines, operators, inspectors) | `suppliers`, `customers`, `machines`, `operators`, `inspectors` |
| (consts in `materials.ts`, `hardnessSpecs.ts`) | `material_master`, `hardness_specs` |
| `…rawMaterials` | `raw_material_lots` |
| `…rawInwards` | view `v_raw_inwards` |
| `…jobs` (+ embedded `issues[]`) | `jobs` + `job_material_issues` |
| `…cutting/forging/trimming/heatTreatment` | `stage_records` (`stage` column) |
| `…qc` | `qc_records` |
| `…hardnessReports` (+ embedded `readings[]`) | `hardness_reports` + `hardness_readings` |
| `…finishedGoods` | `finished_goods` (+ view `v_finished_goods`) |
| `…dispatches` (+ embedded `bags[]`) | `dispatches` + `dispatch_bags` |
| `…movements` / `…activity` | `movements` / `activity` |
| `…counters` | `doc_counters` |
| `…meta` | not needed (`reset_transactional_data()` replaces “seed/clear”) |
| `forgeflow.dies.v1.mainDies` | `main_dies` |
| `…forgingDies` + `…trimmingDies` | `dies` (`kind` column) |
| `…history` / `…maintenance` / `…issues` | `die_history` / `die_maintenance` / `die_issues` |
| `…images` (data URLs) | Storage bucket `die-images` + `dies.top_img_path / bottom_img_path` |
| `forgeflow.theme`, `forgeflow.sidebar` | stay in localStorage (per-device UI prefs) |

## 5. RPC cheat-sheet (for the later wiring step)

| Engine function (TS) | Supabase RPC |
|---|---|
| `addInward` | `add_inward(p_material, p_material_type, p_od, p_supplier, p_inward_date, p_qty, p_weight, p_heat_no, p_invoice_no, p_ts)` |
| `createJob` | `create_job(p_product_id, p_planned_qty, p_material, p_od, p_cutting_length, p_customer, p_due_date, p_priority, p_piece_weight_g, p_die_no, p_machine_no, p_ts)` |
| `startStage` / `completeStage` | `start_stage(...)` / `complete_stage(p_stage, p_job_no, p_loss, p_input_qty, p_machine, p_operator, p_remarks, p_params, p_ts)` |
| `completeQC` | `complete_qc(p_job_no, p_accepted, p_rejected, p_inspector, …, p_ts)` |
| `createDispatch` / `markDispatched` | `create_dispatch(...)` / `mark_dispatched(p_dispatch_no, p_vehicle_no, p_ts)` |
| `saveHardnessReport` | `save_hardness_report(p_payload jsonb, p_id text)` |
| `DieContext.*` | `save_main_die`, `save_die`, `replace_die`, `record_maintenance`, `issue_die`, `return_die` |

All raise `exception` with the **same message text** as `ERPError`, so the existing toast code keeps working.
`p_ts` lets the UI keep back-dating entries (the forms have a date field).

## 6. Migration files (apply in order)

| # | File | Contents |
|---|---|---|
| 1 | `01_enums_and_helpers.sql` | enums, `set_updated_at` |
| 2 | `02_masters_and_profiles.sql` | profiles/roles, customers, suppliers, machines, operators, inspectors, material master, hardness specs, products |
| 3 | `03_counters.sql` | `doc_counters`, `next_doc_no` |
| 4 | `04_raw_inventory.sql` | `raw_material_lots` |
| 5 | `05_jobs_and_stages.sql` | `jobs`, `job_material_issues`, `stage_records` |
| 6 | `06_qc_and_hardness.sql` | `qc_records`, `hardness_reports`, `hardness_readings` |
| 7 | `07_finished_goods_dispatch.sql` | `finished_goods`, `dispatches`, `dispatch_bags` |
| 8 | `08_ledger_activity.sql` | `movements`, `activity` |
| 9 | `09_dies.sql` | `main_dies`, `dies`, `die_history`, `die_maintenance`, `die_issues` |
| 10 | `10_production_functions.sql` | helpers + all production RPCs |
| 11 | `11_hardness_function.sql` | `save_hardness_report` |
| 12 | `12_die_functions.sql` | die triggers + die RPCs |
| 13 | `13_views.sql` | read models used by pages |
| 14 | `14_rls_and_grants.sql` | RLS, grants, function privileges |
| 15 | `15_storage.sql` | `die-images` bucket + policies |
| – | `seed.sql` | master data from `seed.ts`, `materials.ts`, `hardnessSpecs.ts` |

## 7. Rollout steps once an account exists

1. Create the Supabase project; `supabase link`; `supabase db push`; run `seed.sql`.
2. Create the first user, then `update profiles set role='director' where id = '<uuid>';` (new users default to `viewer`; roles: director, plant_head, accounts, qc, operator, viewer — see §10).
3. Add `@supabase/supabase-js`, a `src/db/client.ts`, and a camelCase⇄snake_case mapper.
4. Replace `StoreContext.run()` with RPC calls + refetch (or Realtime subscriptions); replace `loadState/saveState`.
   Keep `engine.ts` read-only helpers (`jobSummary`, labels) or switch pages to the views.
5. Replace `DieContext` mutations with the die RPCs; switch `ImagePicker` to Storage uploads.
6. Generate typed client: `supabase gen types typescript`.
7. (Optional) write a script that replays the old demo `sample.ts` through the RPCs to load sample data.

## 8. Open questions for the client

* Should QC be restricted to the `qc` role? (currently: any active user runs production actions; confidential data per §10)
* Do job/dispatch numbers restart every year (implemented) or run continuously?
* Hardness ranges other than AA 6082-T6 are placeholders (see `hardnessSpecs.ts`) — confirm and edit `hardness_specs`.
* Multi-plant / multi-company? (Not modelled; would add `org_id` + RLS on every table.)

## 9. Verification done

All 15 migrations + `seed.sql` were applied to a scratch Postgres (PGlite, with stub `auth`/`storage` schemas) and the full
flow was executed: inward → job → 4 stages (trimming skipped) → QC (partial) → FG → dispatch (ready → shipped, bag split, bag-wise weights) →
hardness report (create/update/verdict) → die create/edit/issue/return/maintenance/replace (history lines) → reset.
Numbers matched the app engine (500 issued, 20 process loss, 2 QC reject, 478 dispatched, 95.6 % yield). Also checked: insufficient-stock error,
negative-value and duplicate part-code errors, no-delete guard, clients cannot write production tables, `anon` sees nothing, masked roles cannot write masters.
Not yet run against a real Supabase project (no account) — do `supabase db reset` locally or `db push` once one exists.

## 10. Confidential data & roles

**Rule:** party names, product / purchase / sales rates, invoices and financial values are visible only to
**Director, Plant Head and Accounts**. Everyone else gets them masked. Director and Plant Head additionally get the management numbers and can edit master data.

| Role (`profiles.role`) | Confidential data | Management dashboards (`v_management_summary`) | Master data | Enter rates |
|---|---|---|---|---|
| `director` | full | yes | edit | yes |
| `plant_head` | full | yes | edit | yes |
| `accounts` | full (parties, rates, invoices, values, `v_sales_by_customer`) | no | read | yes |
| `qc`, `operator`, `viewer` | **masked** (`••••••` / `NULL`) | no | read | no |

New users start as `viewer` (least privilege) until a director sets their role.

**What is confidential (columns):** `products.default_customer`, `products.sales_rate`, `raw_material_lots.supplier / invoice_no / purchase_rate`,
`jobs.customer`, `dispatches.customer / invoice_no / sales_rate` (+ computed `amount`), `hardness_reports.supplier`, `main_dies.customer`,
`dies.maker / cost`, and the whole `customers` and `suppliers` lists.

**How it is enforced (server-side, not cosmetic):**
1. Tables with confidential columns have **no SELECT grant** for clients — `select * from jobs`, `?select=customer`, joins, exports and Realtime on them all fail with *permission denied*.
2. Clients read **views** (`v_products`, `v_lots`, `v_jobs`, `v_job_summary`, `v_finished_goods`, `v_dispatches`, `v_hardness_reports`, `v_main_dies`, `v_dies`, …).
   The views run with owner rights and wrap each confidential column in `mask_text()` / `mask_num()`, which check `can_see_confidential()` against the signed-in user's role. A masked user never receives the real value over the wire.
3. `customers` / `suppliers` have an RLS policy `can_see_confidential()` (masked roles see 0 rows). Master-data writes need `can_manage_masters()` (director / plant head); the product master is written only through `save_product()`.
4. **Write side:** rate entry (`add_inward.p_purchase_rate`, die cost, product rates) is refused for roles that may not see rates. A masked user editing a record cannot overwrite a hidden value
   (`save_die`, `save_main_die`, `save_hardness_report` keep the stored maker / customer / supplier / cost), and the literal mask text `••••••` is never stored (`unmask_keep`).
5. **Side channels closed:** the `activity` and `movements` feeds and die history are readable by everyone, so they contain only job / lot / dispatch numbers — never a party name or amount.
   Views also return nothing to `anon` or to inactive users.
6. Function privileges: the mask / role helpers are executable by `authenticated` because Postgres checks function rights against the *caller* even inside a view; they reveal nothing on their own.

**Frontend (this repo, `src/auth/access.tsx`):** a role switcher (“Viewing as”, top bar) stands in for sign-in until Supabase Auth exists. Masked roles see `••••••` — the real value is **not rendered** (so it cannot be selected, copied or found via inspect),
searches ignore hidden fields (no probing names by typing), forms never load hidden values, the supplier list is not offered, and **printouts** (route card, hardness report, die card) and **Excel/CSV exports** carry the mask too.
When the app is wired to Supabase it will read the `v_*` views, so the server does the masking and the demo-side switch is replaced by `v_me`.
In the localStorage demo the data still sits in the browser, so the demo's masking is presentation-only — real protection starts with the database.

**Known limits / decisions to confirm**
* Free-text fields typed by users (remarks, die maintenance notes) are not scanned; the rule is “do not type party names or prices into remarks”.
* The existing Dashboard shows operational numbers only (no money), so it stays visible to all roles. `can_see_management()` / `v_management_summary` (stock value, FG value, dispatched value) are ready for a Director / Plant Head finance dashboard.
* Masked store/QC users can still *type* a supplier or customer name when they create a record (they have the challan in hand); they just cannot read it back.
* Die makers are treated as vendors (parties) → masked. Flip `maker` out of the masked list in `13_views.sql` if the client disagrees.
* Accounts cannot edit the product master (only view rates); change `save_product` / `can_manage_masters()` if Accounts should maintain rates.
* Product `sales_rate` is per piece, lot `purchase_rate` per KG — confirm units with the client. The demo rates in `seed.ts` / `sample.ts` are illustrative.

### Verification (permission tests)
* **Database** — scratch Postgres (PGlite), 6 roles + inactive user + anon: direct table reads denied for all roles; every masking view returns real values for
  director / plant_head / accounts and `••••••` / `NULL` for qc / operator / viewer; `customers` / `suppliers` 5 / 7 rows vs 0; `v_management_summary` only for director / plant head; `v_sales_by_customer` only for the three privileged roles;
  rate entry refused for qc / operator / viewer; `save_product` refused for accounts and below; masked users' edits leave maker / cost untouched; no party name in activity / ledger / history for anyone; inactive user and `anon` get nothing.
* **Frontend** — `npm run test:access` renders 26 screens / forms / drawers plus route-card, hardness and die-card printouts and the Excel exports for each role (31 outputs per role) and scans for every real party name, invoice, rate and cost:
  authorised roles show them, qc / operator / viewer show none (0 leaks). `npm run build` and `npm run test:engine` still pass.
