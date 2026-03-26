-- Paid location report funnel (B2C) — server writes via service role; RLS deny-all for direct client access.

CREATE TABLE IF NOT EXISTS public.iq_location_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  location TEXT NOT NULL,
  business_type TEXT,
  verdict TEXT NOT NULL,
  headline TEXT NOT NULL,
  reason TEXT NOT NULL,
  full_report_json JSONB,
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_session_id TEXT UNIQUE,
  customer_email TEXT
);

CREATE INDEX IF NOT EXISTS iq_location_reports_created_at_idx ON public.iq_location_reports (created_at DESC);

ALTER TABLE public.iq_location_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'iq_location_reports' AND policyname = 'iq_location_reports_deny_select'
  ) THEN
    CREATE POLICY iq_location_reports_deny_select ON public.iq_location_reports FOR SELECT USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'iq_location_reports' AND policyname = 'iq_location_reports_deny_insert'
  ) THEN
    CREATE POLICY iq_location_reports_deny_insert ON public.iq_location_reports FOR INSERT WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'iq_location_reports' AND policyname = 'iq_location_reports_deny_update'
  ) THEN
    CREATE POLICY iq_location_reports_deny_update ON public.iq_location_reports FOR UPDATE USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'iq_location_reports' AND policyname = 'iq_location_reports_deny_delete'
  ) THEN
    CREATE POLICY iq_location_reports_deny_delete ON public.iq_location_reports FOR DELETE USING (false);
  END IF;
END $$;
