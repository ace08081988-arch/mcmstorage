CREATE OR REPLACE FUNCTION public.match_address_book_profiles(_phones text[] DEFAULT NULL::text[], _emails text[] DEFAULT NULL::text[])
 RETURNS TABLE(match_key text, match_kind text, user_id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _max_batch constant int := 100;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  IF coalesce(array_length(_phones, 1), 0) + coalesce(array_length(_emails, 1), 0) > _max_batch THEN
    RAISE EXCEPTION 'match_address_book_profiles: too many entries (max % per call)', _max_batch
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT public.normalize_phone(p) AS match_key,
         'phone'::text AS match_kind,
         pr.id AS user_id,
         pr.display_name
    FROM unnest(coalesce(_phones, ARRAY[]::text[])) AS p
    JOIN public.profiles pr ON public.normalize_phone(pr.phone) = public.normalize_phone(p)
   WHERE public.normalize_phone(p) IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.address_book ab
        WHERE ab.user_id = _uid
          AND ab.phone_norm = public.normalize_phone(p)
     )
  UNION
  SELECT lower(btrim(e)) AS match_key,
         'email'::text AS match_kind,
         pr.id AS user_id,
         pr.display_name
    FROM unnest(coalesce(_emails, ARRAY[]::text[])) AS e
    JOIN public.profiles pr ON lower(btrim(pr.email)) = lower(btrim(e))
   WHERE length(btrim(e)) > 0
     AND EXISTS (
       SELECT 1 FROM public.address_book ab
        WHERE ab.user_id = _uid
          AND ab.email_norm = lower(btrim(e))
     );
END;
$function$;