-- Shared cache for external market-data API calls (Yelp, Foursquare, Census, etc.)
-- so paid-report generation never re-pays for the same address within the TTL.
-- RLS deny-all; server writes/reads via service role.

CREATE TABLE IF NOT EXISTS public.iq_market_cache (
  cache_key TEXT PRIMARY KEY,           -- e.g. "yelp:37.7361,-122.4756:bubble_tea:r=2000"
  source    TEXT NOT NULL,              -- 'yelp' | 'foursquare' | 'google_places' | 'census' | 'deepseek_summary'
  payload   JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,      -- callers decide TTL per source
  bytes     INTEGER                     -- rough size hint for monitoring
);

CREATE INDEX IF NOT EXISTS iq_market_cache_source_idx ON public.iq_market_cache (source);
CREATE INDEX IF NOT EXISTS iq_market_cache_expires_idx ON public.iq_market_cache (expires_at);

ALTER TABLE public.iq_market_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'iq_market_cache' AND policyname = 'iq_market_cache_deny_select'
  ) THEN
    CREATE POLICY iq_market_cache_deny_select ON public.iq_market_cache FOR SELECT USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'iq_market_cache' AND policyname = 'iq_market_cache_deny_insert'
  ) THEN
    CREATE POLICY iq_market_cache_deny_insert ON public.iq_market_cache FOR INSERT WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'iq_market_cache' AND policyname = 'iq_market_cache_deny_update'
  ) THEN
    CREATE POLICY iq_market_cache_deny_update ON public.iq_market_cache FOR UPDATE USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'iq_market_cache' AND policyname = 'iq_market_cache_deny_delete'
  ) THEN
    CREATE POLICY iq_market_cache_deny_delete ON public.iq_market_cache FOR DELETE USING (false);
  END IF;
END $$;

COMMENT ON TABLE public.iq_market_cache IS 'Shared TTL cache for paid external market APIs (Yelp/Foursquare/Census). Server-only via service role.';
