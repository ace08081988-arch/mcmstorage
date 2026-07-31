CREATE OR REPLACE FUNCTION public.add_contact_by_invite_code(_code text)
RETURNS TABLE (
  contact_id uuid,
  linked_user_id uuid,
  display_name text,
  avatar_url text,
  already_existed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  found_profile record;
  existing uuid;
  final_id uuid;
  was_existing boolean := false;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.display_name, p.avatar_url, p.invite_code
  INTO found_profile
  FROM public.profiles p
  WHERE upper(p.invite_code) = upper(coalesce(_code, ''))
    AND p.id <> me
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_code_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT ab.id INTO existing
  FROM public.address_book ab
  WHERE ab.user_id = me
    AND ab.linked_user_id = found_profile.id
  LIMIT 1;

  IF existing IS NOT NULL THEN
    final_id := existing;
    was_existing := true;
    UPDATE public.address_book ab
       SET updated_at = now(),
           source = COALESCE(ab.source, 'invite')
     WHERE ab.id = existing;
  ELSE
    INSERT INTO public.address_book (user_id, linked_user_id, name, source)
    VALUES (me, found_profile.id, COALESCE(found_profile.display_name, 'Kontak'), 'invite')
    RETURNING id INTO final_id;
  END IF;

  RETURN QUERY
    SELECT final_id, found_profile.id, found_profile.display_name, found_profile.avatar_url, was_existing;
END;
$$;