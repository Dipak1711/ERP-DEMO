-- 09 · Die management. Forging and trimming dies share one table (`kind`), as they share one shape in the app.
-- Nothing is ever deleted: dies become Retired / Damaged, main dies become Inactive.

create table main_dies (
  code        text primary key check (code ~ '^DIE-[0-9]{4,}$'),   -- DIE-0001
  name        text not null check (btrim(name) <> ''),
  part_code   text not null check (btrim(part_code) <> ''),
  description text not null default '',
  customer    text not null default '',
  metal       metal_type not null default 'Brass',
  created_on  date not null,
  status      main_die_status not null default 'Active',
  remarks     text not null default '',
  is_demo     boolean not null default false,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index main_dies_part_code_key on main_dies (lower(btrim(part_code)));
create trigger main_dies_updated before update on main_dies for each row execute function set_updated_at();

create table dies (
  code             text primary key,                       -- FGD-0001 / TRD-0001 (assigned by trigger when null)
  kind             die_kind not null,
  main_code        text not null references main_dies (code),
  material         text not null check (btrim(material) <> ''),   -- tool steel: H13, D2 …
  top_l            numeric(8, 2) check (top_l    is null or top_l    >= 0),   -- mm
  top_w            numeric(8, 2) check (top_w    is null or top_w    >= 0),
  top_h            numeric(8, 2) check (top_h    is null or top_h    >= 0),
  bottom_l         numeric(8, 2) check (bottom_l is null or bottom_l >= 0),
  bottom_w         numeric(8, 2) check (bottom_w is null or bottom_w >= 0),
  bottom_h         numeric(8, 2) check (bottom_h is null or bottom_h >= 0),
  top_weight       numeric(8, 2) check (top_weight    is null or top_weight    >= 0),  -- kg
  bottom_weight    numeric(8, 2) check (bottom_weight is null or bottom_weight >= 0),
  making_date      date not null,
  maker            text not null check (btrim(maker) <> ''),
  drawing_no       text not null default '',
  revision         text not null default 'R0',
  top_img_path     text,                                   -- Storage: die-images/<path>
  bottom_img_path  text,
  status           die_status not null default 'Available',
  remarks          text not null default '',
  location         text not null default '',
  cost             numeric(12, 2) check (cost is null or cost >= 0),
  pieces           int not null default 0 check (pieces >= 0),   -- production pieces so far
  last_maint_date  date,
  maint_remarks    text,
  replaces_code    text references dies (code),
  replaced_by_code text references dies (code),
  is_demo          boolean not null default false,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint die_code_matches_kind check (
    (kind = 'forging'  and code ~ '^FGD-[0-9]{4,}$') or
    (kind = 'trimming' and code ~ '^TRD-[0-9]{4,}$')
  )
);
create trigger dies_updated before update on dies for each row execute function set_updated_at();
create index dies_main_idx   on dies (main_code, kind);
create index dies_status_idx on dies (status);

-- timeline shown on Die Details / History
create table die_history (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),   -- ordering
  date      date not null default current_date,   -- shown date (can be back-dated)
  kind      die_kind not null,
  die_code  text not null references dies (code),
  main_code text not null references main_dies (code),
  event     text not null,
  remarks   text not null default '',
  is_demo   boolean not null default false
);
create index die_history_die_idx  on die_history (die_code, at desc);
create index die_history_main_idx on die_history (main_code, at desc);

create table die_maintenance (
  id       bigint generated always as identity primary key,
  die_code text not null references dies (code),
  date     date not null,
  remarks  text not null check (btrim(remarks) <> ''),
  is_demo  boolean not null default false
);
create index die_maint_die_idx on die_maintenance (die_code, date desc);

create table die_issues (
  id             bigint generated always as identity primary key,
  die_code       text not null references dies (code),
  issued_on      date not null,
  issued_to      text not null check (btrim(issued_to) <> ''),   -- press / person
  remarks        text not null default '',
  returned_on    date,
  pieces         int check (pieces is null or pieces >= 0),      -- produced during this issue
  return_remarks text,
  is_demo        boolean not null default false,
  check (returned_on is null or returned_on >= issued_on)
);
create index die_issues_die_idx on die_issues (die_code, issued_on desc);
-- a die can be out on only one issue at a time
create unique index die_issues_one_open on die_issues (die_code) where returned_on is null;
