
CREATE TABLE public.admin_denial_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fn TEXT NOT NULL,
  user_id UUID,
  reason TEXT NOT NULL DEFAULT 'not_admin',
  referer TEXT,
  ua TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_denial_events_created_at_idx ON public.admin_denial_events (created_at DESC);
CREATE INDEX admin_denial_events_fn_idx ON public.admin_denial_events (fn);
CREATE INDEX admin_denial_events_user_id_idx ON public.admin_denial_events (user_id);

GRANT SELECT ON public.admin_denial_events TO authenticated;
GRANT ALL ON public.admin_denial_events TO service_role;

ALTER TABLE public.admin_denial_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read denial events"
  ON public.admin_denial_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
