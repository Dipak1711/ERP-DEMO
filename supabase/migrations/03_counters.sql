-- 03 · Gap-tolerant document counters (replaces ERPState.counters).
-- JOB-2026-0001, RM-2026-001, FG-2026-0001, DSP-2026-0001, HIR-2026-0001 restart each year.

create table doc_counters (
  kind       text not null,
  year       int  not null default 0,
  last_value int  not null default 0,
  primary key (kind, year)
);

-- Atomic: the row lock taken by ON CONFLICT serialises concurrent callers.
create function next_doc_no(p_kind text, p_year int default 0) returns int
language plpgsql security definer set search_path = public as $$
declare
  v int;
begin
  insert into doc_counters (kind, year, last_value) values (p_kind, p_year, 1)
  on conflict (kind, year) do update set last_value = doc_counters.last_value + 1
  returning last_value into v;
  return v;
end $$;
