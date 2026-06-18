DROP POLICY IF EXISTS "Users manage own devices" ON public.user_devices;
REVOKE INSERT, UPDATE, DELETE ON public.user_devices FROM authenticated;
CREATE POLICY "Users can view own devices" ON public.user_devices
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);