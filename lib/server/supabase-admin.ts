import { createClient } from '@supabase/supabase-js';
import { envValue } from '@/lib/env-value';

type Env = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

function getEnv(): Required<Env> {
  const url = envValue('SUPABASE_URL');
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Supabase admin env is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  return { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key };
}

export function supabaseAdmin() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
