DROP POLICY IF EXISTS "prep-photos guarded read" ON storage.objects;

CREATE POLICY "prep-photos owner read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'prep-photos'
  AND EXISTS (
    SELECT 1 FROM public.prep_tasks t
    WHERE t.share_token = (storage.foldername(name))[1]
      AND t.owner_user_id = auth.uid()
  )
);

CREATE POLICY "prep-photos pin-verified read"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'prep-photos'
  AND EXISTS (
    SELECT 1 FROM public.prep_tasks t
    JOIN public.prep_upload_grants g ON g.share_token = t.share_token
    WHERE t.share_token = (storage.foldername(name))[1]
      AND t.status = 'active'
      AND t.expires_at > now()
      AND g.expires_at > now()
  )
);
