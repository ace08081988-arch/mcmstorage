ALTER TABLE public.email_send_state ADD COLUMN IF NOT EXISTS cron_secret TEXT;

UPDATE public.email_send_state
SET cron_secret = encode(gen_random_bytes(32), 'hex')
WHERE id = 1
  AND (cron_secret IS NULL OR cron_secret = '');

INSERT INTO public.email_send_state (id, cron_secret)
SELECT 1, encode(gen_random_bytes(32), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM public.email_send_state WHERE id = 1);

DO $$
DECLARE
  v_secret TEXT;
  v_existing_id UUID;
BEGIN
  SELECT cron_secret INTO v_secret
  FROM public.email_send_state
  WHERE id = 1;

  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'email_send_state.cron_secret is not configured';
  END IF;

  SELECT id INTO v_existing_id
  FROM vault.secrets
  WHERE name = 'email_queue_cron_secret';

  IF v_existing_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_id, v_secret);
  ELSE
    PERFORM vault.create_secret(v_secret, 'email_queue_cron_secret');
  END IF;
END $$;

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

DELETE FROM vault.secrets
WHERE name = 'email_queue_service_role_key';