-- Reschedule process-email-queue to the stable production URL.
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
        url := 'https://project--b29d53bc-658a-4d86-8c6c-32fdd495b32b.lovable.app/lovable/email/queue/process',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Lovable-Context', 'cron',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'email_queue_cron_secret'
          )
        ),
        body := '{}'::jsonb
      )
    ELSE NULL
  END;
  $cron$
);

-- Also re-point the email-queue-monitor cron if it exists, to the same stable URL.
DO $$
DECLARE v_exists boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-queue-monitor') INTO v_exists;
  IF v_exists THEN
    PERFORM cron.unschedule('email-queue-monitor');
  END IF;
END $$;

SELECT cron.schedule(
  'email-queue-monitor',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--b29d53bc-658a-4d86-8c6c-32fdd495b32b.lovable.app/api/public/hooks/email-queue-monitor',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $cron$
);