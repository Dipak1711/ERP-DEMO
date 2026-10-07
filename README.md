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
npm run test:engine  # headless checks of the quantity engine and seed data
```

## Suggested demo script (about 10 minutes)

1. **Dashboard**: KPI cards, the Raw → Dispatch flow with work-in-progress and loss at each stage, and eight jobs running in parallel at different stages.
2. **Trace a job**: search `JOB-2026-0001` in the top bar. The timeline shows 100 PCS issued, then 98, 98, 97 and 95 PCS through the stages. At QC, 94 PCS are accepted and 94 PCS are dispatched on GJ05AB1234 in 10 bags. A reconciliation line at the bottom shows that the quantities balance.
3. **Cutting → Create Cutting Order**: the job number is generated automatically. Choose **Start & Complete** and enter a loss of 2. The FIFO issue plan shows which raw lots are used, and the raw stock goes down.
4. Take that job through **Forging → Trimming → Heat Treatment**. The input at each stage is locked to the previous stage's output. The Heat Treatment temperature comes from the product master.
5. **QC**: accepted and rejected quantities always add up to the input, and a rejection needs a reason. The accepted quantity then appears in **Finished Goods**.
6. **Dispatch**: enter the vehicle number and number of bags. The bag-level packing list is generated, and Finished Goods go down by the dispatched quantity.
7. Refresh the browser. All the data is still there.
8. **Reset demo data** (bottom of the sidebar) restores the original seeded plant data.

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
| `src/store/seed.ts` | Product master and about two weeks of plant history replayed through the engine, so the seed data follows the same rules |
| `src/store/storage.ts` | localStorage persistence, one key per collection (`forgeflow.v1.*`) |
| `src/store/StoreContext.tsx` | React state, toasts and the trace drawer |
| `src/pages/*` | Dashboard, Raw Inventory, one page shared by the four process stages, QC, Finished Goods, Dispatch, Traceability, Ledger, Product Master |
| `src/components/TraceDrawer.tsx` | Job traceability timeline, with a Next step button |
| `src/components/workflow.ts`, `ActionHost.tsx` | Work out each job's next step and open its form from any screen |
