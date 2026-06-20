
-- Owner full access to their own folder ecer-photos/<user_id>/...
CREATE POLICY "ecer-photos owner read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ecer-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "ecer-photos owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ecer-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "ecer-photos owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ecer-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Worker (anon) can upload to owner's folder if their task token has an active upload grant.
-- Path format for worker uploads: ecer-photos/<owner_user_id>/<share_token>/...
CREATE POLICY "ecer-photos worker insert"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'ecer-photos'
    AND EXISTS (
      SELECT 1 FROM public.prep_tasks t
      JOIN public.prep_upload_grants g ON g.share_token = t.share_token
      WHERE t.owner_user_id::text = (storage.foldername(name))[1]
        AND t.share_token = (storage.foldername(name))[2]
        AND t.status = 'active' AND t.expires_at > now() AND g.expires_at > now()
    )
  );
