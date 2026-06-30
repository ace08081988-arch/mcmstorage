
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_m FROM public.messages WHERE id = _msg;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT owner_user_id INTO v_owner FROM public.conversations WHERE id = v_m.conversation_id;
  IF v_m.sender_id <> v_uid AND COALESCE(v_owner, '00000000-0000-0000-0000-000000000000'::uuid) <> v_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_m.deleted_at IS NOT NULL THEN
    RETURN v_m.attachment_path;
  END IF;
  v_path := v_m.attachment_path;
  UPDATE public.messages
     SET deleted_at = now(),
         body = NULL,
         attachment_path = NULL,
         attachment_name = NULL,
         attachment_mime = NULL,
         attachment_size = NULL
   WHERE id = _msg;
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_conversation_member(_conv, v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;
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

GRANT EXECUTE ON FUNCTION public.message_delete_all_mine(uuid) TO authenticated;
