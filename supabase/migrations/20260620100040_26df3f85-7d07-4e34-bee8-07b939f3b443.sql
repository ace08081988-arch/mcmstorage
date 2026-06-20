
CREATE OR REPLACE FUNCTION public.prep_upload_allowed(_share_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.prep_tasks t
      JOIN public.prep_upload_grants g ON g.share_token = t.share_token
     WHERE t.share_token = _share_token
       AND t.status = 'active'
       AND t.expires_at > now()
       AND g.expires_at > now()
  )
$$;

REVOKE ALL ON FUNCTION public.prep_upload_allowed(text) FROM public;
GRANT EXECUTE ON FUNCTION public.prep_upload_allowed(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "prep-photos guarded insert" ON storage.objects;
CREATE POLICY "prep-photos guarded insert"
  ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'prep-photos'
    AND public.prep_upload_allowed((storage.foldername(storage.objects.name))[1])
  );

DROP POLICY IF EXISTS "read upload grants" ON public.prep_upload_grants;
REVOKE SELECT ON public.prep_upload_grants FROM anon, authenticated;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='device_otp_challenges'
       AND policyname='device_otp_challenges client write lockdown'
  ) THEN
    CREATE POLICY "device_otp_challenges client write lockdown"
      ON public.device_otp_challenges
      AS RESTRICTIVE
      FOR ALL TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='user_devices'
       AND policyname='user_devices client insert lockdown'
  ) THEN
    CREATE POLICY "user_devices client insert lockdown"
      ON public.user_devices
      AS RESTRICTIVE
      FOR INSERT TO anon, authenticated
      WITH CHECK (false);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='user_devices'
       AND policyname='user_devices client update lockdown'
  ) THEN
    CREATE POLICY "user_devices client update lockdown"
      ON public.user_devices
      AS RESTRICTIVE
      FOR UPDATE TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='user_devices'
       AND policyname='user_devices client delete lockdown'
  ) THEN
    CREATE POLICY "user_devices client delete lockdown"
      ON public.user_devices
      AS RESTRICTIVE
      FOR DELETE TO anon, authenticated
      USING (false);
  END IF;
END $$;

DROP POLICY IF EXISTS "owner reads own prep_pin_failures" ON public.prep_pin_failures;
CREATE POLICY "owner reads own prep_pin_failures"
  ON public.prep_pin_failures
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.prep_tasks t
       WHERE t.share_token = prep_pin_failures.share_token
         AND t.owner_user_id = auth.uid()
    )
  );

GRANT SELECT ON public.prep_pin_failures TO authenticated;
