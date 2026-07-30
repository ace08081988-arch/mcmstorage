DROP FUNCTION IF EXISTS public.prep_create_task(text, text, text, text, jsonb, timestamp with time zone, integer);

REVOKE ALL ON FUNCTION public.prep_create_task(text, text, text, text, jsonb, timestamp with time zone, integer, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.prep_create_task(text, text, text, text, jsonb, timestamp with time zone, integer, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prep_create_task(text, text, text, text, jsonb, timestamp with time zone, integer, uuid[]) TO service_role;