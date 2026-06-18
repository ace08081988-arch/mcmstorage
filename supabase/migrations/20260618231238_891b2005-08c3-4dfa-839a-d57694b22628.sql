
CREATE POLICY "Public read apk-releases"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'apk-releases');

CREATE POLICY "Authenticated upload apk-releases"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'apk-releases');

CREATE POLICY "Authenticated update apk-releases"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'apk-releases')
  WITH CHECK (bucket_id = 'apk-releases');

CREATE POLICY "Authenticated delete apk-releases"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'apk-releases');
