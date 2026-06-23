DROP POLICY IF EXISTS msg_update_sender ON public.messages;
CREATE POLICY msg_update_sender ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_member(conversation_id, auth.uid())
  );