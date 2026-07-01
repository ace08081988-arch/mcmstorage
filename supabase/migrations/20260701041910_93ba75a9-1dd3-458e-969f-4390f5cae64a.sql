
CREATE TABLE public.apk_min_supported (
  variant TEXT PRIMARY KEY CHECK (variant IN ('storage', 'chat')),
  min_version_name TEXT,
  min_version_code INTEGER,
  reason TEXT,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.apk_min_supported TO anon, authenticated;
GRANT ALL ON public.apk_min_supported TO service_role;

ALTER TABLE public.apk_min_supported ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read min supported"
  ON public.apk_min_supported FOR SELECT
  USING (true);

CREATE POLICY "Admins manage min supported"
  ON public.apk_min_supported FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER apk_min_supported_updated_at
  BEFORE UPDATE ON public.apk_min_supported
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
