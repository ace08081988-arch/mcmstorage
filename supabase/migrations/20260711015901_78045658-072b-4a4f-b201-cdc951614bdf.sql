CREATE OR REPLACE FUNCTION public.respond_friend_request(_request_id uuid, _accept boolean)
 RETURNS TABLE(request_id uuid, status friend_request_status)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  row record;
  new_status public.friend_request_status;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;

  SELECT * INTO row FROM public.friend_requests WHERE id = _request_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF row.to_user <> me THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF row.status <> 'pending'::public.friend_request_status THEN
    RETURN QUERY SELECT row.id, row.status;
    RETURN;
  END IF;

  new_status := CASE WHEN _accept THEN 'accepted'::public.friend_request_status ELSE 'rejected'::public.friend_request_status END;

  UPDATE public.friend_requests
     SET status = new_status, responded_at = now()
   WHERE id = _request_id;

  IF _accept THEN
    -- source='app' agar patuh pada address_book_source_chk
    -- (izinkan hanya 'device'|'manual'|'app'). Sebelumnya 'invite' menyebabkan
    -- check violation → seluruh RPC gagal → user tidak bisa menerima permintaan.
    INSERT INTO public.address_book (user_id, linked_user_id, name, source)
    VALUES
      (row.from_user, row.to_user, COALESCE((SELECT display_name FROM public.profiles WHERE id = row.to_user), 'Kontak'), 'app'),
      (row.to_user, row.from_user, COALESCE((SELECT display_name FROM public.profiles WHERE id = row.from_user), 'Kontak'), 'app')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY SELECT _request_id, new_status;
END; $function$;