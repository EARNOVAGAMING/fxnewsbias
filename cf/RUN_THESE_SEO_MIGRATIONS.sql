-- =========================================================================
-- SEO FEEDBACK-LOOP MIGRATIONS (Sprint 0) — paste into Supabase SQL Editor
-- =========================================================================
-- Why: the E1 Search Console ingest (cf/cron_worker.js → ingestGscPerformance,
-- runs daily at 03:15 UTC inside the "15 */3" cleanup cron) UPSERTs into
-- public.gsc_performance, but that table was never created by a committed
-- migration. If it doesn't exist, every ingest silently 404s inside the
-- cron's .catch() and NO Search Console data is stored — so the whole
-- "self-improving" loop has no data to learn from.
--
-- This file:
--   1) gsc_performance      — the table the E1 ingest writes to (UNBLOCKS E1)
--   2) seo_title_history    — audit log of every <title>/meta change we make,
--                             so title edits become measurable (enables Sprint 1
--                             performance-gated title updates)
--   3) page_performance_7d  — a zero-maintenance VIEW aggregating the last
--                             finalised ~7 days of per-page GSC metrics, used
--                             to decide which pages to leave alone vs. rewrite
--
-- Safe to run more than once (all statements are idempotent / IF NOT EXISTS).
-- Does NOT touch any cron trigger, worker code, or existing table.
--
-- How to run:
--   1. https://supabase.com/dashboard → project → SQL Editor
--   2. Paste this whole file → Run
--   3. Expect "Success. No rows returned"
-- =========================================================================


-- ---- 1) gsc_performance -------------------------------------------------
-- Column set + conflict target must match ingestGscPerformance() exactly:
--   row  = { date, dimension, key, clicks, impressions, ctr, position, fetched_at }
--   POST = .../gsc_performance?on_conflict=date,dimension,key
--          Prefer: resolution=merge-duplicates
-- A surrogate bigserial id is the PK (matches this codebase's table style);
-- the (date, dimension, key) UNIQUE constraint is what on_conflict targets.
create table if not exists public.gsc_performance (
    id           bigserial        primary key,
    date         date             not null,
    dimension    text             not null check (dimension in ('query','page')),
    key          text             not null,
    clicks       integer          not null default 0,
    impressions  integer          not null default 0,
    ctr          double precision not null default 0,
    position     double precision not null default 0,
    fetched_at   timestamptz      not null default now(),
    constraint gsc_performance_date_dim_key_uniq unique (date, dimension, key)
);

-- Time-window scans per dimension (e.g. "last 7 days of pages")
create index if not exists gsc_performance_dim_date_idx
    on public.gsc_performance (dimension, date desc);
-- Per-key history lookups (e.g. "how has this URL / this query trended")
create index if not exists gsc_performance_key_idx
    on public.gsc_performance (key);

alter table public.gsc_performance enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'gsc_performance' and policyname = 'gsc_performance_service_all'
  ) then
    execute 'create policy "gsc_performance_service_all" on public.gsc_performance for all using (true) with check (true)';
  end if;
end $$;


-- ---- 2) seo_title_history ----------------------------------------------
-- Append one row every time the cron rewrites a page <title>/meta/H1, so a
-- title change becomes an event we can correlate against gsc_performance
-- before/after. Without this there is no way to learn which titles worked,
-- which blocks all performance-gated optimisation.
create table if not exists public.seo_title_history (
    id          bigserial   primary key,
    slug        text        not null,             -- 'eur-usd' | 'ccy-usd' | insight slug
    kind        text        not null default 'unknown'
                            check (kind in ('pair','currency','insight','unknown')),
    path        text,                             -- e.g. 'pairs/eur-usd/index.html'
    old_title   text,
    new_title   text        not null,
    reason      text,                             -- 'scheduled' | 'ctr_gap' | 'stuck_page2' | ...
    changed_at  timestamptz not null default now()
);

create index if not exists seo_title_history_slug_changed_idx
    on public.seo_title_history (slug, changed_at desc);

alter table public.seo_title_history enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'seo_title_history' and policyname = 'seo_title_history_service_all'
  ) then
    execute 'create policy "seo_title_history_service_all" on public.seo_title_history for all using (true) with check (true)';
  end if;
end $$;


-- ---- 3) page_performance_7d (VIEW) -------------------------------------
-- Rolling per-page rollup of the last finalised ~7 days (GSC lags ~2-3d, so
-- the window is date >= current_date - 9). Position is impression-weighted so
-- a single high-impression day doesn't get averaged away by a thin one.
-- This is what Sprint 1 reads to decide "leave alone vs. rewrite":
--   protect  = position <= 3 AND ctr healthy   (do NOT churn winners)
--   rewrite  = impressions > 0 AND position between 8 and 20 (stuck), or
--              ctr well below the expected curve for its position.
create or replace view public.page_performance_7d as
select
    key                                                             as url,
    sum(clicks)::bigint                                             as clicks,
    sum(impressions)::bigint                                        as impressions,
    case when sum(impressions) > 0
         then sum(clicks)::double precision / sum(impressions)
         else 0 end                                                 as ctr,
    case when sum(impressions) > 0
         then sum(position * impressions) / sum(impressions)
         else 0 end                                                 as position,
    max(date)                                                       as last_date
from public.gsc_performance
where dimension = 'page'
  and date >= (current_date - interval '9 days')
group by key;


-- ---- Verification (optional) -------------------------------------------
-- select table_name from information_schema.tables
--   where table_schema='public' and table_name in ('gsc_performance','seo_title_history')
--   order by table_name;                              -- expect 2 rows
-- select count(*) as gsc_rows from public.gsc_performance;    -- 0 until next 03:15 ingest
-- select * from public.page_performance_7d order by impressions desc limit 20;
