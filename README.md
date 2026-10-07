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

## Checking the flow and calculations (worked example)

1. **Raw Inventory → Add Raw Material Inward**: EN8 Steel Round Bar (the grade and OD 50 fill in automatically), **600 PCS / 168 KG**. Add a second inward of **400 PCS / 112 KG**. EN8 stock is now **1,000**.
2. **Cutting → Create Cutting Order**: 9084 Flange, EN8 OD 50, planned **700**. Stock stays at 1,000 until cutting starts.
3. **Start** the cutting order, enter loss **14** and complete. FIFO issues 600 PCS from the first lot and 100 from the second, so EN8 drops to **300**. The output is 700 − 14 = **686**.
4. **Forging**: the input is locked at 686. Loss 6 → **680**.
5. **Trimming**: 680 − 5 → **675**.
6. **Heat Treatment** (850°C from the product): 675 − 3 → **672**.
7. **QC**: 672 = **668 accepted** + 4 rejected. Finished Goods becomes **668**.
8. **Dispatch** 668 with a vehicle number and bags. Finished Goods becomes **0**.
9. Click the job number. The reconciliation line reads **700 issued = 28 process loss + 4 QC rejected + 668 finished goods** (balanced).

If you try to create a job for a material with no stock, the form says so and offers **Add Raw Material Inward**.

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
