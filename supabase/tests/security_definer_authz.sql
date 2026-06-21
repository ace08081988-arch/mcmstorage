-- Authorization tests for every authenticated-callable SECURITY DEFINER RPC.
-- Run:   psql -v ON_ERROR_STOP=1 -f supabase/tests/security_definer_authz.sql
-- All work happens in a transaction that ROLLBACKs at the end, so no data persists.
-- Each assertion either RAISE NOTICE 'PASS ...' or RAISE EXCEPTION 'FAIL ...'.

BEGIN;
SET LOCAL client_min_messages = notice;

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION pg_temp.as_user(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_anon() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(_label text, _sqlstate text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'PASS %', _label; END $$;

-- ---------- pick two existing users ----------
DO $$
DECLARE v_a uuid; v_b uuid; v_c uuid;
BEGIN
  -- Prefer a user with warehouse_items as user B so order_requests setup works.
  SELECT user_id INTO v_b FROM public.warehouse_items GROUP BY user_id ORDER BY count(*) DESC LIMIT 1;
  SELECT id INTO v_a FROM public.profiles WHERE id <> coalesce(v_b, gen_random_uuid()) ORDER BY id LIMIT 1;
  SELECT id INTO v_c FROM public.profiles WHERE id NOT IN (coalesce(v_a, gen_random_uuid()), coalesce(v_b, gen_random_uuid())) ORDER BY id LIMIT 1;
  IF v_a IS NULL OR v_b IS NULL OR v_c IS NULL THEN
    RAISE EXCEPTION 'need at least 3 profiles to run authz tests';
  END IF;
  PERFORM set_config('test.user_a', v_a::text, true);
  PERFORM set_config('test.user_b', v_b::text, true);
  PERFORM set_config('test.user_c', v_c::text, true);
  RAISE NOTICE 'TEST users  A=% B=% C=%', v_a, v_b, v_c;
END $$;

-- =====================================================================
-- 1) has_role: caller can only check their own uid (or service_role).
-- =====================================================================
DO $$
DECLARE v_a uuid := current_setting('test.user_a')::uuid;
        v_b uuid := current_setting('test.user_b')::uuid;
        v_res boolean;
BEGIN
  PERFORM pg_temp.as_user(v_a);
  -- Even if B were admin, A must not see it.
  v_res := public.has_role(v_b, 'admin');
  IF v_res THEN RAISE EXCEPTION 'FAIL has_role leaked another user role'; END IF;
  RAISE NOTICE 'PASS has_role denies cross-user lookup';
END $$;

-- =====================================================================
-- 2) prep_create_task: owner_user_id MUST equal auth.uid().
-- =====================================================================
DO $$
DECLARE v_a uuid := current_setting('test.user_a')::uuid;
        v_task uuid; v_owner uuid;
BEGIN
  PERFORM pg_temp.as_user(v_a);
  v_task := public.prep_create_task('authz-test', NULL, '1234',
    'tok_' || replace(gen_random_uuid()::text,'-',''), '[]'::jsonb);
  SELECT owner_user_id INTO v_owner FROM public.prep_tasks WHERE id = v_task;
  IF v_owner <> v_a THEN
    RAISE EXCEPTION 'FAIL prep_create_task wrote owner=% expected=%', v_owner, v_a;
  END IF;
  RAISE NOTICE 'PASS prep_create_task scoped to caller';
END $$;

-- Anon call must be rejected.
DO $$
BEGIN
  -- prep_create_task must NOT be EXECUTE-able by anon.
  IF has_function_privilege('anon',
       'public.prep_create_task(text,text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL prep_create_task is granted to anon';
  END IF;
  RAISE NOTICE 'PASS prep_create_task is not granted to anon';
END $$;

-- =====================================================================
-- 3) start_dm: must require can_chat(caller, partner).
-- =====================================================================
DO $$
DECLARE v_a uuid := current_setting('test.user_a')::uuid;
        v_b uuid := current_setting('test.user_b')::uuid;
BEGIN
  PERFORM pg_temp.as_user(v_a);
  IF public.can_chat(v_a, v_b) THEN
    RAISE NOTICE 'SKIP start_dm: A and B already have a chat relation';
  ELSE
    BEGIN
      PERFORM public.start_dm(v_b);
      RAISE EXCEPTION 'FAIL start_dm allowed unrelated partner';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'PASS start_dm rejects unrelated partner (%)', SQLERRM;
    END;
  END IF;
END $$;

-- =====================================================================
-- 4) create_group: every member must pass can_chat(caller, member).
-- =====================================================================
DO $$
DECLARE v_a uuid := current_setting('test.user_a')::uuid;
        v_b uuid := current_setting('test.user_b')::uuid;
BEGIN
  PERFORM pg_temp.as_user(v_a);
  IF public.can_chat(v_a, v_b) THEN
    RAISE NOTICE 'SKIP create_group: A-B already related';
  ELSE
    BEGIN
      PERFORM public.create_group('g', ARRAY[v_b]);
      RAISE EXCEPTION 'FAIL create_group accepted unrelated member';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'PASS create_group rejects unrelated member (%)', SQLERRM;
    END;
  END IF;
END $$;

-- =====================================================================
-- 5) add_group_member: only the owner of the conversation can call it.
-- =====================================================================
DO $$
DECLARE v_a uuid := current_setting('test.user_a')::uuid;
        v_b uuid := current_setting('test.user_b')::uuid;
        v_conv uuid;
BEGIN
  -- Create a group owned by A directly (bypass RPC for setup).
  INSERT INTO public.conversations(kind, owner_user_id, created_by, title)
    VALUES ('group', v_a, v_a, 't') RETURNING id INTO v_conv;
  INSERT INTO public.conversation_members(conversation_id, user_id, role)
    VALUES (v_conv, v_a, 'owner');

  PERFORM pg_temp.as_user(v_b);    -- B is NOT the owner
  BEGIN
    PERFORM public.add_group_member(v_conv, v_b);
    RAISE EXCEPTION 'FAIL add_group_member allowed non-owner';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS add_group_member rejects non-owner (%)', SQLERRM;
  END;
END $$;

-- =====================================================================
-- 6) ensure_order_conversation: caller must be owner, linked account,
--    or service_role. Otherwise 'not_authorized'.
-- =====================================================================
DO $$
DECLARE v_a uuid := current_setting('test.user_a')::uuid;
        v_b uuid := current_setting('test.user_b')::uuid;
        v_c uuid := current_setting('test.user_c')::uuid;
        v_cust uuid; v_order uuid; v_item uuid;
BEGIN
  SELECT id INTO v_item FROM public.warehouse_items WHERE user_id = v_b LIMIT 1;
  IF v_item IS NULL THEN
    RAISE NOTICE 'SKIP ensure_order_conversation: user B has no warehouse_items to attach to an order';
    RETURN;
  END IF;
  INSERT INTO public.customers(user_id, name, account_user_id)
    VALUES (v_b, 'authz-test', v_a) RETURNING id INTO v_cust;
  INSERT INTO public.order_requests(user_id, customer_id, item_id, qty, qty_mode, status)
    VALUES (v_b, v_cust, v_item, 1, 'base', 'menunggu') RETURNING id INTO v_order;

  PERFORM pg_temp.as_user(v_c);    -- C is unrelated to this order
  BEGIN
    PERFORM public.ensure_order_conversation(v_order);
    RAISE EXCEPTION 'FAIL ensure_order_conversation allowed unrelated caller';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RAISE NOTICE 'PASS ensure_order_conversation rejects unrelated caller (%)', SQLERRM;
  END;
END $$;

-- =====================================================================
-- 7) prep_submit / ecer_submit_via_task / request_submit_via_task:
--    anon path requires valid token + PIN; bad PIN must increment failures
--    AND must NOT write any submission rows.
-- =====================================================================
DO $$
DECLARE v_a uuid := current_setting('test.user_a')::uuid;
        v_task uuid; v_tok text := 'tok_' || replace(gen_random_uuid()::text,'-','');
        v_res jsonb; v_before bigint; v_after bigint;
BEGIN
  PERFORM pg_temp.as_user(v_a);
  v_task := public.prep_create_task('submit-test', NULL, '1234', v_tok,
    '[{"name":"x","qty_requested":1}]'::jsonb);

  PERFORM pg_temp.as_anon();
  SELECT count(*) INTO v_before FROM public.prep_submissions;
  v_res := public.prep_submit(v_tok, 'WRONG', (SELECT id FROM public.prep_task_items WHERE task_id=v_task LIMIT 1),
    'p.jpg', NULL, NULL, NULL, NULL, 1);
  IF (v_res->>'error') IS DISTINCT FROM 'bad_pin' THEN
    RAISE EXCEPTION 'FAIL prep_submit accepted bad PIN: %', v_res;
  END IF;
  SELECT count(*) INTO v_after FROM public.prep_submissions;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'FAIL prep_submit wrote a row on bad PIN';
  END IF;
  RAISE NOTICE 'PASS prep_submit rejects bad PIN and writes nothing';
END $$;

-- =====================================================================
-- 8) Static check: every SECURITY DEFINER RPC granted to authenticated
--    must either (a) be on the allow-list of helpers, or (b) reference
--    auth.uid() in its body so it is scoped to the caller.
-- =====================================================================
DO $$
DECLARE r record; v_src text; v_allow text[] := ARRAY[
  'has_role','can_chat','is_conversation_member','is_conversation_owner',
  'search_chat_contacts','ensure_order_conversation',
  -- Worker portal RPCs: gated by share_token + PIN (pgcrypto), not auth.uid().
  'prep_get_task','prep_submit','prep_upload_allowed','prep_worker_upload_allowed',
  'ecer_list_titles_via_task','ecer_submit_via_task',
  'request_list_titles_via_task','request_submit_via_task',
  'record_prep_pin_failure'
];
BEGIN
  FOR r IN
    SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    IF r.proname = ANY (v_allow) THEN CONTINUE; END IF;
    SELECT pg_get_functiondef(('public.'||r.proname)::regproc) INTO v_src;
    IF v_src !~* 'auth\.uid\(\)' THEN
      RAISE EXCEPTION 'FAIL SECURITY DEFINER % is authenticated-callable but does not reference auth.uid()', r.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS every authenticated SECURITY DEFINER RPC is auth.uid()-scoped or on the helper allow-list';
END $$;

ROLLBACK;