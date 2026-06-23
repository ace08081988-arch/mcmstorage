-- Revoke default PUBLIC execute on all SECURITY DEFINER public functions
REVOKE EXECUTE ON FUNCTION public.add_group_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_chat(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_acknowledge_rate_limit() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_group(text, uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ensure_order_conversation(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_conversation_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prep_create_task(text, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prep_reset_pin(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.run_internal_security_scan() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_chat_contacts(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_profiles_for_link(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.security_findings_acknowledge(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_dm(uuid) FROM PUBLIC, anon;

-- Internal/maintenance functions: revoke from both anon and authenticated (called only by triggers / service_role / cron)
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_health() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_email_cron_secret() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_prep_pin_failure(text) FROM PUBLIC, anon, authenticated;

-- Worker share-token endpoints stay callable by anon (token + PIN gated inside)
-- Keep: prep_pin_locked_until, prep_get_task, prep_submit,
--       request_list_titles_via_task, request_submit_via_task,
--       ecer_list_titles_via_task, ecer_submit_via_task,
--       prep_upload_allowed, prep_worker_upload_allowed (used by storage policies)