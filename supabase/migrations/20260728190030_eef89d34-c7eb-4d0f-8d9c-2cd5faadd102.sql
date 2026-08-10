CREATE TABLE public.user_appearance_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_appearance_prefs TO authenticated;
GRANT ALL ON public.user_appearance_prefs TO service_role;
ALTER TABLE public.user_appearance_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own appearance prefs" ON public.user_appearance_prefs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_user_appearance_prefs_updated_at
  BEFORE UPDATE ON public.user_appearance_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();