-- H20/H21: enable realtime for ecer_preparations, debts, debt_payments
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ecer_preparations;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.debts;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.debt_payments;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

ALTER TABLE public.ecer_preparations REPLICA IDENTITY FULL;
ALTER TABLE public.debts REPLICA IDENTITY FULL;
ALTER TABLE public.debt_payments REPLICA IDENTITY FULL;