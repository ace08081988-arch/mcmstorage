
-- Helper 1: reuse prep_upload_allowed for read policy (already SECURITY DEFINER)

-- Helper 2: worker insert check for ecer-photos (and request photos) bucket
CREATE OR REPLACE FUNCTION public.prep_worker_upload_allowed(_owner_user_id uuid, _share_token text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.prep_tasks t
      JOIN public.prep_upload_grants g ON g.share_token = t.share_token
     WHERE t.share_token = _share_token
       AND t.owner_user_id = _owner_user_id
       AND t.status = 'active'
       AND t.expires_at > now()
       AND g.expires_at > now()
  )
$$;

GRANT EXECUTE ON FUNCTION public.prep_worker_upload_allowed(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prep_upload_allowed(text) TO anon, authenticated;

-- Rewrite policy: prep-photos pin-verified read
DROP POLICY IF EXISTS "prep-photos pin-verified read" ON storage.objects;
CREATE POLICY "prep-photos pin-verified read"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'prep-photos'
  AND public.prep_upload_allowed((storage.foldername(name))[1])
);

-- Rewrite policy: ecer-photos worker insert
DROP POLICY IF EXISTS "ecer-photos worker insert" ON storage.objects;
CREATE POLICY "ecer-photos worker insert"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'ecer-photos'
  AND public.prep_worker_upload_allowed(
    ((storage.foldername(name))[1])::uuid,
    (storage.foldername(name))[2]
  )
);
