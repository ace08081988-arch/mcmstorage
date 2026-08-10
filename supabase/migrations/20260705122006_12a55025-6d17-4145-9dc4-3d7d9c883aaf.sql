ALTER TABLE public.debts DROP CONSTRAINT debts_source_check;
ALTER TABLE public.debts ADD CONSTRAINT debts_source_check CHECK (source = ANY (ARRAY['manual','purchase','sale','request_prep']));