CREATE OR REPLACE FUNCTION public.message_delete_for_all(_msg uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_m public.messages%ROWTYPE;
  v_owner uuid;
  v_path text;
  v_next_last timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO v_m
  FROM public.messages
  WHERE id = _msg
  FOR UPDATE;

  IF v_m.id IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT owner_user_id INTO v_owner
  FROM public.conversations
  WHERE id = v_m.conversation_id;

  IF v_m.sender_id <> v_uid
     AND COALESCE(v_owner, '00000000-0000-0000-0000-000000000000'::uuid) <> v_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_path := v_m.attachment_path;

  DELETE FROM public.messages
  WHERE id = _msg;

  SELECT max(created_at) INTO v_next_last
  FROM public.messages
  WHERE conversation_id = v_m.conversation_id;

  UPDATE public.conversations
  SET last_message_at = v_next_last,
      updated_at = now()
  WHERE id = v_m.conversation_id;

  RETURN v_path;
END $$;

GRANT EXECUTE ON FUNCTION public.message_delete_for_all(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.message_delete_all_mine(_conv uuid)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_next_last timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF NOT public.is_conversation_member(_conv, v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH targets AS (
    SELECT id, attachment_path
    FROM public.messages
    WHERE conversation_id = _conv
      AND sender_id = v_uid
    FOR UPDATE
  ), deleted AS (
    DELETE FROM public.messages m
    USING targets t
    WHERE m.id = t.id
    RETURNING t.attachment_path
  )
  SELECT attachment_path
  FROM deleted
  WHERE attachment_path IS NOT NULL;

  SELECT max(created_at) INTO v_next_last
  FROM public.messages
  WHERE conversation_id = _conv;

  UPDATE public.conversations
  SET last_message_at = v_next_last,
      updated_at = now()
  WHERE id = _conv;
END $$;

GRANT EXECUTE ON FUNCTION public.message_delete_all_mine(uuid) TO authenticated;