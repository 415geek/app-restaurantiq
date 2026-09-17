-- 评审 Spec v2 §4.8 物业与许可数据：辖区数据代理 (Jurisdiction Data Agent)
--
-- `jurisdiction_registry` maps a county FIPS (or place GEOID) to the endpoints
-- that answer the evidence ladder for a storefront:
--   E1 health-department food-facility permits   (proves prior food use)
--   E2 building / mechanical permits with hood, grease interceptor, exhaust
--   E4 county assessor use code / year built     (context only — never a hood inference)
-- E3 (prior tenant concept) comes from lib/funnel/external-data/site-history.ts
-- and needs no registry row; E5 (listing blurbs) is never a source of facts.
--
-- 关键设计约束 (§4.8.2 / §4.8.4): report generation only ever READS this table.
-- An unknown jurisdiction takes the declared fallback path immediately;
-- discovery runs asynchronously and writes a draft row (verified_by='auto').
-- A discovery run that finds nothing still writes a row with adapters = '[]'
-- and the reason in `notes`, so the next report does not retry.
--
-- NOTE: the spec calls this migration 0010; 0010/0011 were already taken by
-- iq_settings / iq_source_candidates, so it lands as 0012.
--
-- Server-only (RLS deny-all; the service role bypasses RLS).

CREATE TABLE IF NOT EXISTS public.iq_jurisdiction_registry (
  jurisdiction_id TEXT PRIMARY KEY,                         -- 5-digit county FIPS or 7-digit place GEOID
  name            TEXT NOT NULL,
  adapters        JSONB NOT NULL DEFAULT '[]'::jsonb,       -- [{evidence,type,endpoint,address_field?,keyword_filter?,license,fields?}]
  coverage_score  NUMERIC(4,3) NOT NULL DEFAULT 0,          -- 0..1
  verified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by     TEXT NOT NULL DEFAULT 'auto',             -- auto | human
  notes           TEXT,                                     -- why the row looks like this (incl. discovery failure reason)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT iq_jurisdiction_registry_id_chk CHECK (jurisdiction_id ~ '^[0-9]{5}$' OR jurisdiction_id ~ '^[0-9]{7}$'),
  CONSTRAINT iq_jurisdiction_registry_verified_by_chk CHECK (verified_by IN ('auto', 'human')),
  CONSTRAINT iq_jurisdiction_registry_coverage_chk CHECK (coverage_score >= 0 AND coverage_score <= 1),
  CONSTRAINT iq_jurisdiction_registry_adapters_chk CHECK (jsonb_typeof(adapters) = 'array')
);

CREATE INDEX IF NOT EXISTS iq_jurisdiction_registry_verified_idx
  ON public.iq_jurisdiction_registry (verified_by, coverage_score DESC);

DO $$
DECLARE t TEXT := 'iq_jurisdiction_registry';
BEGIN
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
END $$;

COMMENT ON TABLE public.iq_jurisdiction_registry IS
  '评审 Spec v2 §4.8 辖区数据代理：county FIPS / place GEOID → 许可与评估数据端点。报告只读；discovery 异步写入 verified_by=auto 草稿行。';
COMMENT ON COLUMN public.iq_jurisdiction_registry.adapters IS
  '[{evidence:E1|E2|E4, type:socrata|arcgis_rest|ckan|accela|national_parcel|none, endpoint, address_field?, keyword_filter?, license, fields?}]；空数组 = 该辖区已确认无可用端点（原因见 notes）。';
COMMENT ON COLUMN public.iq_jurisdiction_registry.coverage_score IS
  '0..1，端点齐备时该辖区能回答证据阶梯的比例；乘以本次实际应答的适配器比例后得到报告里的 jurisdiction_coverage。';

-- ---------------------------------------------------------------------------
-- §4.8.7 冷启动 · P0 only: SF / San Mateo / Santa Clara / Alameda.
-- Mirrors SEED_REGISTRY in lib/iq/jurisdiction/registry.ts. Later batches are
-- added as DATA ROWS here (or by discovery), never as code changes.
-- Endpoints that are not confidently known are LEFT OUT — no invented dataset
-- ids. Those counties therefore read as 「本辖区许可数据未接入」 until filled.
-- ---------------------------------------------------------------------------

INSERT INTO public.iq_jurisdiction_registry
  (jurisdiction_id, name, adapters, coverage_score, verified_at, verified_by, notes)
VALUES
  (
    '06075',
    'City and County of San Francisco',
    '[
      {
        "evidence": "E1",
        "type": "socrata",
        "endpoint": "https://data.sfgov.org/resource/pyih-qa8i.json",
        "address_field": "business_address",
        "license": "Public domain — DataSF open data (City and County of San Francisco)",
        "fields": {"facility_name": "business_name", "permit_type": "business_name", "date": "inspection_date"}
      },
      {
        "evidence": "E2",
        "type": "socrata",
        "endpoint": "https://data.sfgov.org/resource/i98e-djp9.json",
        "address_field": "street_name",
        "keyword_filter": ["type i hood","type 1 hood","hood","grease interceptor","grease trap","kitchen exhaust","commercial kitchen","exhaust duct","ansul","make up air","makeup air"],
        "license": "Public domain — DataSF open data (City and County of San Francisco)",
        "fields": {"street_number": "street_number", "street_name": "street_name", "description": "description", "permit_type": "permit_type_definition", "status": "status", "date": "permit_creation_date"}
      },
      {
        "evidence": "E4",
        "type": "socrata",
        "endpoint": "https://data.sfgov.org/resource/wv5m-vpq2.json",
        "address_field": "property_location",
        "license": "Public domain — DataSF open data (City and County of San Francisco)",
        "fields": {"year_built": "year_property_built", "use_code": "property_class_code"}
      }
    ]'::jsonb,
    0.800,
    '2026-09-17T00:00:00Z',
    'auto',
    'DataSF 数据集 ID 由冷启动 seed 写入，尚未人工核验；一次成功的 E1/E2 取数后应由运营把 verified_by 改为 human。'
  ),
  (
    '06081',
    'San Mateo County',
    '[
      {
        "evidence": "E4",
        "type": "national_parcel",
        "endpoint": "https://app.regrid.com/api/v2/parcels/address",
        "address_field": "path",
        "license": "Commercial API (Regrid national parcel) — internal reasoning only, not redistributable",
        "fields": {"year_built": "yearbuilt", "use_code": "usedesc"}
      }
    ]'::jsonb,
    0.150,
    '2026-09-17T00:00:00Z',
    'auto',
    '尚未接入：San Mateo County 环境健康许可 / 建筑许可的开放数据端点未经核验，不编造数据集 ID。E4 仅声明 national_parcel（商用 API，未实现）。待 discovery 或人工补录。'
  ),
  (
    '06085',
    'Santa Clara County',
    '[
      {
        "evidence": "E4",
        "type": "national_parcel",
        "endpoint": "https://app.regrid.com/api/v2/parcels/address",
        "address_field": "path",
        "license": "Commercial API (Regrid national parcel) — internal reasoning only, not redistributable",
        "fields": {"year_built": "yearbuilt", "use_code": "usedesc"}
      }
    ]'::jsonb,
    0.150,
    '2026-09-17T00:00:00Z',
    'auto',
    '尚未接入：Santa Clara County 食品设施许可 / 机械许可端点未经核验，不编造数据集 ID。待 discovery 或人工补录。'
  ),
  (
    '06001',
    'Alameda County',
    '[
      {
        "evidence": "E4",
        "type": "national_parcel",
        "endpoint": "https://app.regrid.com/api/v2/parcels/address",
        "address_field": "path",
        "license": "Commercial API (Regrid national parcel) — internal reasoning only, not redistributable",
        "fields": {"year_built": "yearbuilt", "use_code": "usedesc"}
      }
    ]'::jsonb,
    0.150,
    '2026-09-17T00:00:00Z',
    'auto',
    '尚未接入：Alameda County 食品设施许可 / 机械许可端点未经核验，不编造数据集 ID。待 discovery 或人工补录。'
  )
ON CONFLICT (jurisdiction_id) DO NOTHING;
