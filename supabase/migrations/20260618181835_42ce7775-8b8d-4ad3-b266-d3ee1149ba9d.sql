-- Restrict email_monitor_config so admin_email is not exposed to authenticated users.
DROP POLICY IF EXISTS "Authenticated users can read email monitor config" ON public.email_monitor_config;
DROP POLICY IF EXISTS "email_monitor_config_authenticated_read" ON public.email_monitor_config;
DROP POLICY IF EXISTS "Allow authenticated read" ON public.email_monitor_config;
DROP POLICY IF EXISTS "Authenticated read" ON public.email_monitor_config;

REVOKE SELECT ON public.email_monitor_config FROM authenticated;
REVOKE SELECT ON public.email_monitor_config FROM anon;

CREATE POLICY "Service role manages email monitor config"
  ON public.email_monitor_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);