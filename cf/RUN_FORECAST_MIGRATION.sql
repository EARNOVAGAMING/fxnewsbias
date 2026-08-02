-- ============================================================
-- FORECAST INTELLIGENCE PLATFORM — pair_forecasts table
-- Run this once in the Supabase SQL editor (Dashboard → SQL).
-- Immutable forecast ledger: rows are inserted by the cron worker
-- (service key), settled once, and never edited or deleted after.
-- Public (anon) role gets read-only access — the site reads this
-- table directly, the same way it reads sentiment/news/prices.
-- ============================================================

create table if not exists public.pair_forecasts (
  id            bigint generated always as identity primary key,
  pair          text not null,                -- 'EUR/USD'
  forecast_date date not null,                -- UTC date the call was published
  horizon       text not null default '24h',
  direction     text not null,                -- 'Bullish' | 'Bearish' | 'Stand Aside'
  conviction    smallint not null default 0,  -- 0 (stand aside) .. 5
  entry_price   numeric,
  entry_time    timestamptz not null default now(),
  base_score    smallint,                     -- base currency sentiment 0-100
  quote_score   smallint,                     -- quote currency sentiment 0-100
  gap           smallint,                     -- base_score - quote_score
  drivers       jsonb,                        -- frozen evidence at publish time
  narrative     text,                         -- AI-written 2-3 sentence rationale
  status        text not null default 'open', -- 'open' | 'settled'
  result_price  numeric,
  result_time   timestamptz,
  move_pct      numeric,                      -- signed % move entry -> result
  move_pips     numeric,
  outcome       text,                         -- 'hit' | 'miss' | 'flat' | 'na' (stand aside)
  created_at    timestamptz not null default now()
);

-- One forecast per pair per day; generation is idempotent via on_conflict.
create unique index if not exists pair_forecasts_pair_date_uq
  on public.pair_forecasts (pair, forecast_date);

create index if not exists pair_forecasts_status_idx
  on public.pair_forecasts (status);

create index if not exists pair_forecasts_date_idx
  on public.pair_forecasts (forecast_date desc);

alter table public.pair_forecasts enable row level security;

-- Public read-only: the ledger is the product. Writes only via service key.
drop policy if exists "public read pair_forecasts" on public.pair_forecasts;
create policy "public read pair_forecasts"
  on public.pair_forecasts for select
  to anon, authenticated
  using (true);
