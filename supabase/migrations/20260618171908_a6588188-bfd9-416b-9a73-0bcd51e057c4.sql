-- Restrict email_queue_alerts SELECT to service_role only
DROP POLICY IF EXISTS "Authenticated can read alerts" ON public.email_queue_alerts;
DROP POLICY IF EXISTS "authenticated_read_email_queue_alerts" ON public.email_queue_alerts;
DROP POLICY IF EXISTS "Anyone authenticated can read email queue alerts" ON public.email_queue_alerts;

CREATE POLICY "Service role only read email_queue_alerts"
ON public.email_queue_alerts
FOR SELECT
TO service_role
USING (true);

-- Purge failed device_otp queue messages so the new payload format runs fresh
SELECT pgmq.purge_queue('transactional_emails');