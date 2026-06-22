-- Revoke anon EXECUTE on SECURITY DEFINER functions that are not meant to be callable without auth.
-- Worker-share endpoints (prep_get_task, prep_submit, request_*_via_task, ecer_*_via_task) keep anon access
-- because the unauthenticated worker UI calls them with share token + PIN.

REVOKE EXECUTE ON FUNCTION public.run_internal_security_scan() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.security_findings_acknowledge(uuid[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.search_chat_contacts(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.prep_pin_locked_until(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.prep_upload_allowed(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.prep_worker_upload_allowed(uuid, text) FROM anon, public;

-- Ensure authenticated/service_role retain the access they need.
GRANT EXECUTE ON FUNCTION public.run_internal_security_scan() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.security_findings_acknowledge(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_chat_contacts(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prep_pin_locked_until(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prep_upload_allowed(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prep_worker_upload_allowed(uuid, text) TO service_role;