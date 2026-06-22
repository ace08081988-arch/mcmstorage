CREATE POLICY "self_prep_photos_update_own" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'self-prep-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'self-prep-photos' AND (storage.foldername(name))[1] = auth.uid()::text);