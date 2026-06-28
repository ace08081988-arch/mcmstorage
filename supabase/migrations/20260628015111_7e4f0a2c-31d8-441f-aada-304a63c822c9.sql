
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attachment_duration_sec int;

ALTER TABLE public.conversation_members
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS notifications_muted_until timestamptz,
  ADD COLUMN IF NOT EXISTS sound_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS show_last_seen boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS messages_body_trgm_idx
  ON public.messages USING gin (body public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS messages_reply_to_idx
  ON public.messages(reply_to_id);

CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  emoji      text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS message_reactions_msg_idx ON public.message_reactions(message_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mr_select_member" ON public.message_reactions;
CREATE POLICY "mr_select_member" ON public.message_reactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.messages m
                 WHERE m.id = message_reactions.message_id
                   AND public.is_conversation_member(m.conversation_id, auth.uid())));
DROP POLICY IF EXISTS "mr_insert_self" ON public.message_reactions;
CREATE POLICY "mr_insert_self" ON public.message_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_reactions.message_id
      AND public.is_conversation_member(m.conversation_id, auth.uid())));
DROP POLICY IF EXISTS "mr_delete_self" ON public.message_reactions;
CREATE POLICY "mr_delete_self" ON public.message_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.message_hidden (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  hidden_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_hidden_user_idx ON public.message_hidden(user_id);
GRANT SELECT, INSERT, DELETE ON public.message_hidden TO authenticated;
GRANT ALL ON public.message_hidden TO service_role;
ALTER TABLE public.message_hidden ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mh_select_self" ON public.message_hidden;
CREATE POLICY "mh_select_self" ON public.message_hidden FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "mh_insert_self" ON public.message_hidden;
CREATE POLICY "mh_insert_self" ON public.message_hidden FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "mh_delete_self" ON public.message_hidden;
CREATE POLICY "mh_delete_self" ON public.message_hidden FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DO $$
BEGIN
  BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions';
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.message_hidden';
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.message_hidden REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.chat_heartbeat()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.profiles SET last_seen_at = now() WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.chat_heartbeat() TO authenticated;

CREATE OR REPLACE FUNCTION public.message_react(_msg uuid, _emoji text, _on boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_conv uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT conversation_id INTO v_conv FROM public.messages WHERE id = _msg;
  IF v_conv IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_conversation_member(v_conv, v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _on THEN
    INSERT INTO public.message_reactions(message_id, user_id, emoji)
      VALUES (_msg, v_uid, _emoji) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.message_reactions
      WHERE message_id=_msg AND user_id=v_uid AND emoji=_emoji;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.message_react(uuid,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.message_hide_for_me(_msg uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_conv uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT conversation_id INTO v_conv FROM public.messages WHERE id=_msg;
  IF v_conv IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_conversation_member(v_conv, v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.message_hidden(message_id, user_id) VALUES(_msg, v_uid)
  ON CONFLICT DO NOTHING;
END $$;
GRANT EXECUTE ON FUNCTION public.message_hide_for_me(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.message_edit(_msg uuid, _body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_m public.messages%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _body IS NULL OR char_length(trim(_body)) = 0 THEN RAISE EXCEPTION 'empty_body'; END IF;
  IF char_length(_body) > 4000 THEN RAISE EXCEPTION 'too_long'; END IF;
  SELECT * INTO v_m FROM public.messages WHERE id=_msg;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_m.sender_id <> v_uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_m.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'deleted'; END IF;
  IF v_m.created_at < now() - interval '24 hours' THEN RAISE EXCEPTION 'too_old'; END IF;
  UPDATE public.messages SET body = _body, edited_at = now() WHERE id = _msg;
END $$;
GRANT EXECUTE ON FUNCTION public.message_edit(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_set_pin(_conv uuid, _pin boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.conversation_members
     SET pinned_at = CASE WHEN _pin THEN now() ELSE NULL END
   WHERE conversation_id=_conv AND user_id=auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.chat_set_pin(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_set_archive(_conv uuid, _arch boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.conversation_members
     SET archived_at = CASE WHEN _arch THEN now() ELSE NULL END
   WHERE conversation_id=_conv AND user_id=auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.chat_set_archive(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_mute(_conv uuid, _until timestamptz)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.conversation_members
     SET notifications_muted_until = _until
   WHERE conversation_id=_conv AND user_id=auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.chat_mute(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_search_messages(_q text, _limit int DEFAULT 30)
RETURNS TABLE(id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.conversation_id, m.sender_id, m.body, m.created_at
    FROM public.messages m
   WHERE m.body ILIKE '%'||_q||'%'
     AND m.deleted_at IS NULL
     AND public.is_conversation_member(m.conversation_id, auth.uid())
     AND NOT EXISTS (SELECT 1 FROM public.message_hidden h
                      WHERE h.message_id=m.id AND h.user_id=auth.uid())
   ORDER BY m.created_at DESC
   LIMIT GREATEST(1, LEAST(_limit, 100));
$$;
GRANT EXECUTE ON FUNCTION public.chat_search_messages(text, int) TO authenticated;

DROP FUNCTION IF EXISTS public.get_chat_member_profiles(uuid[]);
CREATE FUNCTION public.get_chat_member_profiles(_user_ids uuid[])
RETURNS TABLE(id uuid, display_name text, phone text, email text,
              last_seen_at timestamptz, show_last_seen boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name, p.phone, p.email,
         CASE WHEN p.show_last_seen THEN p.last_seen_at ELSE NULL END,
         p.show_last_seen
    FROM public.profiles p
   WHERE p.id = ANY(_user_ids)
     AND (p.id = auth.uid()
       OR EXISTS (SELECT 1 FROM public.conversation_members a
                  JOIN public.conversation_members b ON b.conversation_id = a.conversation_id
                  WHERE a.user_id = auth.uid() AND b.user_id = p.id))
$$;
GRANT EXECUTE ON FUNCTION public.get_chat_member_profiles(uuid[]) TO authenticated;
