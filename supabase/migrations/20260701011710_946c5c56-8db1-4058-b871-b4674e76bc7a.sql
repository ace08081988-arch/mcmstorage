
CREATE TABLE public.org_branding (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_name TEXT NOT NULL DEFAULT '',
  org_short TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  brand_color TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_branding TO authenticated;
GRANT ALL ON public.org_branding TO service_role;
ALTER TABLE public.org_branding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org branding: owner manages own"
  ON public.org_branding FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER org_branding_set_updated
  BEFORE UPDATE ON public.org_branding
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
