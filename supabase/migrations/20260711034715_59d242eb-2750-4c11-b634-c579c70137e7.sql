CREATE OR REPLACE FUNCTION public.respond_friend_request(_request_id uuid, _accept boolean)
RETURNS TABLE(request_id uuid, status public.friend_request_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_req public.friend_requests%ROWTYPE;
  v_new_status public.friend_request_status;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = '42501', HINT = 'Masuk ulang lalu coba menerima permintaan lagi.';
  END IF;

  SELECT *
    INTO v_req
    FROM public.friend_requests
   WHERE id = _request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found'
      USING ERRCODE = 'P0002', HINT = 'Permintaan ini sudah tidak tersedia atau sudah dibersihkan.';
  END IF;

  IF v_req.to_user <> v_me THEN
    IF v_req.from_user = v_me THEN
      RAISE EXCEPTION 'not_recipient'
        USING ERRCODE = '42501', HINT = 'Permintaan ini ada di tab Terkirim. Hanya penerima yang bisa menekan Terima.';
    END IF;
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501', HINT = 'Akun ini bukan penerima permintaan tersebut.';
  END IF;

  IF v_req.status <> 'pending'::public.friend_request_status THEN
    RETURN QUERY SELECT v_req.id, v_req.status;
    RETURN;
  END IF;

  v_new_status := CASE
    WHEN _accept THEN 'accepted'::public.friend_request_status
    ELSE 'rejected'::public.friend_request_status
  END;

  UPDATE public.friend_requests fr
     SET status = v_new_status,
         responded_at = now()
   WHERE fr.id = v_req.id
     AND fr.to_user = v_me
     AND fr.status = 'pending'::public.friend_request_status
   RETURNING fr.* INTO v_req;

  IF NOT FOUND THEN
    SELECT * INTO v_req FROM public.friend_requests WHERE id = _request_id;
    IF FOUND THEN
      RETURN QUERY SELECT v_req.id, v_req.status;
      RETURN;
    END IF;
    RAISE EXCEPTION 'not_found'
      USING ERRCODE = 'P0002', HINT = 'Permintaan berubah saat diproses. Muat ulang daftar permintaan.';
  END IF;

  IF _accept THEN
    BEGIN
      INSERT INTO public.address_book (user_id, linked_user_id, name, source)
      VALUES
        (v_req.from_user, v_req.to_user, COALESCE((SELECT display_name FROM public.profiles WHERE id = v_req.to_user), 'Kontak'), 'app'),
        (v_req.to_user, v_req.from_user, COALESCE((SELECT display_name FROM public.profiles WHERE id = v_req.from_user), 'Kontak'), 'app')
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'respond_friend_request: accepted but address_book mirror failed for request %, error=%', v_req.id, SQLERRM;
    END;
  END IF;

  RETURN QUERY SELECT v_req.id, v_req.status;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.send_friend_request(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.respond_friend_request(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_friend_request(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_friend_requests(text, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.send_friend_request(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_friend_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_friend_requests(text, boolean) TO authenticated, service_role;