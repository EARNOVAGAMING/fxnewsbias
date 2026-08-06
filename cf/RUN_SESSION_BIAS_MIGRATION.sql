-- ============================================================
-- SESSION BIAS SCORECARD MIGRATION  (applied 2026-08-06 via MCP)
-- Kept in the repo as the canonical record. Idempotent.
--
-- Why: the 91-day backtest (~5,400 weekday observations, 3 signal
-- arms x 3 horizons, decorrelated + overlapping) showed sentiment
-- has NO tradeable directional edge — every arm's average signed
-- move was under 1 pip and the "winner" flipped across horizons.
-- Conviction anti-correlated with outcome (extreme readings mean-
-- revert). So the product pivots from "forecasts" (trade calls) to
-- an honest scorecard: record the news tone per session, then score
-- whether the market moved WITH or AGAINST it. Reporting, not
-- signals. The old pair_forecasts ledger stays frozen (immutable).
-- ============================================================

create table if not exists session_bias (
  id           bigint generated always as identity primary key,
  pair         text not null,
  session_date date not null,
  session      text not null check (session in ('asean','london','newyork')),
  tone         text not null check (tone in ('Bullish','Bearish','Neutral')),
  strength     smallint not null default 0 check (strength between 0 and 5),
  base_score   numeric,
  quote_score  numeric,
  gap          numeric,
  drivers      jsonb,
  narrative    text,
  entry_price  numeric,
  entry_time   timestamptz not null default now(),
  band_pct     numeric,          -- vol-scaled "quiet" threshold frozen at publish
  status       text not null default 'open' check (status in ('open','settled')),
  result_price numeric,
  result_time  timestamptz,
  move_pct     numeric,
  move_pips    numeric,
  alignment    text check (alignment in ('aligned','contra','quiet','na'))
);

create unique index if not exists uq_session_bias
  on session_bias (pair, session_date, session);
create index if not exists idx_session_bias_status
  on session_bias (status, entry_time);

alter table session_bias enable row level security;

-- Public sees the settled scorecard only; live session reads are the Pro
-- product, served exclusively through the Firebase-token-gated worker
-- endpoint (service role bypasses RLS). Mirrors the pair_forecasts lockdown.
drop policy if exists "public read settled session bias" on session_bias;
create policy "public read settled session bias" on session_bias
  for select to anon, authenticated
  using (status = 'settled');

-- Per-pair volatility band: k * stddev of pct moves over the horizon,
-- weekday bars, last N days, downsampled to <=1 bar/hour so mixed
-- 1h-backfill and 15-min-snapshot data don't skew the sample.
create or replace function pair_vol_bands(
  horizon_hours int default 6, lookback_days int default 30, k numeric default 0.25
) returns table (pair text, band_pct numeric)
language sql stable as $$
  with base as (
    select ph.pair, ph.ts, ph.price
    from price_history ph
    where ph.ts >= now() - make_interval(days => lookback_days)
      and extract(dow from ph.ts) between 1 and 5
      and extract(minute from ph.ts) < 15
  ),
  r as (
    select b.pair, ((x.price - b.price) / b.price * 100) as ret
    from base b
    join lateral (
      select p.price from price_history p
      where p.pair = b.pair
        and p.ts between b.ts + make_interval(hours => horizon_hours) - interval '45 min'
                     and b.ts + make_interval(hours => horizon_hours) + interval '45 min'
      order by abs(extract(epoch from p.ts - (b.ts + make_interval(hours => horizon_hours)))) limit 1
    ) x on true
  )
  select r.pair, round((stddev_samp(r.ret) * k)::numeric, 4)
  from r group by r.pair having count(*) >= 30
$$;
