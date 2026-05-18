-- Append-only log of every cron step execution.
-- Used by the admin dashboard to display reliability history per step.
-- Each step (sentiment, pairSEO, currencySEO, cleanup) writes one row per
-- 3-hour cycle. Queried by step_name + cycle_timestamp for the dashboard.
--
-- Apply once in the Supabase SQL editor before deploying the updated worker.

create table if not exists step_runs (
  id               bigserial primary key,
  step_name        text not null,
  started_at       timestamptz not null,
  ended_at         timestamptz,
  duration_seconds int,
  status           text not null check (status in ('success', 'failed', 'partial')),
  error_message    text,
  retry_attempt    int not null default 1,
  cycle_timestamp  timestamptz not null,
  created_at       timestamptz not null default now()
);

create index if not exists step_runs_step_name_idx       on step_runs(step_name);
create index if not exists step_runs_cycle_timestamp_idx on step_runs(cycle_timestamp desc);
create index if not exists step_runs_created_at_idx      on step_runs(created_at desc);
