-- 360° paid-report upgrade · Phase 1 data layer.
-- All tables are server-only (RLS deny-all; service role bypasses RLS).

-- Overture Maps Places subset (restaurant / cafe / bakery / bubble tea / grocery / bank / school)
-- loaded per metro by scripts/load_overture.py. Monthly full refresh.
CREATE TABLE IF NOT EXISTS public.iq_poi (
  id            TEXT PRIMARY KEY,               -- Overture GERS id
  metro         TEXT NOT NULL,
  name          TEXT,
  names_json    JSONB,                          -- {primary, common:{zh,...}}
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  taxonomy_path TEXT[],                         -- Overture `taxonomy` (categories fallback while it lands)
  primary_category TEXT,
  operating_status TEXT,                        -- open | closed_temporarily | closed_permanently | unknown
  confidence    DOUBLE PRECISION,
  brand         TEXT,
  address       TEXT,
  sources_json  JSONB,
  sub_cuisine   TEXT,                           -- Phase 3 classifier output (taxonomy id)
  sub_cuisine_confidence DOUBLE PRECISION,
  sub_cuisine_method TEXT,                      -- rule | keyword | llm
  google_place_id TEXT,                         -- D6 dedupe link (permanent per Google ToS)
  first_seen    DATE NOT NULL DEFAULT CURRENT_DATE,
  last_seen     DATE NOT NULL DEFAULT CURRENT_DATE,
  release       TEXT                            -- Overture release tag
);
CREATE INDEX IF NOT EXISTS iq_poi_metro_latlng_idx ON public.iq_poi (metro, lat, lng);
CREATE INDEX IF NOT EXISTS iq_poi_sub_cuisine_idx ON public.iq_poi (metro, sub_cuisine);
CREATE INDEX IF NOT EXISTS iq_poi_google_place_id_idx ON public.iq_poi (google_place_id);

-- Monthly Google review-count snapshots for the traffic proxy (D7).
CREATE TABLE IF NOT EXISTS public.iq_poi_snapshot (
  place_id        TEXT NOT NULL,
  snapshot_month  DATE NOT NULL,               -- first day of month
  metro           TEXT NOT NULL,
  rating          DOUBLE PRECISION,
  user_rating_count INTEGER,
  business_status TEXT,
  PRIMARY KEY (place_id, snapshot_month)
);
CREATE INDEX IF NOT EXISTS iq_poi_snapshot_metro_month_idx ON public.iq_poi_snapshot (metro, snapshot_month);

-- LEHD LODES v8 WAC (workplace area characteristics) at block level, loaded by
-- scripts/load-lodes.ts for the counties of interest.
CREATE TABLE IF NOT EXISTS public.iq_lodes_wac (
  block_geoid TEXT NOT NULL,                   -- 15-digit
  year        INTEGER NOT NULL,
  state       TEXT NOT NULL,
  c000        INTEGER NOT NULL,                -- total jobs
  ca01        INTEGER, ca02 INTEGER, ca03 INTEGER,          -- age bands
  ce01        INTEGER, ce02 INTEGER, ce03 INTEGER,          -- earnings bands
  cns07       INTEGER, cns12 INTEGER, cns15 INTEGER, cns18 INTEGER, -- retail, prof services, education, accommodation/food
  cr04        INTEGER,                                       -- Asian alone
  PRIMARY KEY (block_geoid, year)
);
CREATE INDEX IF NOT EXISTS iq_lodes_wac_prefix_idx ON public.iq_lodes_wac (year, block_geoid text_pattern_ops);

-- Per-report itemized cost (研发提示词 §1.4 第 1 条 / Phase 7).
CREATE TABLE IF NOT EXISTS public.iq_cost_log (
  id          BIGSERIAL PRIMARY KEY,
  report_id   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source      TEXT NOT NULL,                   -- D1..D12 | llm | search | render
  usd         NUMERIC(10,5) NOT NULL,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS iq_cost_log_report_idx ON public.iq_cost_log (report_id);

-- report_model.json (single source of truth) + page narratives + tier live on the report row.
ALTER TABLE public.iq_location_reports
  ADD COLUMN IF NOT EXISTS report_model_json JSONB,
  ADD COLUMN IF NOT EXISTS narrative_json JSONB,
  ADD COLUMN IF NOT EXISTS report_tier TEXT,          -- paid | precheck
  ADD COLUMN IF NOT EXISTS report_cost_usd NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['iq_poi','iq_poi_snapshot','iq_lodes_wac','iq_cost_log'] LOOP
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
