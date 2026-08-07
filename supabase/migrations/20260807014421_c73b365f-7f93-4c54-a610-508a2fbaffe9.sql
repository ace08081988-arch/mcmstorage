CREATE TABLE IF NOT EXISTS public.chat_call_hidden (
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  call_id UUID NOT NULL REFERENCES public.chat_calls(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, call_id)
);

GRANT SELECT, INSERT, DELETE ON public.chat_call_hidden TO authenticated;
GRANT ALL ON public.chat_call_hidden TO service_role;

ALTER TABLE public.chat_call_hidden ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_call_hidden own" ON public.chat_call_hidden;
CREATE POLICY "chat_call_hidden own" ON public.chat_call_hidden
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS chat_call_hidden_user_idx ON public.chat_call_hidden(user_id);