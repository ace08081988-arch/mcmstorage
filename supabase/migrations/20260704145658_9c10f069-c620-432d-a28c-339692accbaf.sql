DROP FUNCTION IF EXISTS public.get_chat_member_profiles(uuid[]);

CREATE OR REPLACE FUNCTION public.get_chat_member_profiles(_user_ids uuid[])
 RETURNS TABLE(id uuid, display_name text, phone text, invite_code text, last_seen_at timestamp with time zone, show_last_seen boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    p.display_name,
    -- Hanya kembalikan nomor telepon kalau pemanggil sudah menyimpan peer
    -- di address_book miliknya (linked_user_id = p.id). Ini mencegah
    -- kebocoran nomor telepon lintas pengguna di grup / DM baru.
    CASE
      WHEN p.id = auth.uid() THEN p.phone
      WHEN EXISTS (
        SELECT 1 FROM public.address_book ab
        WHERE ab.user_id = auth.uid() AND ab.linked_user_id = p.id
      ) THEN p.phone
      ELSE NULL
    END AS phone,
    p.invite_code,
    CASE WHEN p.show_last_seen THEN p.last_seen_at ELSE NULL END AS last_seen_at,
    p.show_last_seen
  FROM public.profiles p
  WHERE p.id = ANY(_user_ids)
    AND (
      p.id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.conversation_members a
        JOIN public.conversation_members b ON b.conversation_id = a.conversation_id
        WHERE a.user_id = auth.uid() AND b.user_id = p.id
      )
    )
$function$;

REVOKE ALL ON FUNCTION public.get_chat_member_profiles(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_member_profiles(uuid[]) TO authenticated;