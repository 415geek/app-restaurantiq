-- Add language field to store user's language preference
ALTER TABLE public.iq_location_reports
ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

-- Add index for language queries
CREATE INDEX IF NOT EXISTS iq_location_reports_language_idx
ON public.iq_location_reports (language);
