-- chat-attachments: sender + conversation member
CREATE POLICY "chat_attach_update_owner" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND owner = auth.uid()
    AND public.is_conversation_member((split_part(name, '/', 1))::uuid, auth.uid())
  )
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND owner = auth.uid()
    AND public.is_conversation_member((split_part(name, '/', 1))::uuid, auth.uid())
  );

-- ecer-photos: owner folder
CREATE POLICY "ecer-photos owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'ecer-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'ecer-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ready-packages: owner only
CREATE POLICY "Owners update ready-package photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'ready-packages'
    AND owner = auth.uid()
  )
  WITH CHECK (
    bucket_id = 'ready-packages'
    AND owner = auth.uid()
  );
