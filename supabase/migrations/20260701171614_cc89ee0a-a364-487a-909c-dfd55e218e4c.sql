
ALTER TABLE public.conversation_members
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz;

CREATE OR REPLACE FUNCTION public.chat_clear_conversation_for_me(_conv uuid)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_conversation_member(_conv, v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Hide every existing message (from any sender) for the caller, so the
  -- conversation preview + unread badge become empty immediately.
  INSERT INTO public.message_hidden(message_id, user_id)
  SELECT m.id, v_uid
    FROM public.messages m
   WHERE m.conversation_id = _conv
  ON CONFLICT DO NOTHING;

  -- Mark the conversation as cleared for the caller. Combined with the
  -- last_message_at check on the client, the row disappears from Aktif
  -- until a new message arrives.
  UPDATE public.conversation_members
     SET cleared_at = now(),
         last_read_at = now()
   WHERE conversation_id = _conv AND user_id = v_uid;

  -- Soft-delete the caller's own messages so peers no longer see them and
  -- return attachment paths so the client can purge storage.
  RETURN QUERY
  WITH targets AS (
    SELECT id, attachment_path FROM public.messages
     WHERE conversation_id = _conv AND sender_id = v_uid AND deleted_at IS NULL
  ), upd AS (
    UPDATE public.messages m
       SET deleted_at = now(),
           body = NULL,
           attachment_path = NULL,
           attachment_name = NULL,
           attachment_mime = NULL,
           attachment_size = NULL
      FROM targets t
     WHERE m.id = t.id
     RETURNING t.attachment_path
  )
  SELECT attachment_path FROM upd WHERE attachment_path IS NOT NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.chat_clear_conversation_for_me(uuid) TO authenticated;
