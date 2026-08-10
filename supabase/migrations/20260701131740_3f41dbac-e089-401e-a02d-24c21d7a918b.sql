-- Tightens friend_requests UPDATE and DELETE policies so the RLS layer expresses
-- the same recipient/sender invariants that tg_friend_requests_guard enforces.
-- This is a defense-in-depth cleanup — the trigger already blocks these paths,
-- but keeping policies consistent means violations fail earlier and with clearer
-- ERRCODEs (permission denied instead of trigger check_violation).

BEGIN;

-- Recipient may only transition a *pending* request to accepted or rejected.
DROP POLICY IF EXISTS fr_update_recipient ON public.friend_requests;
CREATE POLICY fr_update_recipient
  ON public.friend_requests
  FOR UPDATE
  TO authenticated
  USING (to_user = auth.uid() AND status = 'pending')
  WITH CHECK (
    to_user = auth.uid()
    AND status IN ('accepted','rejected')
  );

-- Sender may only cancel their own *pending* request (already tight; restated
-- here so both UPDATE policies live side by side and match the trigger rules).
DROP POLICY IF EXISTS fr_update_sender_cancel_only ON public.friend_requests;
CREATE POLICY fr_update_sender_cancel_only
  ON public.friend_requests
  FOR UPDATE
  TO authenticated
  USING (from_user = auth.uid() AND status = 'pending')
  WITH CHECK (from_user = auth.uid() AND status = 'cancelled');

-- Sender may hard-delete only *pending* or *cancelled* rows (never accepted,
-- so the friendship graph derived from friend_requests can't be silently
-- unravelled from one side).
DROP POLICY IF EXISTS fr_delete_from_self ON public.friend_requests;
CREATE POLICY fr_delete_from_self
  ON public.friend_requests
  FOR DELETE
  TO authenticated
  USING (from_user = auth.uid() AND status IN ('pending','cancelled'));

-- Recipient can also delete a rejected/cancelled request from their own inbox.
DROP POLICY IF EXISTS fr_delete_to_self ON public.friend_requests;
CREATE POLICY fr_delete_to_self
  ON public.friend_requests
  FOR DELETE
  TO authenticated
  USING (to_user = auth.uid() AND status IN ('rejected','cancelled'));

COMMIT;