
DROP FUNCTION IF EXISTS public.get_chat_member_profiles(uuid[]);
DROP FUNCTION IF EXISTS public.search_chat_contacts(text);

CREATE OR REPLACE FUNCTION public.get_chat_member_profiles(_user_ids uuid[])
 RETURNS TABLE(id uuid, display_name text, phone text, email text, invite_code text, last_seen_at timestamp with time zone, show_last_seen boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p.id, p.display_name, p.phone, p.email, p.invite_code,
         CASE WHEN p.show_last_seen THEN p.last_seen_at ELSE NULL END,
         p.show_last_seen
    FROM public.profiles p
   WHERE p.id = ANY(_user_ids)
     AND (p.id = auth.uid()
       OR EXISTS (SELECT 1 FROM public.conversation_members a
                  JOIN public.conversation_members b ON b.conversation_id = a.conversation_id
                  WHERE a.user_id = auth.uid() AND b.user_id = p.id))
$function$;

CREATE OR REPLACE FUNCTION public.search_chat_contacts(_q text)
 RETURNS TABLE(user_id uuid, display_name text, phone text, invite_code text, kind text, label text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH q AS (
    SELECT
      nullif(trim(coalesce(_q, '')), '') AS raw,
      upper(regexp_replace(coalesce(_q, ''), '[\s\-_]', '', 'g')) AS pin
  )
  SELECT DISTINCT ON (account.user_id)
    account.user_id, p.display_name, p.phone, p.invite_code, account.kind, account.label
  FROM (
    SELECT c.account_user_id AS user_id, 'customer'::text AS kind, c.name AS label
      FROM public.customers c WHERE c.user_id = auth.uid() AND c.account_user_id IS NOT NULL
    UNION ALL
    SELECT s.account_user_id, 'supplier', s.name
      FROM public.suppliers s WHERE s.user_id = auth.uid() AND s.account_user_id IS NOT NULL
    UNION ALL
    SELECT c.user_id, 'owner', coalesce(p2.display_name, p2.phone)
      FROM public.customers c LEFT JOIN public.profiles p2 ON p2.id = c.user_id
      WHERE c.account_user_id = auth.uid()
    UNION ALL
    SELECT s.user_id, 'owner', coalesce(p2.display_name, p2.phone)
      FROM public.suppliers s LEFT JOIN public.profiles p2 ON p2.id = s.user_id
      WHERE s.account_user_id = auth.uid()
  ) account
  LEFT JOIN public.profiles p ON p.id = account.user_id
  CROSS JOIN q
  WHERE account.user_id IS NOT NULL
    AND (
      q.raw IS NULL
      OR p.display_name ILIKE '%'||q.raw||'%'
      OR account.label ILIKE '%'||q.raw||'%'
      OR (length(q.pin) >= 3 AND upper(coalesce(p.invite_code, '')) LIKE '%'||q.pin||'%')
    )
  ORDER BY account.user_id, account.kind
$function$;
