
CREATE TABLE public.portal_error_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  code text,
  hour_bucket timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX portal_error_audit_bucket_key
  ON public.portal_error_audit (kind, coalesce(code, ''), hour_bucket);

CREATE INDEX portal_error_audit_hour_idx
  ON public.portal_error_audit (hour_bucket DESC);

GRANT SELECT ON public.portal_error_audit TO authenticated;
GRANT ALL ON public.portal_error_audit TO service_role;

ALTER TABLE public.portal_error_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read portal error audit"
  ON public.portal_error_audit
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
