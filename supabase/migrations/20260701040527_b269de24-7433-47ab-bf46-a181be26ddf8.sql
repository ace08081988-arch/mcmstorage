
CREATE TABLE public.apk_release_meta (
  file_name text PRIMARY KEY,
  variant text NOT NULL CHECK (variant IN ('storage','chat')),
  enabled boolean NOT NULL DEFAULT true,
  publish_at timestamptz NULL,
  notes text NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.apk_release_meta TO authenticated;
GRANT ALL ON public.apk_release_meta TO service_role;

ALTER TABLE public.apk_release_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage apk release meta"
  ON public.apk_release_meta
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_apk_release_meta_updated_at
  BEFORE UPDATE ON public.apk_release_meta
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
