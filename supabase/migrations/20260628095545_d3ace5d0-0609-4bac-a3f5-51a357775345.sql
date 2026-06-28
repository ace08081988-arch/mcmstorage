CREATE TABLE public.user_notif_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_notif_prefs TO authenticated;
GRANT ALL ON public.user_notif_prefs TO service_role;
ALTER TABLE public.user_notif_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notif prefs" ON public.user_notif_prefs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_user_notif_prefs_updated_at
  BEFORE UPDATE ON public.user_notif_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();