# ForgeFlow ERP: Forging & Casting Client Demo

A frontend-only, clickable demo of the full production flow:

**Raw Inventory → Cutting → Forging → Trimming → Heat Treatment → QC → Finished Goods → Dispatch**

It tracks quantities stage by stage, records loss and rejection, and keeps one job number from raw material through to dispatch.
There is no backend: all data lives in the browser's `localStorage`.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build in dist/
npm run test:engine  # headless checks of the quantity engine (runs the worked example below)
```

## Starting data

The app starts with **master data only: no raw-material stock and no jobs**.

- **Kept for the dropdowns:** the product master (9084 Flange, Brass Bush, Copper Component, Aluminium Forged Component) and the raw-material categories (EN8 Steel Round Bar OD 50, Brass Round Bar OD 45, Copper Round Bar OD 30, Aluminium Round Bar OD 25). Customer, supplier, machine, operator and inspector lists are also kept.
- **Entered by you:** every raw-material inward, job, stage entry, QC result and dispatch.
- **Clear all data** (bottom of the sidebar) deletes all stock and jobs. Masters are kept.

## Raw material master

The inward form uses dropdowns, so nobody has to type material names:

- **Material** is grouped by family: Carbon Steel (EN8, EN9, EN3), Alloy Steel (EN19, EN24, 20MnCr5), Stainless Steel (SS304, SS316, SS410), Brass (CW614N, CW617N forging brass), Copper (ETP, OFHC) and Aluminium (6061, 6082, 2014).
- **Grade / Specification** fills in automatically from the material.
- **OD / Size** is chosen from standard bar diameters (12–120 mm).
- **Supplier** is chosen from the supplier list.
- **Total Weight** is calculated automatically from quantity × piece length × π/4·OD² × density. For example, a Ø50 steel bar works out at 15.41 kg per metre. You can overwrite it with the actual weighed weight.

At each process stage, **Loss Reason** is chosen from standard forging defects (for example under-fill, lap / fold or quench crack). The Heat Treatment **Process** is also a dropdown.
The master list is in `src/store/materials.ts`.

## Screens follow the paper Process Route Card

Every form uses only the fields the client already fills on the paper route card:

- **New Job Card:** Job Card No. (auto), Date, Item, Material / Bar OD, Length, Weight per piece (auto from OD × length × density), Qty to Cut, Die No., Machine No.
- **Cutting, Forging, Trimming, Heat Treatment, QC:** one row each, with Inward Date, Received Qty, Rejection Qty, OK Qty (auto = Received − Rejection) and Checked By. Heat Treatment also has its Temperature. Trimming has a **"Not required"** tick for jobs that skip it.
- **Dispatch:** Job Card No., Date, Vehicle No., and one row per bag (qty + weighed weight; a blank weight is calculated).

## Checking the flow and calculations (worked example)

1. **Raw Inventory → Add Raw Material Inward**: EN8 Steel Round Bar, OD 50, choose a supplier, **600 PCS / 168 KG**. Add a second inward of **400 PCS**. EN8 stock is now **1,000**.
2. **Cutting → New Job Card**: 9084 Flange, EN8 Ø50, Length 62 mm (weight per piece fills in at 956 g), Qty to Cut **700**. Stock stays at 1,000.
3. **Cutting → Enter Qty**: Received 700, Rejection **14** → OK **686**. FIFO issues 600 PCS from the first lot and 100 from the second, so stock drops to **300**.
4. **Forging**: Received 686 (locked), Rejection 6 → **680**.
5. **Trimming**: 680 − 5 → **675** (or tick "Not required" to pass all pieces on).
6. **Heat Treatment** (850°C from the product): 675 − 3 → **672**.
7. **QC**: 672 − 4 → **668** OK, which goes to Finished Goods.
8. **Dispatch**: vehicle number and bags (e.g. 300 + 368). Finished Goods becomes **0**.
9. Click the job number. The reconciliation line reads **700 issued = 28 process loss + 4 QC rejected + 668 finished goods** (balanced).

## Making it easy to follow

- **Next Action buttons:** every active job on the Dashboard has one ("Complete Forging", "Inspect at QC", "Dispatch Goods"), which opens the right form straight away.
- **Next step in the job drawer:** you can push one job from stage to stage without leaving its timeline, and watch the timeline fill in.
- **Bell (top bar):** lists every job waiting for someone to act.
- **Workflow bar:** every flow page shows all 8 stages with their live load, and you can click any stage to go there.
- **Dark mode and a collapsible sidebar:** both are remembered in this browser.

## Code map

| Path | Purpose |
|---|---|
| `src/store/engine.ts` | All quantity rules (pure functions). Output = Input − Loss; the next stage's input = the previous stage's output; FIFO raw issue; QC balance; FG reserve and dispatch |
| `src/store/seed.ts` | Master lists only (products, raw-material categories, customers, suppliers, machines, operators); no stock, no jobs |
| `src/store/storage.ts` | localStorage persistence, one key per collection (`forgeflow.v1.*`) |
| `src/store/StoreContext.tsx` | React state, toasts and the trace drawer |
| `src/pages/*` | Dashboard, Raw Inventory, one page shared by the four process stages, QC, Finished Goods, Dispatch, Traceability, Ledger, Product Master |
| `src/components/TraceDrawer.tsx` | Job traceability timeline, with a Next step button |
| `src/components/workflow.ts`, `ActionHost.tsx` | Work out each job's next step and open its form from any screen |
