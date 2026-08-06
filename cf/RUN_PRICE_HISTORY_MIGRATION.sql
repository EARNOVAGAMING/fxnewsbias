-- ============================================================
-- PRICE HISTORY + FORECAST BACKTEST MIGRATION
-- Paste into Supabase SQL Editor and Run. Idempotent.
--
-- Why: the `prices` table is current-only (one row per pair,
-- overwritten every 15 min) — we have no price history, so we
-- cannot backtest forecast signals or calibrate volatility
-- bands. This adds an append-only history table that:
--   1. the */15 cron snapshots into going forward (Phase 0)
--   2. /backfill-prices fills with Twelve Data hourly bars
--      going back months (Phase 1)
--   3. /backtest-forecasts reads to score signal arms
--      (level vs momentum vs inverted) at session horizons
-- ============================================================

create table if not exists price_history (
  id    bigint generated always as identity primary key,
  pair  text        not null,
  price numeric     not null,
  ts    timestamptz not null,
  src   text        not null default 'snapshot'  -- 'snapshot' (15-min cron) | 'backfill' (Twelve Data time_series)
);

-- Dedupe key: one price per pair per timestamp. Makes both the
-- snapshot writer and the backfill fully idempotent (re-runs are
-- no-ops via on_conflict ignore).
create unique index if not exists uq_price_history_pair_ts
  on price_history (pair, ts);

-- The backtest reads per-pair time ranges.
create index if not exists idx_price_history_pair_ts
  on price_history (pair, ts desc);

-- Service-role only: RLS on with no anon policies means the
-- service key (used by the workers) bypasses RLS and anon sees
-- nothing. Same posture as gsc_performance.
alter table price_history enable row level security;
