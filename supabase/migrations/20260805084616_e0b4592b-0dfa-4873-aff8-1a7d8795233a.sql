DO $$
BEGIN
  PERFORM cron.unschedule('web-vitals-alert-check');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'web-vitals-alert-check',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--b29d53bc-658a-4d86-8c6c-32fdd495b32b.lovable.app/api/public/hooks/web-vitals-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'email_queue_cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);