
ALTER TABLE public.prep_task_wa_hook_log
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamptz;

GRANT UPDATE (send_status, error, retry_count, last_retry_at) ON public.prep_task_wa_hook_log TO authenticated;

DROP POLICY IF EXISTS "Owners can retry their task wa hook log" ON public.prep_task_wa_hook_log;
CREATE POLICY "Owners can retry their task wa hook log"
  ON public.prep_task_wa_hook_log
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);
