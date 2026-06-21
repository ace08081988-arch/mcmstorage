
CREATE POLICY "chat_attach_select_member" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND public.is_conversation_member((split_part(name,'/',1))::uuid, auth.uid())
);
CREATE POLICY "chat_attach_insert_member" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND public.is_conversation_member((split_part(name,'/',1))::uuid, auth.uid())
  AND owner = auth.uid()
);
CREATE POLICY "chat_attach_delete_owner" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'chat-attachments' AND owner = auth.uid());
