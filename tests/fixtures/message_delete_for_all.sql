-- Snapshot fungsi RPC message_delete_for_all + constraint messages_check.
-- Dipakai oleh integration test untuk mengunci invariants:
--   1. Soft-delete: body & attachment_path di-NULL-kan, deleted_at diisi now().
--   2. Constraint messages_check mengizinkan baris dengan body & attachment
--      sama-sama NULL SELAMA deleted_at terisi (relaksasi dari versi lama
--      yang selalu menuntut body atau attachment non-null).

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_check CHECK (
  deleted_at IS NOT NULL OR body IS NOT NULL OR attachment_path IS NOT NULL
);

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