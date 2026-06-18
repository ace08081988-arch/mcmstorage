
ALTER TABLE public.warehouse_items ADD COLUMN IF NOT EXISTS image_path text;

CREATE POLICY "Users manage own item photos read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'item-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users manage own item photos insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'item-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users manage own item photos update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'item-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users manage own item photos delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'item-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
