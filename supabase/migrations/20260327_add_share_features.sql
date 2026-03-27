-- Migration: Add share features for RestaurantIQ
-- Created: 2026-03-27

-- 1. Add market data cache to reports (for Full Report enhancement)
ALTER TABLE iq_location_reports
ADD COLUMN IF NOT EXISTS market_data_json JSONB;

-- 2. Add share tracking fields
ALTER TABLE iq_location_reports
ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS utm_source VARCHAR(50),
ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(50),
ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(100),
ADD COLUMN IF NOT EXISTS referred_by UUID;

-- 3. Create WeChat token cache table
CREATE TABLE IF NOT EXISTS iq_wechat_tokens (
  id SERIAL PRIMARY KEY,
  token_type VARCHAR(20) NOT NULL,
  token_value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_token_type UNIQUE (token_type)
);

-- 4. Create index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_wechat_token_type ON iq_wechat_tokens(token_type);

-- 5. Add foreign key for referral tracking (self-referencing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_referred_by'
  ) THEN
    ALTER TABLE iq_location_reports
    ADD CONSTRAINT fk_referred_by 
    FOREIGN KEY (referred_by) REFERENCES iq_location_reports(id)
    ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN iq_location_reports.market_data_json IS 'Cached Google+Yelp market data from free analysis';
COMMENT ON COLUMN iq_location_reports.share_count IS 'Number of times this report was shared';
COMMENT ON COLUMN iq_location_reports.utm_source IS 'Traffic source (wechat, facebook, etc.)';
COMMENT ON TABLE iq_wechat_tokens IS 'Cache for WeChat JSSDK access_token and jsapi_ticket';
