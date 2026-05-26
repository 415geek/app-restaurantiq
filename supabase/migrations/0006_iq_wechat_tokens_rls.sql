-- Enable RLS + deny-all policy on iq_wechat_tokens.
-- This table is service-role only (WeChat JSSDK access_token / jsapi_ticket cache);
-- RLS was disabled, leaving rows readable via the anon key. Fix that here.

ALTER TABLE public.iq_wechat_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'iq_wechat_tokens'
      AND policyname = 'iq_wechat_tokens_deny_all'
  ) THEN
    CREATE POLICY iq_wechat_tokens_deny_all
      ON public.iq_wechat_tokens
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;
