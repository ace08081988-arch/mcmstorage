
CREATE TABLE public.portal_error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  code text,
  status text,
  route text,
  token_hash text,
  ip_hash text,
  ua text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_error_events_created_at_idx ON public.portal_error_events (created_at DESC);
CREATE INDEX portal_error_events_kind_idx ON public.portal_error_events (kind);
CREATE INDEX portal_error_events_token_hash_idx ON public.portal_error_events (token_hash);

GRANT ALL ON public.portal_error_events TO service_role;
GRANT SELECT ON public.portal_error_events TO authenticated;
ALTER TABLE public.portal_error_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read portal error events"
  ON public.portal_error_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.portal_error_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  code text,
  token_hash text,
  count integer NOT NULL,
  window_seconds integer NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_error_alerts_created_at_idx ON public.portal_error_alerts (created_at DESC);
CREATE INDEX portal_error_alerts_ack_idx ON public.portal_error_alerts (acknowledged_at);

GRANT ALL ON public.portal_error_alerts TO service_role;
GRANT SELECT, UPDATE ON public.portal_error_alerts TO authenticated;
ALTER TABLE public.portal_error_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read portal error alerts"
  ON public.portal_error_alerts FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can ack portal error alerts"
  ON public.portal_error_alerts FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
