ALTER TABLE public.conversation_members
  ADD COLUMN IF NOT EXISTS last_delivered_at timestamptz;

CREATE OR REPLACE FUNCTION public.chat_heartbeat()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET last_seen_at = now() WHERE id = auth.uid();
  UPDATE public.conversation_members
     SET last_delivered_at = now()
   WHERE user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_mark_delivered(_conv uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversation_members
     SET last_delivered_at = now()
   WHERE user_id = auth.uid()
     AND (_conv IS NULL OR conversation_id = _conv);
END;
$$;

GRANT EXECUTE ON FUNCTION public.chat_mark_delivered(uuid) TO authenticated;