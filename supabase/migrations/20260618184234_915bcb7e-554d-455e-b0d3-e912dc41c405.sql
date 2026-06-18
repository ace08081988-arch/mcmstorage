DROP POLICY IF EXISTS "Authenticated can read monitor config" ON public.email_monitor_config;
REVOKE SELECT ON public.email_monitor_config FROM authenticated, anon;