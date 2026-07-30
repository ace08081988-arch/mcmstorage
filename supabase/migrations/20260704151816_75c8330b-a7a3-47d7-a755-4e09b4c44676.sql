DROP FUNCTION IF EXISTS public.search_chat_contacts(text);

CREATE FUNCTION public.search_chat_contacts(_q text)
 RETURNS TABLE(user_id uuid, display_name text, invite_code text, kind text, label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH q AS (
    SELECT
      nullif(trim(coalesce(_q, '')), '') AS raw,
      upper(regexp_replace(coalesce(_q, ''), '[\s\-_]', '', 'g')) AS pin
  )
  SELECT DISTINCT ON (account.user_id)
    account.user_id, p.display_name, p.invite_code, account.kind, account.label
  FROM (
    SELECT c.account_user_id AS user_id, 'customer'::text AS kind, c.name AS label
      FROM public.customers c WHERE c.user_id = auth.uid() AND c.account_user_id IS NOT NULL
    UNION ALL
    SELECT s.account_user_id, 'supplier', s.name
      FROM public.suppliers s WHERE s.user_id = auth.uid() AND s.account_user_id IS NOT NULL
    UNION ALL
    SELECT c.user_id, 'owner', coalesce(p2.display_name, p2.invite_code)
      FROM public.customers c LEFT JOIN public.profiles p2 ON p2.id = c.user_id
      WHERE c.account_user_id = auth.uid()
    UNION ALL
    SELECT s.user_id, 'owner', coalesce(p2.display_name, p2.invite_code)
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

REVOKE ALL ON FUNCTION public.search_chat_contacts(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_chat_contacts(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_chat_contacts(text) TO authenticated;