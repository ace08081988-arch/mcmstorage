SELECT cron.unschedule('process-email-queue');
SELECT cron.schedule(
  'process-email-queue',
  '5 seconds',
$$
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
$$
);