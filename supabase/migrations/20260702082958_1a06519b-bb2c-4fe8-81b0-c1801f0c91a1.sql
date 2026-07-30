
-- 1) app_settings: restrict SELECT to authenticated only; expose worker portal config publicly via RPC.
DROP POLICY IF EXISTS "anyone can read app_settings" ON public.app_settings;
CREATE POLICY "authenticated can read app_settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.get_worker_portal_public_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(worker_portal_config, '{}'::jsonb)
  FROM public.app_settings
  WHERE id = true
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_worker_portal_public_config() TO anon, authenticated;

-- 2) prep-photos read policy: require fresh PIN verification (grant issued within 15 minutes).
CREATE OR REPLACE FUNCTION public.prep_read_allowed(_share_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.prep_tasks t
      JOIN public.prep_upload_grants g ON g.share_token = t.share_token
     WHERE t.share_token = _share_token
       AND t.status = 'active'
       AND t.expires_at > now()
       AND g.expires_at > now()
       AND g.issued_at > now() - interval '15 minutes'
  )
$$;

GRANT EXECUTE ON FUNCTION public.prep_read_allowed(text) TO anon, authenticated;

DROP POLICY IF EXISTS "prep-photos pin-verified read" ON storage.objects;
CREATE POLICY "prep-photos pin-verified read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'prep-photos'
    AND public.prep_read_allowed((storage.foldername(name))[1])
  );

-- 3) email_monitor_config: service_role bypasses RLS; remove the redundant permissive ALL policy.
DROP POLICY IF EXISTS "Service role manages email monitor config" ON public.email_monitor_config;

-- 4) apk_download_events: tighten permissive INSERT with basic validation.
DROP POLICY IF EXISTS "anyone can log a download click" ON public.apk_download_events;
CREATE POLICY "anyone can log a download click"
  ON public.apk_download_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    variant IN ('storage','chat')
    AND source IS NOT NULL AND length(source) BETWEEN 1 AND 64
    AND (referrer IS NULL OR length(referrer) <= 2048)
    AND (user_agent IS NULL OR length(user_agent) <= 512)
    AND (user_id IS NULL OR user_id = auth.uid())
  );
