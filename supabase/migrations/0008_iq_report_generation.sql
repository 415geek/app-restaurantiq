-- Background (staged, resumable) paid-report generation + email notification.
-- Every column is additive and nullable/defaulted so this is safe to apply on a
-- live database; the app degrades to the legacy synchronous path until it runs.
alter table public.iq_location_reports
  add column if not exists generation_status text not null default 'idle',
  add column if not exists generation_stage text,
  add column if not exists generation_state_json jsonb,
  add column if not exists generation_error text,
  add column if not exists generation_started_at timestamptz,
  add column if not exists generation_updated_at timestamptz,
  add column if not exists notify_email text,
  add column if not exists notified_at timestamptz;

create index if not exists iq_location_reports_generation_running_idx
  on public.iq_location_reports (generation_updated_at)
  where generation_status = 'running';
