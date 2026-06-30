
-- Per-message star & pin
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS starred_by uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

CREATE INDEX IF NOT EXISTS messages_conv_pinned_idx
  ON public.messages (conversation_id, pinned_at) WHERE pinned_at IS NOT NULL;

-- RPC: toggle star (per user)
CREATE OR REPLACE FUNCTION public.message_star(_id uuid, _on boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _conv uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT conversation_id INTO _conv FROM public.messages WHERE id = _id;
  IF _conv IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = _conv AND user_id = _uid
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _on THEN
    UPDATE public.messages
       SET starred_by = (SELECT ARRAY(SELECT DISTINCT unnest(starred_by || _uid)))
     WHERE id = _id;
  ELSE
    UPDATE public.messages
       SET starred_by = array_remove(starred_by, _uid)
     WHERE id = _id;
  END IF;
END;
$$;

-- RPC: pin/unpin a message (max 3 pins per conversation)
CREATE OR REPLACE FUNCTION public.message_pin(_id uuid, _on boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _conv uuid;
  _cnt int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT conversation_id INTO _conv FROM public.messages WHERE id = _id;
  IF _conv IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = _conv AND user_id = _uid
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _on THEN
    SELECT count(*) INTO _cnt FROM public.messages
     WHERE conversation_id = _conv AND pinned_at IS NOT NULL AND id <> _id;
    IF _cnt >= 3 THEN RAISE EXCEPTION 'max_pins_reached'; END IF;
    UPDATE public.messages SET pinned_at = now() WHERE id = _id;
  ELSE
    UPDATE public.messages SET pinned_at = NULL WHERE id = _id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.message_star(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.message_pin(uuid, boolean) TO authenticated;

-- Chat notes (per-user saved snippets)
CREATE TABLE IF NOT EXISTS public.chat_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  body text NOT NULL,
  source_message_id uuid,
  conversation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_notes TO authenticated;
GRANT ALL ON public.chat_notes TO service_role;

ALTER TABLE public.chat_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own notes select" ON public.chat_notes FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "own notes insert" ON public.chat_notes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "own notes update" ON public.chat_notes FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own notes delete" ON public.chat_notes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS chat_notes_set_updated_at ON public.chat_notes;
CREATE TRIGGER chat_notes_set_updated_at BEFORE UPDATE ON public.chat_notes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Quick replies (per-user templates)
CREATE TABLE IF NOT EXISTS public.chat_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shortcut text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, shortcut)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_quick_replies TO authenticated;
GRANT ALL ON public.chat_quick_replies TO service_role;

ALTER TABLE public.chat_quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own qr select" ON public.chat_quick_replies FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "own qr insert" ON public.chat_quick_replies FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "own qr update" ON public.chat_quick_replies FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own qr delete" ON public.chat_quick_replies FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS chat_qr_set_updated_at ON public.chat_quick_replies;
CREATE TRIGGER chat_qr_set_updated_at BEFORE UPDATE ON public.chat_quick_replies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
