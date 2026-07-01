
-- 1) invite_code column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invite_code text;

-- 2) generator: 8 karakter, alfabet Crockford-ish (tanpa 0/O/1/I/L)
CREATE OR REPLACE FUNCTION public.gen_invite_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  alphabet CONSTANT text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  code text;
  i int;
  tries int := 0;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..8 LOOP
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    PERFORM 1 FROM public.profiles WHERE invite_code = code;
    IF NOT FOUND THEN
      RETURN code;
    END IF;
    tries := tries + 1;
    IF tries > 20 THEN
      -- fallback: prefix waktu supaya pasti unik
      RETURN code || to_char(clock_timestamp(), 'MSUS');
    END IF;
  END LOOP;
END;
$$;

-- 3) Backfill baris yang belum punya PIN
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE invite_code IS NULL LOOP
    UPDATE public.profiles SET invite_code = public.gen_invite_code() WHERE id = r.id;
  END LOOP;
END $$;

-- 4) Unique constraint + default
ALTER TABLE public.profiles
  ALTER COLUMN invite_code SET DEFAULT public.gen_invite_code();

ALTER TABLE public.profiles
  ALTER COLUMN invite_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_invite_code_key
  ON public.profiles (invite_code);

-- 5) Update trigger signup agar isi PIN kalau default belum jalan
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email, phone, invite_code)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    COALESCE(NEW.phone, NEW.raw_user_meta_data ->> 'phone'),
    public.gen_invite_code()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 6) RPC: cari profil dari PIN — hanya kolom aman.
CREATE OR REPLACE FUNCTION public.resolve_invite_code(_code text)
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  invite_code text,
  chat_only boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name, p.avatar_url, p.invite_code, p.chat_only
  FROM public.profiles p
  WHERE upper(p.invite_code) = upper(coalesce(_code, ''))
    AND p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_invite_code(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_invite_code(text) TO authenticated;

-- 7) RPC: tambah kontak berdasarkan PIN, masuk ke address_book milik pemanggil.
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

  SELECT id INTO existing
  FROM public.address_book
  WHERE user_id = me AND linked_user_id = found_profile.id
  LIMIT 1;

  IF existing IS NOT NULL THEN
    final_id := existing;
    was_existing := true;
    UPDATE public.address_book
       SET updated_at = now(),
           source = COALESCE(source, 'invite')
     WHERE id = existing;
  ELSE
    INSERT INTO public.address_book (user_id, linked_user_id, name, source)
    VALUES (me, found_profile.id, COALESCE(found_profile.display_name, 'Kontak'), 'invite')
    RETURNING id INTO final_id;
  END IF;

  RETURN QUERY
    SELECT final_id, found_profile.id, found_profile.display_name, found_profile.avatar_url, was_existing;
END;
$$;

REVOKE ALL ON FUNCTION public.add_contact_by_invite_code(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.add_contact_by_invite_code(text) TO authenticated;
