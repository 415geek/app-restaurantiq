-- Add user_id field to link reports to Clerk users

ALTER TABLE public.iq_location_reports 
ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS iq_location_reports_user_id_idx 
ON public.iq_location_reports (user_id);

CREATE INDEX IF NOT EXISTS iq_location_reports_paid_user_idx 
ON public.iq_location_reports (user_id, paid) WHERE paid = true;
