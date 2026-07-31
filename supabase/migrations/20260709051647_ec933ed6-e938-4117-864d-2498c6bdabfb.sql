-- L17: allow admin SELECT on email_monitor_config and email_queue_alerts
-- Existing policies block all authenticated access with USING (false).
-- Service role bypasses RLS. Admins need read access for dashboards.

DROP POLICY IF EXISTS "block authenticated access to email_monitor_config" ON public.email_monitor_config;
DROP POLICY IF EXISTS "block authenticated select email_queue_alerts" ON public.email_queue_alerts;
DROP POLICY IF EXISTS "block authenticated writes to email_queue_alerts" ON public.email_queue_alerts;

-- email_monitor_config: admin SELECT only; writes blocked for authenticated
CREATE POLICY "admin can select email_monitor_config"
  ON public.email_monitor_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "block authenticated writes email_monitor_config"
  ON public.email_monitor_config FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- email_queue_alerts: admin SELECT only; writes blocked for authenticated
CREATE POLICY "admin can select email_queue_alerts"
  ON public.email_queue_alerts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "block authenticated writes email_queue_alerts"
  ON public.email_queue_alerts FOR ALL TO authenticated
  USING (false) WITH CHECK (false);