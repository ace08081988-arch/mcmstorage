-- Tighten friend_requests UPDATE policy so from_user cannot self-accept.
DROP POLICY IF EXISTS "fr_update_participant" ON public.friend_requests;

-- to_user (recipient) may update the row freely (accept/decline via RPC or direct).
CREATE POLICY "fr_update_recipient" ON public.friend_requests
  FOR UPDATE TO authenticated
  USING (to_user = auth.uid())
  WITH CHECK (to_user = auth.uid());

-- from_user (sender) may only cancel: allowed to move a pending row to 'cancelled'.
-- Any other status transition by the sender is denied at the row level.
CREATE POLICY "fr_update_sender_cancel_only" ON public.friend_requests
  FOR UPDATE TO authenticated
  USING (from_user = auth.uid() AND status = 'pending')
  WITH CHECK (from_user = auth.uid() AND status = 'cancelled');