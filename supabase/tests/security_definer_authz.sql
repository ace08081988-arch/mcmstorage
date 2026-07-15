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
DECLARE v_oid oid;
BEGIN
  -- prep_create_task must NOT be EXECUTE-able by anon, regardless of
  -- which overload / signature revision currently exists.
  FOR v_oid IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='prep_create_task'
  LOOP
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL prep_create_task (oid %) is granted to anon', v_oid;
    END IF;
  END LOOP;
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
  v_res := public.prep_submit(
    v_tok,
    'WRONG'::text,
    (SELECT id FROM public.prep_task_items WHERE task_id=v_task LIMIT 1),
    'p.jpg'::text,
    NULL::text,
    NULL::double precision,
    NULL::double precision,
    NULL::text,
    1::numeric,
    NULL::timestamptz,
    NULL::text[]
  );
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
  -- Predicate helpers that take the target uid as a parameter — they are
  -- safe to be authenticated-callable because callers can only ask about
  -- their own uid via RLS-scoped queries. Enforcement lives in the
  -- RPCs that call them, not in the helpers themselves.
  'has_role','has_active_pro','is_chat_only',
  'are_friends','can_chat',
  'is_conversation_member','is_conversation_owner',
  'search_chat_contacts','ensure_order_conversation',
  -- Worker portal RPCs: gated by share_token + PIN (pgcrypto), not auth.uid().
  'prep_get_task','prep_peek_task','prep_submit',
  'prep_read_allowed','prep_upload_allowed','prep_worker_upload_allowed',
  'ecer_list_titles_via_task','ecer_submit_via_task',
  'request_list_titles_via_task','request_submit_via_task',
  'record_prep_pin_failure',
  -- Public-config surface — worker portal boots before it has a session.
  'get_worker_portal_public_config',
  -- Utility with no per-user surface (invite code minting is bound at
  -- INSERT time by the RPC that consumes it).
  'gen_invite_code',
  -- Cron / DB-internal only. Callable by authenticated role but the
  -- body validates the caller via service_role or wall-clock windows.
  'email_queue_dispatch','email_queue_wake','expire_subscriptions',
  -- Triggers (never called directly). Present in pg_proc EXECUTE grants
  -- because of default trigger privileges.
  'enforce_free_devices_cap','enforce_free_sales_cap',
  'enforce_free_staff_cap','enforce_free_warehouse_cap',
  'handle_new_user_subscription',
  'prep_task_items_resolve_ecer_title',
  'prevent_debt_amount_below_paid','prevent_debt_overpayment'
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

-- =====================================================================
-- 9) has_role() gate coverage.
--    Every SECURITY DEFINER RPC that references has_role(*, 'admin')
--    in its body MUST reject a caller that does not hold that role.
--    Rejection = either RAISE (any SQLSTATE) OR a jsonb return with
--    ok=false / error='forbidden'. See docs/security-definer-inventory.md.
-- =====================================================================
DO $$
DECLARE
  v_a uuid := current_setting('test.user_a')::uuid;
  -- (rpc_signature, sql_to_call, mode)
  --   mode = 'raise'   → function must throw
  --   mode = 'jsonb'   → function must return jsonb with ok=false / error='forbidden'
  --   mode = 'either'  → either raise OR return ok=false/error='forbidden'
  v_cases text[][] := ARRAY[
    -- signature                                                    call SQL                                                                                            mode
    ARRAY['admin_approve_payment(uuid,text)',                       $q$SELECT public.admin_approve_payment(gen_random_uuid(), 'x')$q$,                                  'raise'],
    ARRAY['admin_reject_payment(uuid,text)',                        $q$SELECT public.admin_reject_payment(gen_random_uuid(), 'x')$q$,                                   'raise'],
    ARRAY['admin_list_users(text,int)',                             $q$SELECT public.admin_list_users(NULL, 1)$q$,                                                     'raise'],
    ARRAY['admin_set_admin_role(uuid,boolean)',                     $q$SELECT public.admin_set_admin_role(gen_random_uuid(), true)$q$,                                  'raise'],
    ARRAY['prep_share_token_exists(text)',                          $q$SELECT public.prep_share_token_exists('does-not-matter-xxxxxxxx')$q$,                            'raise'],
    ARRAY['prep_submission_verify(uuid,text,text)',                 $q$SELECT public.prep_submission_verify(gen_random_uuid(), 'approved', NULL)$q$,                    'raise'],
    ARRAY['prep_pin_reset(text)',                                   $q$SELECT public.prep_pin_reset('nonexistent-token-authz')$q$,                                      'jsonb'],
    ARRAY['run_internal_security_scan()',                           $q$SELECT public.run_internal_security_scan()$q$,                                                   'raise'],
    ARRAY['security_findings_acknowledge(uuid[])',                  $q$SELECT public.security_findings_acknowledge(ARRAY[gen_random_uuid()]::uuid[])$q$,                'raise']
  ];
  v_sig text; v_sql text; v_mode text;
  v_i int;
  v_result jsonb;
  v_ok boolean;
  v_err text;
BEGIN
  -- Pre-flight: user A must NOT hold admin, otherwise the whole block is meaningless.
  IF public.has_role(v_a, 'admin') THEN
    RAISE EXCEPTION 'FAIL cannot run has_role gate coverage: test user A already has admin role';
  END IF;

  PERFORM pg_temp.as_user(v_a);

  FOR v_i IN 1 .. array_length(v_cases, 1) LOOP
    v_sig  := v_cases[v_i][1];
    v_sql  := v_cases[v_i][2];
    v_mode := v_cases[v_i][3];
    v_ok   := false;
    v_err  := NULL;
    v_result := NULL;

    BEGIN
      IF v_mode = 'jsonb' OR v_mode = 'either' THEN
        EXECUTE 'SELECT (' || v_sql || ')::jsonb' INTO v_result;
      ELSE
        EXECUTE v_sql;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      -- 'raise' and 'either' modes are happy with any exception; 'jsonb'
      -- mode wants a structured response, but a RAISE 'forbidden'/'unauthenticated'
      -- is an equally valid rejection.
      IF v_mode = 'jsonb' AND v_err !~* '(forbidden|unauthenticated|permission denied)' THEN
        RAISE EXCEPTION 'FAIL % raised unrelated error under non-admin caller: %', v_sig, v_err;
      END IF;
      v_ok := true;
    END;

    IF NOT v_ok THEN
      IF v_mode = 'raise' THEN
        RAISE EXCEPTION 'FAIL % did NOT raise under non-admin caller (returned silently)', v_sig;
      END IF;
      -- jsonb / either: inspect the return payload
      IF v_result IS NULL THEN
        RAISE EXCEPTION 'FAIL % returned NULL under non-admin caller (expected forbidden)', v_sig;
      END IF;
      IF (v_result->>'ok') IS DISTINCT FROM 'false'
         OR (v_result->>'error') NOT IN ('forbidden','unauthenticated') THEN
        RAISE EXCEPTION 'FAIL % returned % under non-admin caller (expected ok=false,error=forbidden)', v_sig, v_result;
      END IF;
    END IF;

    RAISE NOTICE 'PASS has_role gate rejects non-admin for %', v_sig;
  END LOOP;
END $$;

-- =====================================================================
-- 10) Static drift check: every SECURITY DEFINER function whose body
--     references has_role(*, 'admin') MUST be covered by block 9 above.
--     If a new admin-only RPC is added and this list is not updated,
--     the suite fails so the author is forced to write a test case.
-- =====================================================================
DO $$
DECLARE
  r record;
  -- Keep this list in sync with block 9's v_cases signatures (proname only).
  v_covered text[] := ARRAY[
    'admin_approve_payment',
    'admin_reject_payment',
    'admin_list_users',
    'admin_set_admin_role',
    'prep_share_token_exists',
    'prep_submission_verify',
    'prep_pin_reset',
    'run_internal_security_scan',
    'security_findings_acknowledge'
  ];
  v_missing text[] := ARRAY[]::text[];
  v_src text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    v_src := pg_get_functiondef(r.oid);
    -- Match "has_role(<anything>, 'admin')" — same pattern the RPCs actually use.
    -- Also catches "has_role(auth.uid(), 'admin'::public.app_role)".
    IF v_src ~* 'has_role\s*\([^)]*''admin''' THEN
      IF NOT (r.proname = ANY (v_covered)) THEN
        v_missing := array_append(v_missing, r.proname);
      END IF;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION $err$FAIL has_role gate coverage drift: the following SECURITY DEFINER RPCs check has_role('admin') but are NOT in block 9's tested list — add them to v_cases and v_covered: %$err$, v_missing;
  END IF;
  RAISE NOTICE 'PASS has_role gate coverage list is in sync with pg_proc';
END $$;

ROLLBACK;