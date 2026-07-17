REVOKE EXECUTE ON FUNCTION public.repair_missing_request_task_title_links(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.repair_missing_request_task_title_links(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.repair_missing_request_task_title_links(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_missing_request_task_title_links(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.auto_repair_request_task_title_link() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_repair_request_task_title_link() FROM anon;
GRANT EXECUTE ON FUNCTION public.auto_repair_request_task_title_link() TO service_role;