-- 16 · Hide, don't mask.
-- Roles without access (qc, operator, viewer) used to get the placeholder '••••••' in confidential text columns.
-- They now get NULL, exactly like the numeric columns, and the app removes the whole column / line / field
-- (title included) instead of showing a placeholder. The views in 13 are unchanged — they call mask_text().
-- Safe to run on a database that already has migrations 01–15.

create or replace function mask_text(p text) returns text
language sql stable as $$
  select case when can_see_confidential() then p end;
$$;
