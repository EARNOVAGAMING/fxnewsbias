-- One-time setup for the staleness alerting state used by
-- checkSentimentFreshness() in cf/cron_worker.js.
-- Apply once in the Supabase SQL editor before enabling the check;
-- without it, the dedupe state cannot be persisted and alerts will
-- repeat on every scheduled invocation.
create table if not exists system_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
