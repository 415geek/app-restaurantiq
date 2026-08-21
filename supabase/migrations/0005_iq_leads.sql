-- Lead capture for free IQ analysis (email-gated unlock)
-- RLS deny-all; server writes/reads via service role.

CREATE TABLE IF NOT EXISTS public.iq_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  cuisine TEXT,
  location TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  report_id UUID REFERENCES public.iq_location_reports(id) ON DELETE SET NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  user_agent TEXT,
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS iq_leads_email_idx ON public.iq_leads (email);
CREATE INDEX IF NOT EXISTS iq_leads_created_at_idx ON public.iq_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS iq_leads_report_id_idx ON public.iq_leads (report_id);

ALTER TABLE public.iq_leads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'iq_leads' AND policyname = 'iq_leads_deny_select'
  ) THEN
    CREATE POLICY iq_leads_deny_select ON public.iq_leads FOR SELECT USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'iq_leads' AND policyname = 'iq_leads_deny_insert'
  ) THEN
    CREATE POLICY iq_leads_deny_insert ON public.iq_leads FOR INSERT WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'iq_leads' AND policyname = 'iq_leads_deny_update'
  ) THEN
    CREATE POLICY iq_leads_deny_update ON public.iq_leads FOR UPDATE USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'iq_leads' AND policyname = 'iq_leads_deny_delete'
  ) THEN
    CREATE POLICY iq_leads_deny_delete ON public.iq_leads FOR DELETE USING (false);
  END IF;
END $$;
