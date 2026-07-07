
CREATE OR REPLACE FUNCTION public.send_friend_request(_code text)
 RETURNS TABLE(request_id uuid, to_user uuid, display_name text, avatar_url text, status friend_request_status, was_existing boolean, already_friends boolean, incoming_reverse_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  target record;
  existing_row record;
  reverse_pending uuid;
  final_id uuid;
  final_status public.friend_request_status;
  was_ex boolean := false;
  is_friend boolean := false;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;

  SELECT p.id, p.display_name, p.avatar_url
    INTO target
    FROM public.profiles p
   WHERE upper(p.invite_code) = upper(coalesce(_code, ''))
     AND p.id <> me
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_code_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF public.are_friends(me, target.id) THEN
    SELECT fr.id, fr.status INTO existing_row
      FROM public.friend_requests fr
     WHERE ((fr.from_user = me AND fr.to_user = target.id)
         OR (fr.from_user = target.id AND fr.to_user = me))
       AND fr.status = 'accepted'
     ORDER BY fr.responded_at DESC NULLS LAST
     LIMIT 1;
    final_id := existing_row.id;
    final_status := 'accepted'::public.friend_request_status;
    was_ex := true;
    is_friend := true;
  ELSE
    SELECT fr.id INTO reverse_pending
      FROM public.friend_requests fr
     WHERE fr.from_user = target.id AND fr.to_user = me AND fr.status = 'pending'
     LIMIT 1;

    SELECT fr.id, fr.status INTO existing_row
      FROM public.friend_requests fr
     WHERE fr.from_user = me AND fr.to_user = target.id
     LIMIT 1;

    IF existing_row.id IS NOT NULL THEN
      was_ex := true;
      final_id := existing_row.id;
      IF existing_row.status IN ('rejected'::public.friend_request_status, 'cancelled'::public.friend_request_status) THEN
        UPDATE public.friend_requests fr
           SET status = 'pending'::public.friend_request_status, responded_at = NULL
         WHERE fr.id = existing_row.id
         RETURNING fr.status INTO final_status;
      ELSE
        final_status := existing_row.status;
      END IF;
    ELSE
      INSERT INTO public.friend_requests AS fr (from_user, to_user, status)
      VALUES (me, target.id, 'pending'::public.friend_request_status)
      RETURNING fr.id, fr.status INTO final_id, final_status;
    END IF;
  END IF;

  RETURN QUERY SELECT final_id, target.id, target.display_name, target.avatar_url,
                       final_status, was_ex, is_friend, reverse_pending;
END; $function$;
