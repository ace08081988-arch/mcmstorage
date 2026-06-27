GRANT EXECUTE ON FUNCTION public.search_profiles_for_link(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.search_profiles_for_link(text) FROM anon, public;