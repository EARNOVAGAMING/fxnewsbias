-- Applied 2026-08-21 as migration: restrict_public_sentiment_to_recent_window
--
-- Why: the sentiment table carried two permissive SELECT policies, both
-- USING (true). The public anon key, which ships in every visitor's browser,
-- could therefore read the entire series back to 2026-05-19. Deep sentiment
-- history is a paid Pro feature, so it was being given away.
--
-- Public reads are now capped at a rolling 31-day window. That is everything
-- the free site actually needs:
--   - homepage market pulse gauge and 24h movers (30-day query, main.js)
--   - bullish/bearish streak counters
--   - latest-8 currency grid
--
-- Pro history (7 / 30 / 90 day charts) is served by
-- POST /api/pro/sentiment-history, which verifies the Firebase ID token,
-- re-checks the subscription server-side, then queries with the service role.
-- service_role has rolbypassrls = true, so this policy does not affect it,
-- nor any cron job.
--
-- Verified after applying, as the anon role:
--   oldest visible row moved from 2026-05-19 to the 31-day boundary
--   rows older than the window visible: 0
--   homepage 30-day query: 500 rows, still working
--   homepage latest-8 query: 8 rows, still working

drop policy if exists "Public read sentiment" on public.sentiment;
drop policy if exists "public_read_sentiment" on public.sentiment;

create policy "public_read_recent_sentiment"
  on public.sentiment
  for select
  to anon, authenticated
  using (created_at > now() - interval '31 days');
