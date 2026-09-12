-- Source-gap agent (lib/iq/ops/source-gap-agent.ts).
-- Candidate data sources found by web search for report sources (D1..D12) that
-- keep coming back partial / failed, plus one row per agent run. Candidates
-- are never adopted automatically: an operator reviews `status`.
-- Server-only (RLS deny-all; the service role bypasses RLS).

CREATE TABLE IF NOT EXISTS public.iq_source_candidates (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gap_source    TEXT NOT NULL,                       -- D1..D12 (lib/iq/data/types.ts DataSourceId)
  metro         TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL UNIQUE,                -- normalized; dedupe key across runs
  publisher     TEXT,                                -- hostname
  license_hint  TEXT,                                -- license words seen in title / snippet
  coverage_hint TEXT,                                -- metro / county names seen in title / snippet
  discovered_by TEXT NOT NULL DEFAULT 'web_search',
  score         NUMERIC(4,3),                        -- heuristic 0..1 (gov / edu / open-data / license words)
  status        TEXT NOT NULL DEFAULT 'new',         -- new | reviewed | adopted | rejected
  notes         TEXT,
  CONSTRAINT iq_source_candidates_status_chk CHECK (status IN ('new', 'reviewed', 'adopted', 'rejected'))
);
CREATE INDEX IF NOT EXISTS iq_source_candidates_metro_gap_idx ON public.iq_source_candidates (metro, gap_source, status);
CREATE INDEX IF NOT EXISTS iq_source_candidates_status_idx ON public.iq_source_candidates (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.iq_source_gap_runs (
  id                  BIGSERIAL PRIMARY KEY,
  run_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reports_scanned     INTEGER NOT NULL DEFAULT 0,
  reports_regenerated INTEGER NOT NULL DEFAULT 0,
  candidates_added    INTEGER NOT NULL DEFAULT 0,
  cost_usd            NUMERIC(10,5) NOT NULL DEFAULT 0,
  notes               JSONB                          -- {metro, gaps, regenerated, improved, queries, ...}
);
CREATE INDEX IF NOT EXISTS iq_source_gap_runs_run_at_idx ON public.iq_source_gap_runs (run_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['iq_source_candidates','iq_source_gap_runs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_deny_select') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (false)', t||'_deny_select', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_deny_insert') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (false)', t||'_deny_insert', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_deny_update') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (false)', t||'_deny_update', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_deny_delete') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (false)', t||'_deny_delete', t);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE public.iq_source_candidates IS 'Data-source candidates discovered by the weekly source-gap agent; reviewed by hand (status), never auto-adopted.';
COMMENT ON TABLE public.iq_source_gap_runs IS 'One row per source-gap agent run (reports scanned / regenerated, candidates added, cost).';
