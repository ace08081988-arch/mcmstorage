
CREATE OR REPLACE FUNCTION public.search_profiles_for_link(_q text)
RETURNS TABLE(user_id uuid, display_name text, phone text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH q AS (
    SELECT
      nullif(trim(coalesce(_q, '')), '') AS raw,
      regexp_replace(coalesce(_q, ''), '\D', '', 'g') AS digits
  )
  SELECT p.id, p.display_name, p.phone
  FROM public.profiles p
  CROSS JOIN q
  WHERE p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    AND (
      q.raw IS NULL
      OR p.display_name ILIKE '%'||q.raw||'%'
      OR p.email ILIKE '%'||q.raw||'%'
      OR (
        length(q.digits) >= 3
        AND regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') ILIKE '%'||q.digits||'%'
      )
    )
  ORDER BY p.display_name NULLS LAST, p.phone NULLS LAST
  LIMIT 25
$$;

GRANT EXECUTE ON FUNCTION public.search_profiles_for_link(text) TO authenticated;
