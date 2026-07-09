-- M27: FK verified_by → auth.users (ON DELETE SET NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='prep_submissions_verified_by_fkey'
  ) THEN
    ALTER TABLE public.prep_submissions
      ADD CONSTRAINT prep_submissions_verified_by_fkey
      FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='request_preparations_verified_by_fkey'
  ) THEN
    ALTER TABLE public.request_preparations
      ADD CONSTRAINT request_preparations_verified_by_fkey
      FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='ecer_preparations_verified_by_fkey'
  ) THEN
    ALTER TABLE public.ecer_preparations
      ADD CONSTRAINT ecer_preparations_verified_by_fkey
      FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- M26: Realtime publication — add missing tables + REPLICA IDENTITY FULL
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_requests','subscriptions','ready_packages','statuses','user_roles']
  LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;