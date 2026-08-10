CREATE TABLE public.scroll_guard_config (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scroll_guard_config TO authenticated;
GRANT ALL ON public.scroll_guard_config TO service_role;
ALTER TABLE public.scroll_guard_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scroll guard config" ON public.scroll_guard_config
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);