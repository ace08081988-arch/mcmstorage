CREATE OR REPLACE FUNCTION public.are_friends(_a uuid, _b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (_a IS NOT NULL AND _b IS NOT NULL) AND (
    _a = _b OR EXISTS (
      SELECT 1 FROM public.friend_requests fr
      WHERE fr.status = 'accepted'
        AND (
          (fr.from_user = _a AND fr.to_user = _b)
          OR (fr.from_user = _b AND fr.to_user = _a)
        )
    )
  )
$function$;