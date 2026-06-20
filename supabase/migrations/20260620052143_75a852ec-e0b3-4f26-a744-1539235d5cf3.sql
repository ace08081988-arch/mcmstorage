CREATE POLICY "block authenticated select email_queue_alerts"
ON public.email_queue_alerts
AS RESTRICTIVE
FOR SELECT
TO anon, authenticated
USING (false);