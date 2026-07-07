
REVOKE ALL ON FUNCTION public.trg_ready_packages_status_email() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_order_requests_status_email() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_ready_packages_status_email() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_order_requests_status_email() TO service_role;
