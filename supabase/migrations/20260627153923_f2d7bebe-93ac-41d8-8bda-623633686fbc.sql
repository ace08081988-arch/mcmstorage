
CREATE OR REPLACE FUNCTION public.get_chat_member_profiles(_user_ids uuid[])
RETURNS TABLE(id uuid, display_name text, email text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.id, p.display_name, p.email, p.phone
  FROM public.profiles p
  WHERE p.id = ANY(_user_ids)
    AND (
      p.id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.conversation_members cm1
        JOIN public.conversation_members cm2
          ON cm1.conversation_id = cm2.conversation_id
        WHERE cm1.user_id = auth.uid()
          AND cm2.user_id = p.id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_chat_member_profiles(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_member_profiles(uuid[]) TO authenticated;
