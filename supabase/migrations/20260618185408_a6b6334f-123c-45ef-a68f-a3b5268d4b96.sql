
ALTER TABLE public.email_send_state ADD COLUMN IF NOT EXISTS cron_secret TEXT;

UPDATE public.email_send_state
  SET cron_secret = encode(gen_random_bytes(32), 'hex')
  WHERE cron_secret IS NULL OR cron_secret = '';

DO $$
DECLARE
  v_secret TEXT;
  v_id UUID;
BEGIN
  SELECT cron_secret INTO v_secret FROM public.email_send_state LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'email_queue_service_role_key';
  IF v_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_id, v_secret);
  ELSE
    PERFORM vault.create_secret(v_secret, 'email_queue_service_role_key');
  END IF;
END $$;
