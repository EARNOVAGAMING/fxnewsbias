-- ============================================================
-- WEB PUSH V1 MIGRATION  (applied 2026-08-14 via MCP)
-- Kept in the repo as the canonical record. Idempotent.
--
-- Web Push is a DELIVERY LAYER ONLY. No FXNB intelligence lives here:
-- significance comes from session_bias.strength >= 4 (written by the
-- existing generateSessionBias) and content/link come from the existing
-- insight article + articles.json. Nothing is recalculated.
--
-- Two tables + one atomic claim function:
--   push_subscriptions — 1:N, one row per browser/device per user
--   push_log           — one row per (user, day, session); the audit trail
--                        AND the enforcement surface for the 3/day cap
--   claim_push_slot()  — advisory-locked, concurrency-safe claim
-- ============================================================

create table if not exists push_subscriptions (
  id            bigint generated always as identity primary key,
  user_email    text not null,
  endpoint      text not null,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_success  timestamptz,
  last_failure  timestamptz,
  failure_count int not null default 0
);

create unique index if not exists uq_push_sub_endpoint on push_subscriptions (endpoint);
create index if not exists idx_push_sub_user_active on push_subscriptions (user_email) where active;

create table if not exists push_log (
  id           bigint generated always as identity primary key,
  user_email   text not null,
  sent_date    date not null,
  session      text not null,
  slug         text,
  sent_at      timestamptz not null default now(),
  devices_sent int not null default 0
);

create unique index if not exists uq_push_log_user_day_session
  on push_log (user_email, sent_date, session);
create index if not exists idx_push_log_user_day on push_log (user_email, sent_date);

-- Service-role only. No anon/authenticated policies: subscription secrets
-- (p256dh/auth) must never be readable by any browser. Mirrors the
-- price_history / gsc_performance posture.
alter table push_subscriptions enable row level security;
alter table push_log enable row level security;

-- ATOMIC 3/day cap + per-session idempotency in a single call.
--
-- WHY THE ADVISORY LOCK: a naive "SELECT count(); if < 3 then INSERT" is not
-- safe — two concurrent worker invocations can both read used=2 and both
-- insert, yielding 4 notifications. pg_advisory_xact_lock serializes claims
-- per (user, day); it is released automatically at transaction end, and
-- PostgREST runs each RPC call in its own transaction.
-- The unique index on (user_email, sent_date, session) is the backstop that
-- makes duplicate-session inserts impossible even if the lock were bypassed.
create or replace function claim_push_slot(
  p_email   text,
  p_session text,
  p_slug    text,
  p_cap     int default 3
) returns table (claimed boolean, reason text, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := (now() at time zone 'utc')::date;
  v_used int;
begin
  perform pg_advisory_xact_lock(hashtext(p_email || ':' || v_date::text));

  if exists (select 1 from push_log
              where user_email = p_email and sent_date = v_date and session = p_session) then
    select count(*) into v_used from push_log where user_email = p_email and sent_date = v_date;
    return query select false, 'already_sent_this_session'::text, v_used;
    return;
  end if;

  select count(*) into v_used from push_log where user_email = p_email and sent_date = v_date;
  if v_used >= p_cap then
    return query select false, 'daily_cap_reached'::text, v_used;
    return;
  end if;

  insert into push_log (user_email, sent_date, session, slug)
  values (p_email, v_date, p_session, p_slug);

  return query select true, 'claimed'::text, v_used + 1;
end;
$$;

revoke all on function claim_push_slot(text, text, text, int) from public, anon, authenticated;
