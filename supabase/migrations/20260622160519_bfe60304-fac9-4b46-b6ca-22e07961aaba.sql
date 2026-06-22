
CREATE POLICY "self-prep owner insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'self-prep-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "self-prep owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'self-prep-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "self-prep owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'self-prep-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
