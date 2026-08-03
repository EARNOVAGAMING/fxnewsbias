-- Forecast access lockdown — restrict anon/authenticated reads of
-- pair_forecasts to SETTLED rows only (the public track record).
--
-- WHY: today's OPEN live forecast calls (direction, entry, conviction,
-- drivers, narrative) are the paid Pro product. Previously the RLS policy
-- "public read pair_forecasts" granted SELECT to {anon, authenticated} with
-- USING (true), so any free user — or a plain curl with the public anon key —
-- could read every open call. Frontend locking was cosmetic only.
--
-- All browsers (free AND Pro) share one Supabase anon key, so RLS cannot tell
-- them apart. Pro identity is only verifiable server-side via the Firebase ID
-- token, so open calls are now served exclusively through the Pro-gated worker
-- endpoint GET /api/forecasts (service_role, which BYPASSES RLS). The SSR
-- track record, /api/forecasts and /api/forecasts/summary all use the service
-- key and are unaffected by this policy.

DROP POLICY IF EXISTS "public read pair_forecasts" ON public.pair_forecasts;

CREATE POLICY "public read settled forecasts" ON public.pair_forecasts
  FOR SELECT
  TO anon, authenticated
  USING (status = 'settled');
