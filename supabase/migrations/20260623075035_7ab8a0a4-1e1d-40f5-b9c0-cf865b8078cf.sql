DROP POLICY IF EXISTS hook_secrets_service_role_select ON public.security_scan_hook_secrets;
CREATE POLICY hook_secrets_service_role_select
  ON public.security_scan_hook_secrets
  FOR SELECT
  TO service_role
  USING (true);