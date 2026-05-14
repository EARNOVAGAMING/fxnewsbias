-- =========================================================================
-- ONE-TIME MIGRATIONS — paste this whole file into Supabase SQL Editor
-- =========================================================================
-- Why: cron worker logs at 06:00 UTC on 2026-05-14 showed PGRST205 errors:
--   "Could not find the table 'public.system_state'"
--   "Could not find the table 'public.staleness_incidents'"
--   "Could not find the table 'public.cleanup_runs'"
--
-- Until these 3 tables exist, the staleness alerter has no place to store
-- "I already alerted for incident X", so every */15-min staleness check
-- that detects stale data will re-fire Telegram. Cleanup history is also
-- lost. Running this file once fixes both.
--
-- How to run:
--   1. Open https://supabase.com/dashboard → your project → SQL Editor
--   2. Paste the entire contents of this file
--   3. Click "Run"
--   4. Should see "Success. No rows returned" 3 times
-- =========================================================================


-- ---- 1) system_state ----------------------------------------------------
create table if not exists public.system_state (
    key        text        primary key,
    value      jsonb       not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

create or replace function public.system_state_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists system_state_set_updated_at on public.system_state;
create trigger system_state_set_updated_at
before update on public.system_state
for each row execute function public.system_state_touch_updated_at();

alter table public.system_state enable row level security;


-- ---- 2) staleness_incidents --------------------------------------------
create table if not exists public.staleness_incidents (
    id           bigserial   primary key,
    key          text        not null,
    started_at   timestamptz not null default now(),
    resolved_at  timestamptz,
    duration_ms  bigint,
    summary      jsonb       not null default '{}'::jsonb
);

create index if not exists staleness_incidents_key_started_at_idx
    on public.staleness_incidents (key, started_at desc);

alter table public.staleness_incidents enable row level security;


-- ---- 3) cleanup_runs ----------------------------------------------------
create table if not exists public.cleanup_runs (
    id              bigserial   primary key,
    table_name      text        not null,
    ran_at          timestamptz not null default now(),
    deleted_count   integer,
    cutoff          timestamptz,
    retention_days  integer,
    ok              boolean     not null default true,
    error           text,
    extra           jsonb       not null default '{}'::jsonb
);

create index if not exists cleanup_runs_table_ran_at_idx
    on public.cleanup_runs (table_name, ran_at desc);

alter table public.cleanup_runs enable row level security;


-- ---- Verification (optional) -------------------------------------------
-- Run this after the above to confirm all 3 tables exist:
--   select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('system_state','staleness_incidents','cleanup_runs')
--   order by table_name;
-- Expected: all 3 rows.
