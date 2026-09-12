-- Operator runtime configuration (server-only). Lets the app pick up API keys
-- and feature flags without a Vercel redeploy; values here OVERRIDE process.env
-- for the allow-listed keys in lib/server/runtime-config.ts.
CREATE TABLE IF NOT EXISTS public.iq_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  note       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.iq_settings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='iq_settings' AND policyname='iq_settings_deny_select') THEN
    CREATE POLICY iq_settings_deny_select ON public.iq_settings FOR SELECT USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='iq_settings' AND policyname='iq_settings_deny_insert') THEN
    CREATE POLICY iq_settings_deny_insert ON public.iq_settings FOR INSERT WITH CHECK (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='iq_settings' AND policyname='iq_settings_deny_update') THEN
    CREATE POLICY iq_settings_deny_update ON public.iq_settings FOR UPDATE USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='iq_settings' AND policyname='iq_settings_deny_delete') THEN
    CREATE POLICY iq_settings_deny_delete ON public.iq_settings FOR DELETE USING (false);
  END IF;
END $$;
COMMENT ON TABLE public.iq_settings IS 'Operator runtime config (API keys / flags). Service role only; overrides process.env for allow-listed keys.';
