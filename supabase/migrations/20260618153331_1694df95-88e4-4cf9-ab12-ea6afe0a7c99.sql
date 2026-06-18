ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS email_cc TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS email_bcc TEXT;