
CREATE TABLE IF NOT EXISTS public.chat_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  callee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('audio','video')),
  status text NOT NULL DEFAULT 'ringing'
    CHECK (status IN ('ringing','accepted','declined','missed','ended','cancelled','failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  duration_sec integer NOT NULL DEFAULT 0,
  end_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_calls_conv_idx ON public.chat_calls(conversation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS chat_calls_caller_idx ON public.chat_calls(caller_id, started_at DESC);
CREATE INDEX IF NOT EXISTS chat_calls_callee_idx ON public.chat_calls(callee_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.chat_calls TO authenticated;
GRANT ALL ON public.chat_calls TO service_role;

ALTER TABLE public.chat_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_calls select member" ON public.chat_calls;
CREATE POLICY "chat_calls select member" ON public.chat_calls
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "chat_calls insert self" ON public.chat_calls;
CREATE POLICY "chat_calls insert self" ON public.chat_calls
  FOR INSERT TO authenticated
  WITH CHECK (
    caller_id = auth.uid()
    AND public.is_conversation_member(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "chat_calls update participant" ON public.chat_calls;
CREATE POLICY "chat_calls update participant" ON public.chat_calls
  FOR UPDATE TO authenticated
  USING (auth.uid() = caller_id OR auth.uid() = callee_id)
  WITH CHECK (auth.uid() = caller_id OR auth.uid() = callee_id);

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_calls;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END$$;
