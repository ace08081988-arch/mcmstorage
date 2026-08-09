-- Sprint 2 / Tahap 2 — pengetatan akses anonim (forward-only, tidak mengubah data)

-- A) Fungsi milik pemilik akun: cabut anon, pastikan authenticated tetap punya izin
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN (
        'chat_clear_conversation_for_me','chat_heartbeat','chat_link_business',
        'chat_mark_delivered','chat_mute','chat_search_messages','chat_set_archive',
        'chat_set_pin','create_chat_cart',
        'message_delete_all_mine','message_delete_for_all','message_edit',
        'message_hide_for_me','message_react',
        'send_request_prep_to_customer','send_ecer_preps_to_customer',
        'unsend_request_prep','unsend_request_prep_check','fix_request_prep_payment',
        'pos_commit_sale','next_doc_number','match_address_book_profiles',
        'prep_submissions_mark_sent','prep_submissions_unmark_sent',
        'prep_submission_verify','gen_invite_code','has_active_pro','is_chat_only'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END
$do$;

-- B) Fungsi pemicu (trigger) internal: tidak boleh dipanggil langsung sama sekali
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND pg_get_function_result(p.oid) = 'trigger'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$do$;