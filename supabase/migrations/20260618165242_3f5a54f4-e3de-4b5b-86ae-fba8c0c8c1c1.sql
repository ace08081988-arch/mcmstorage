
CREATE TABLE public.email_monitor_config (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  admin_email TEXT NOT NULL,
  stale_threshold_minutes INT NOT NULL DEFAULT 30,
  error_rate_threshold NUMERIC NOT NULL DEFAULT 0.70,
  error_min_sample INT NOT NULL DEFAULT 5,
  cooldown_minutes INT NOT NULL DEFAULT 60,
  last_stale_alert_at TIMESTAMPTZ,
  last_error_alert_at TIMESTAMPTZ,
  last_check_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT singleton_row CHECK (id = 1)
);
GRANT SELECT ON public.email_monitor_config TO authenticated;
GRANT ALL ON public.email_monitor_config TO service_role;
ALTER TABLE public.email_monitor_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read monitor config"
  ON public.email_monitor_config FOR SELECT TO authenticated USING (true);

CREATE TABLE public.email_queue_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  message TEXT NOT NULL,
  metadata JSONB,
  notified_email TEXT,
  delivery_status TEXT,
  delivery_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.email_queue_alerts TO authenticated;
GRANT ALL ON public.email_queue_alerts TO service_role;
ALTER TABLE public.email_queue_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read alerts"
  ON public.email_queue_alerts FOR SELECT TO authenticated USING (true);

CREATE INDEX email_queue_alerts_created_at_idx
  ON public.email_queue_alerts (created_at DESC);

INSERT INTO public.email_monitor_config (id, admin_email, stale_threshold_minutes, error_rate_threshold)
VALUES (1, 'Ace08081988@gmail.com', 30, 0.70)
ON CONFLICT (id) DO UPDATE SET
  admin_email = EXCLUDED.admin_email,
  stale_threshold_minutes = EXCLUDED.stale_threshold_minutes,
  error_rate_threshold = EXCLUDED.error_rate_threshold,
  updated_at = now();

-- Health snapshot function
CREATE OR REPLACE FUNCTION public.email_queue_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
DECLARE
  v_pending_tx INT;
  v_pending_auth INT;
  v_dlq_tx INT;
  v_dlq_auth INT;
  v_last_sent TIMESTAMPTZ;
  v_sent_30m INT;
  v_failed_30m INT;
BEGIN
  SELECT count(*) INTO v_pending_tx FROM pgmq.q_transactional_emails;
  SELECT count(*) INTO v_pending_auth FROM pgmq.q_auth_emails;
  SELECT count(*) INTO v_dlq_tx FROM pgmq.q_transactional_emails_dlq;
  SELECT count(*) INTO v_dlq_auth FROM pgmq.q_auth_emails_dlq;
  SELECT max(created_at) INTO v_last_sent FROM public.email_send_log WHERE status='sent';
  SELECT count(*) INTO v_sent_30m FROM public.email_send_log WHERE status='sent' AND created_at > now() - interval '30 minutes';
  SELECT count(*) INTO v_failed_30m FROM public.email_send_log WHERE status IN ('failed','dlq') AND created_at > now() - interval '30 minutes';
  RETURN jsonb_build_object(
    'pending_transactional', v_pending_tx,
    'pending_auth', v_pending_auth,
    'dlq_transactional', v_dlq_tx,
    'dlq_auth', v_dlq_auth,
    'last_sent_at', v_last_sent,
    'sent_last_30m', v_sent_30m,
    'failed_last_30m', v_failed_30m
  );
END $$;
GRANT EXECUTE ON FUNCTION public.email_queue_health() TO service_role, authenticated;
