ALTER TABLE public.email_send_state
  DROP COLUMN IF EXISTS cron_secret;

DROP POLICY IF EXISTS "No anon access to email send state" ON public.email_send_state;
DROP POLICY IF EXISTS "No authenticated access to email send state" ON public.email_send_state;
DROP POLICY IF EXISTS "Block anon and authenticated email send state access" ON public.email_send_state;

CREATE POLICY "Block anon and authenticated email send state access"
  ON public.email_send_state
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

SELECT cron.unschedule('process-email-queue')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue');

SELECT cron.schedule(
  'process-email-queue',
  '5 seconds',
  $cron$
  SELECT CASE
    WHEN (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now()
      THEN NULL
    WHEN EXISTS (SELECT 1 FROM pgmq.q_auth_emails LIMIT 1)
      OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails LIMIT 1)
      THEN net.http_post(
        url := 'https://id-preview--b29d53bc-658a-4d86-8c6c-32fdd495b32b.lovable.app/lovable/email/queue/process',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Lovable-Context', 'cron',
          'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6Imdwb2p4aWdlYmN5aG9qbHBocW5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3ODEwMzQsImV4cCI6MjA5NzM1NzAzNH0.fKXqshQipF7EzTYufLP_nwyTu3HGqIqFLX2Es1eJSJM'
        ),
        body := '{}'::jsonb
      )
    ELSE NULL
  END;
  $cron$
);

DELETE FROM vault.secrets
WHERE name IN ('email_queue_cron_secret', 'email_queue_service_role_key');