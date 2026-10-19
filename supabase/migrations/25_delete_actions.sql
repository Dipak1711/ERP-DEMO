-- ============================================================
-- 25 · Delete actions for the record pages
-- ============================================================
-- Every delete is one function that checks the Write level of the page first and REFUSES when the record is already part of the
-- flow, so stock, quantities and traceability can never be left half-deleted:
--   delete_inward            a raw-material lot — only if nothing of it has been issued to production
--   delete_product           a product — only if no job card was ever made from it
--   delete_job               a job card — only while it is still waiting at Cutting (nothing issued, nothing entered)
--   delete_hardness_report   a hardness report (its readings go with it)
--   delete_dispatch          a dispatch — only while it is still "Ready for Dispatch"; the packed quantity goes back to available
-- QC inspections, finished-goods lots and ledger lines are results of the flow, so they have no delete. Dies have none either:
-- their history is permanent by design (see 12) — a die is retired, not deleted.
-- Needs 18, 19. Safe to run twice.

create or replace function delete_inward(p_lot_id text, p_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare
  lot raw_material_lots;
begin
  perform _require_user();
  perform _require_write('raw_inventory');
  select * into lot from raw_material_lots where id = p_lot_id for update;
  if not found then raise exception 'Lot % does not exist.', p_lot_id; end if;
  if lot.available_qty <> lot.inward_qty or exists (select 1 from job_material_issues where lot_id = p_lot_id) then
    raise exception 'Lot % cannot be deleted — % PCS of it are already issued to production.', p_lot_id, lot.inward_qty - lot.available_qty;
  end if;
  delete from movements where from_loc = 'Supplier' and to_loc = 'Raw Inventory' and note like '%lot ' || p_lot_id;
  delete from raw_material_lots where id = p_lot_id;
  perform _log(coalesce(p_ts, now()), 'inward', format('Inward lot %s deleted — %s PCS %s (OD %smm)', p_lot_id, lot.inward_qty, lot.material, trim_scale(lot.od)));
end $$;

create or replace function delete_product(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_jobs int;
begin
  perform _require_user();
  perform _require_write('products');
  if not exists (select 1 from products where id = p_id) then raise exception 'Product % does not exist.', p_id; end if;
  select count(*) into v_jobs from jobs where product_id = p_id;
  if v_jobs > 0 then
    raise exception 'This product is used by % job card(s), so it cannot be deleted.', v_jobs;
  end if;
  delete from products where id = p_id;
end $$;

create or replace function delete_job(p_job_no text, p_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare
  j jobs;
begin
  perform _require_user();
  perform _require_write('cutting');
  select * into j from jobs where job_no = p_job_no for update;
  if not found then raise exception 'Job card % does not exist.', p_job_no; end if;
  if j.current_stage <> 'cutting'
     or exists (select 1 from job_material_issues where job_no = p_job_no)
     or exists (select 1 from stage_records where job_no = p_job_no and not (stage = 'cutting' and status = 'Pending'))
     or exists (select 1 from hardness_reports where job_no = p_job_no) then
    raise exception 'Job card % cannot be deleted — it has already started in production.', p_job_no;
  end if;
  delete from movements where job_no = p_job_no;
  delete from activity where job_no = p_job_no;
  delete from stage_records where job_no = p_job_no;
  delete from jobs where job_no = p_job_no;
  perform _log(coalesce(p_ts, now()), 'job', format('Job card %s deleted before production started', p_job_no));
end $$;

create or replace function delete_hardness_report(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_user();
  perform _require_write('qc');
  delete from hardness_reports where id = p_id;      -- readings follow (on delete cascade)
  if not found then raise exception 'Hardness report % does not exist.', p_id; end if;
end $$;

create or replace function delete_dispatch(p_dispatch_no text, p_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare
  d dispatches;
begin
  perform _require_user();
  perform _require_write('dispatch');
  select * into d from dispatches where dispatch_no = p_dispatch_no for update;
  if not found then raise exception 'Dispatch % does not exist.', p_dispatch_no; end if;
  if d.status <> 'Ready for Dispatch' then
    raise exception 'Dispatch % has already left the plant and cannot be deleted.', p_dispatch_no;
  end if;
  update finished_goods set reserved_qty = reserved_qty - d.qty where id = d.fg_id;       -- the packed pieces are free again
  delete from dispatches where dispatch_no = p_dispatch_no;                                -- bags follow (on delete cascade)
  perform _log(coalesce(p_ts, now()), 'dispatch', format('Dispatch %s deleted — %s PCS back to available finished goods', p_dispatch_no, d.qty), d.job_no);
end $$;

revoke all on function delete_inward(text, timestamptz), delete_product(text), delete_job(text, timestamptz), delete_hardness_report(text),
                       delete_dispatch(text, timestamptz) from public, anon;
grant execute on function delete_inward(text, timestamptz), delete_product(text), delete_job(text, timestamptz), delete_hardness_report(text),
                          delete_dispatch(text, timestamptz) to authenticated;
