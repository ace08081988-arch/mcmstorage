-- Tighten EXECUTE on SECURITY DEFINER functions:
-- - Trigger-only / service-role-only functions: revoke from PUBLIC, anon, authenticated.
-- - Anon-callable RPCs (share_token + PIN flows): keep anon + authenticated, revoke PUBLIC.
-- - Authenticated-only RPCs: revoke anon, keep authenticated.

-- 1) Trigger / service-role only (never callable via Data API)
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN
    SELECT unnest(ARRAY[
      'public.update_updated_at_column()',
      'public.log_order_status_change()',
      'public.apply_sale()',
      'public.apply_purchase()',
      'public.apply_request_preparation_item()',
      'public.apply_ready_package()',
      'public.apply_ecer_preparation()',
      'public.handle_new_user_profile()',
      'public.sync_profile_from_auth()',
      'public.touch_conversation_on_message()',
      'public.trg_ensure_order_conv()',
      'public.trg_customer_account_linked()',
      'public.email_queue_health()',
      'public.enqueue_email(text, jsonb)',
      'public.delete_email(text, bigint)',
      'public.read_email_batch(text, integer, integer)',
      'public.move_to_dlq(text, text, bigint, jsonb)',
      'public.get_email_cron_secret()',
      'public.record_prep_pin_failure(text)'
    ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

-- 2) Anon-callable share_token + PIN RPCs (must remain callable without auth)
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN
    SELECT unnest(ARRAY[
      'public.prep_get_task(text, text)',
      'public.prep_submit(text, text, uuid, text, text, double precision, double precision, text, numeric)',
      'public.ecer_list_titles_via_task(text, text, uuid)',
      'public.ecer_submit_via_task(text, text, uuid, numeric, text, text, double precision, double precision, text, uuid)',
      'public.request_list_titles_via_task(text, text)',
      'public.request_submit_via_task(text, text, uuid, jsonb, text, text, double precision, double precision, text, uuid)',
      'public.prep_upload_allowed(text)',
      'public.prep_worker_upload_allowed(uuid, text)'
    ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', fn);
  END LOOP;
END $$;

-- 3) Authenticated-only RPCs (signed-in users only; internal auth.uid() checks enforce scope)
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN
    SELECT unnest(ARRAY[
      'public.prep_create_task(text, text, text, text, jsonb)',
      'public.start_dm(uuid)',
      'public.create_group(text, uuid[])',
      'public.add_group_member(uuid, uuid)',
      'public.ensure_order_conversation(uuid)',
      'public.has_role(uuid, public.app_role)',
      'public.can_chat(uuid, uuid)',
      'public.is_conversation_member(uuid, uuid)',
      'public.is_conversation_owner(uuid, uuid)',
      'public.search_chat_contacts(text)'
    ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;
