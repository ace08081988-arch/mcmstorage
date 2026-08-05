CREATE TABLE IF NOT EXISTS public.web_vital_alert_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  admin_email text,
  lcp_threshold_ms integer NOT NULL DEFAULT 2500,
  cls_threshold numeric NOT NULL DEFAULT 0.1,
  inp_threshold_ms integer NOT NULL DEFAULT 200,
  min_samples integer NOT NULL DEFAULT 20,
  window_minutes integer NOT NULL DEFAULT 180,
  cooldown_minutes integer NOT NULL DEFAULT 180,
  last_check_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.web_vital_alert_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.web_vital_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page text NOT NULL,
  metric text NOT NULL,
  device text NOT NULL DEFAULT 'all',
  p75 numeric NOT NULL,
  threshold numeric NOT NULL,
  samples integer NOT NULL,
  window_minutes integer NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  notified_email text,
  delivery_status text NOT NULL DEFAULT 'skipped',
  delivery_error text,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_vital_alerts_created_idx ON public.web_vital_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS web_vital_alerts_key_idx ON public.web_vital_alerts (page, metric, device, created_at DESC);

GRANT SELECT ON public.web_vital_alert_config TO authenticated;
GRANT UPDATE ON public.web_vital_alert_config TO authenticated;
GRANT ALL ON public.web_vital_alert_config TO service_role;
GRANT SELECT, UPDATE ON public.web_vital_alerts TO authenticated;
GRANT ALL ON public.web_vital_alerts TO service_role;

ALTER TABLE public.web_vital_alert_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_vital_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin read vitals alert config" ON public.web_vital_alert_config;
CREATE POLICY "admin read vitals alert config"
  ON public.web_vital_alert_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin update vitals alert config" ON public.web_vital_alert_config;
CREATE POLICY "admin update vitals alert config"
  ON public.web_vital_alert_config FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin read vitals alerts" ON public.web_vital_alerts;
CREATE POLICY "admin read vitals alerts"
  ON public.web_vital_alerts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admin ack vitals alerts" ON public.web_vital_alerts;
CREATE POLICY "admin ack vitals alerts"
  ON public.web_vital_alerts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));