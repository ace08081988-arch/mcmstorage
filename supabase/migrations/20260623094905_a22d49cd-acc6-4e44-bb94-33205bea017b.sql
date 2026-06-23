
-- Revoke EXECUTE from PUBLIC on every public-schema SECURITY DEFINER function;
-- keep explicit grants only where needed.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- Trigger functions: never called directly; triggers fire with owner rights.
REVOKE EXECUTE ON FUNCTION public.prep_broadcast_change()          FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_profile()        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_profile_from_auth()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_conversation_on_message()  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_order_status_change()        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_ensure_order_conv()          FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_customer_account_linked()    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.messages_lock_immutable_columns()           FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.conversation_members_lock_immutable_columns() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_sale()                     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_purchase()                 FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_ready_package()            FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_ecer_preparation()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_request_preparation_item() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_security_scan_hook_secret_updated_at() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column()       FROM anon, authenticated;

-- Internal helpers (called only by other SECURITY DEFINER functions or service_role jobs).
REVOKE EXECUTE ON FUNCTION public.prep_pin_locked_until(text)              FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_prep_pin_failure(text)            FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_email_cron_secret()                  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint)               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb)   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb)               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_health()                     FROM anon, authenticated;

-- Anonymous role shouldn't reach owner-only RPCs even if it was granted before.
REVOKE EXECUTE ON FUNCTION public.prep_create_task(text, text, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.prep_reset_pin(uuid, text)                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.prep_pin_reset(text)                             FROM anon;
REVOKE EXECUTE ON FUNCTION public.security_findings_acknowledge(uuid[])            FROM anon;
REVOKE EXECUTE ON FUNCTION public.run_internal_security_scan()                     FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_acknowledge_rate_limit()                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_chat_contacts(text)                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_profiles_for_link(text)                   FROM anon;
