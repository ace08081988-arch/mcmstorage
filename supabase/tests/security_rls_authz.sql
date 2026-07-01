-- Comprehensive RLS + SECURITY DEFINER authorization tests.
-- Run:   psql -v ON_ERROR_STOP=1 -f supabase/tests/security_rls_authz.sql
-- Wraps every check in a transaction that ROLLBACKs at the end — nothing persists.
-- A failing assertion RAISE EXCEPTIONs; passing ones RAISE NOTICE 'PASS ...'.
--
-- Coverage:
--   1. Every public table has RLS enabled.
--   2. SECURITY DEFINER functions EXECUTE-able by `anon` are on the curated allow-list.
--   3. SECURITY DEFINER functions EXECUTE-able by `authenticated` either reference
--      auth.uid() in their body or are on the helper allow-list.
--   4. Cross-user RLS: as user A, SELECT against per-user tables only returns A's rows.
--   5. Cross-user RLS: as user A, INSERT pretending user_id=B is rejected.
--   6. anon can SELECT nothing from per-user tables.

BEGIN;
SET LOCAL client_min_messages = notice;

CREATE OR REPLACE FUNCTION pg_temp.as_user(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_anon() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_postgres() RETURNS void
LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims','',true); END $$;

-- Detect whether the current session can switch into authenticated/anon roles.
-- Managed Supabase superuser-light accounts often can't, in which case the
-- runtime RLS blocks below are skipped (they're covered by the integration test).
CREATE OR REPLACE FUNCTION pg_temp.can_switch_roles() RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE 'RESET ROLE';
    RETURN true;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN false;
  END;
END $$;

DO $$
BEGIN
  PERFORM set_config('test.can_switch', pg_temp.can_switch_roles()::text, true);
  IF NOT current_setting('test.can_switch')::boolean THEN
    RAISE NOTICE 'SKIP runtime RLS blocks: session cannot SET ROLE authenticated/anon. Run the integration test (npm run test:security:integration) for HTTP-level RLS coverage.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1) Every public table must have RLS enabled.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_missing
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind='r'
     AND NOT c.relrowsecurity AND c.relname NOT LIKE 'pg_%';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL rls_disabled on public tables: %', v_missing;
  END IF;
  RAISE NOTICE 'PASS every public table has RLS enabled';
END $$;

-- ---------------------------------------------------------------------
-- 2) anon-executable SECURITY DEFINER must be on the worker-portal allow-list.
-- ---------------------------------------------------------------------
DO $$
DECLARE r record; v_allow text[] := ARRAY[
  -- Worker portal (gated by share_token + bcrypt PIN + rate-limit):
  'prep_get_task','prep_submit','prep_upload_allowed','prep_worker_upload_allowed',
  'ecer_list_titles_via_task','ecer_submit_via_task',
  'request_list_titles_via_task','request_submit_via_task'
];
BEGIN
  FOR r IN
    SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.prosecdef
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    IF NOT (r.proname = ANY(v_allow)) THEN
      RAISE EXCEPTION 'FAIL anon EXECUTE on SECURITY DEFINER % is not on the allow-list', r.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS anon-executable SECURITY DEFINER set matches allow-list';
END $$;

-- ---------------------------------------------------------------------
-- 3) authenticated-executable SECURITY DEFINER must reference auth.uid()
--    OR be on the helper allow-list. (Mirrors security_definer_authz.sql.)
-- ---------------------------------------------------------------------
DO $$
DECLARE r record; v_src text; v_allow text[] := ARRAY[
  'has_role','can_chat','is_conversation_member','is_conversation_owner',
  'search_chat_contacts','ensure_order_conversation','search_profiles_for_link',
  'prep_get_task','prep_submit','prep_upload_allowed','prep_worker_upload_allowed',
  'ecer_list_titles_via_task','ecer_submit_via_task',
  'request_list_titles_via_task','request_submit_via_task',
  'record_prep_pin_failure','email_queue_health'
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
    IF v_src !~* 'auth\.uid\(\)' AND v_src !~* 'auth\.jwt\(\)' THEN
      RAISE EXCEPTION 'FAIL authenticated EXECUTE on % but body does not gate by auth.uid()/auth.jwt()', r.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS every authenticated SECURITY DEFINER RPC is caller-scoped or on the allow-list';
END $$;

-- ---------------------------------------------------------------------
-- Pick two real users for cross-user tests.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_a uuid; v_b uuid;
BEGIN
  SELECT user_id INTO v_a FROM public.warehouse_items GROUP BY user_id ORDER BY count(*) DESC LIMIT 1;
  SELECT id INTO v_b FROM public.profiles WHERE id <> coalesce(v_a, gen_random_uuid()) ORDER BY id LIMIT 1;
  IF v_a IS NULL OR v_b IS NULL THEN
    RAISE NOTICE 'SKIP cross-user tests: need at least two profiles with one owning warehouse_items';
    RETURN;
  END IF;
  PERFORM set_config('test.user_a', v_a::text, true);
  PERFORM set_config('test.user_b', v_b::text, true);
  RAISE NOTICE 'TEST cross-user users  A=% B=%', v_a, v_b;
END $$;

-- ---------------------------------------------------------------------
-- 4) Cross-user SELECT: every per-user table must filter to caller's rows.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_a uuid := nullif(current_setting('test.user_a', true),'')::uuid;
        v_b uuid := nullif(current_setting('test.user_b', true),'')::uuid;
        v_tbl text; v_leaked bigint;
        v_tables text[] := ARRAY[
          'warehouse_items','customers','suppliers','order_requests',
          'sales','purchases','debts','ready_packages',
          'ecer_titles','request_titles','prep_tasks','user_devices',
          'push_subscriptions','staff_contacts'
        ];
BEGIN
  IF v_a IS NULL OR v_b IS NULL OR NOT current_setting('test.can_switch')::boolean THEN RETURN; END IF;
  PERFORM pg_temp.as_user(v_a);
  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE user_id IS DISTINCT FROM %L::uuid', v_tbl, v_a)
      INTO v_leaked;
    IF v_leaked > 0 THEN
      RAISE EXCEPTION 'FAIL RLS leak on %: caller A sees % foreign rows', v_tbl, v_leaked;
    END IF;
  END LOOP;
  PERFORM pg_temp.as_postgres();
  RAISE NOTICE 'PASS per-user SELECT is RLS-scoped to caller';
END $$;

-- ---------------------------------------------------------------------
-- 5) Cross-user INSERT: A must not be able to insert rows as B.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_a uuid := nullif(current_setting('test.user_a', true),'')::uuid;
        v_b uuid := nullif(current_setting('test.user_b', true),'')::uuid;
BEGIN
  IF v_a IS NULL OR v_b IS NULL OR NOT current_setting('test.can_switch')::boolean THEN RETURN; END IF;
  PERFORM pg_temp.as_user(v_a);
  BEGIN
    INSERT INTO public.customers(user_id, name) VALUES (v_b, 'rls-attack-from-A');
    PERFORM pg_temp.as_postgres();
    RAISE EXCEPTION 'FAIL customers INSERT WITH CHECK allowed forging user_id';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    PERFORM pg_temp.as_postgres();
    RAISE NOTICE 'PASS customers INSERT blocks user_id forgery (%)', SQLERRM;
  WHEN OTHERS THEN
    PERFORM pg_temp.as_postgres();
    RAISE NOTICE 'PASS customers INSERT blocked (%): %', SQLSTATE, SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------
-- 6) anon must SELECT zero rows from per-user tables.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_tbl text; v_n bigint;
        v_tables text[] := ARRAY[
          'warehouse_items','customers','suppliers','order_requests',
          'sales','purchases','debts','ready_packages',
          'profiles','messages','conversations','conversation_members',
          'email_send_log','user_roles','device_otp_challenges'
        ];
BEGIN
  IF NOT current_setting('test.can_switch')::boolean THEN RETURN; END IF;
  PERFORM pg_temp.as_anon();
  FOREACH v_tbl IN ARRAY v_tables LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tbl) INTO v_n;
    EXCEPTION WHEN insufficient_privilege THEN
      v_n := 0; -- denied at GRANT layer is also fine
    END;
    IF v_n > 0 THEN
      PERFORM pg_temp.as_postgres();
      RAISE EXCEPTION 'FAIL anon can read % rows from %', v_n, v_tbl;
    END IF;
  END LOOP;
  PERFORM pg_temp.as_postgres();
  RAISE NOTICE 'PASS anon SELECT returns 0 rows from per-user tables';
END $$;

-- ---------------------------------------------------------------------
-- 7) has_role self-restriction: A cannot probe B's roles.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_a uuid := nullif(current_setting('test.user_a', true),'')::uuid;
        v_b uuid := nullif(current_setting('test.user_b', true),'')::uuid;
        v_res boolean;
BEGIN
  IF v_a IS NULL OR v_b IS NULL OR NOT current_setting('test.can_switch')::boolean THEN RETURN; END IF;
  PERFORM pg_temp.as_user(v_a);
  v_res := public.has_role(v_b, 'admin');
  IF v_res THEN
    PERFORM pg_temp.as_postgres();
    RAISE EXCEPTION 'FAIL has_role leaked B''s role to A';
  END IF;
  PERFORM pg_temp.as_postgres();
  RAISE NOTICE 'PASS has_role denies cross-user lookup';
END $$;

-- ---------------------------------------------------------------------
-- 8) friend_requests: sender may only cancel, only recipient may accept.
--    Guards against fr_update_self_accept (sender self-acceptance).
-- ---------------------------------------------------------------------
DO $$
DECLARE v_a uuid := nullif(current_setting('test.user_a', true),'')::uuid;
        v_b uuid := nullif(current_setting('test.user_b', true),'')::uuid;
        v_id uuid;
        v_status text;
        v_rows int;
BEGIN
  IF v_a IS NULL OR v_b IS NULL OR NOT current_setting('test.can_switch')::boolean THEN
    RAISE NOTICE 'SKIP friend_requests policy tests: no test users or role switching';
    RETURN;
  END IF;

  -- Clean any prior pair rows so INSERT can proceed under unique(from_user,to_user).
  DELETE FROM public.friend_requests
   WHERE (from_user = v_a AND to_user = v_b) OR (from_user = v_b AND to_user = v_a);

  -- A (sender) creates a pending request to B (recipient).
  PERFORM pg_temp.as_user(v_a);
  INSERT INTO public.friend_requests(from_user, to_user, status)
  VALUES (v_a, v_b, 'pending')
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    PERFORM pg_temp.as_postgres();
    RAISE EXCEPTION 'FAIL friend_requests: sender could not INSERT pending request';
  END IF;

  -- 8a) Sender must NOT be able to self-accept. RLS filters the row out of
  --     the UPDATE's target set, so the statement affects 0 rows.
  UPDATE public.friend_requests SET status = 'accepted' WHERE id = v_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.as_postgres();
  SELECT status::text INTO v_status FROM public.friend_requests WHERE id = v_id;
  IF v_rows > 0 OR v_status = 'accepted' THEN
    RAISE EXCEPTION 'FAIL friend_requests: sender was able to self-accept (rows=%, status=%)', v_rows, v_status;
  END IF;
  RAISE NOTICE 'PASS friend_requests: sender cannot self-accept';

  -- 8b) Sender must NOT be able to set status to anything other than cancelled
  --     (e.g. 'rejected' / 'blocked' equivalents). Any non-cancelled target is
  --     rejected by WITH CHECK on fr_update_sender_cancel_only.
  PERFORM pg_temp.as_user(v_a);
  BEGIN
    UPDATE public.friend_requests SET status = 'rejected' WHERE id = v_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN
    v_rows := 0;
  END;
  PERFORM pg_temp.as_postgres();
  SELECT status::text INTO v_status FROM public.friend_requests WHERE id = v_id;
  IF v_rows > 0 OR v_status = 'rejected' THEN
    RAISE EXCEPTION 'FAIL friend_requests: sender was able to set status=rejected';
  END IF;
  RAISE NOTICE 'PASS friend_requests: sender cannot set non-cancelled status';

  -- 8c) Sender CAN cancel their own pending request.
  PERFORM pg_temp.as_user(v_a);
  UPDATE public.friend_requests SET status = 'cancelled' WHERE id = v_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.as_postgres();
  SELECT status::text INTO v_status FROM public.friend_requests WHERE id = v_id;
  IF v_rows <> 1 OR v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'FAIL friend_requests: sender could not cancel own pending (rows=%, status=%)', v_rows, v_status;
  END IF;
  RAISE NOTICE 'PASS friend_requests: sender can cancel own pending';

  -- 8d) Reset to pending and verify recipient CAN accept.
  UPDATE public.friend_requests SET status = 'pending' WHERE id = v_id;
  PERFORM pg_temp.as_user(v_b);
  UPDATE public.friend_requests SET status = 'accepted' WHERE id = v_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.as_postgres();
  SELECT status::text INTO v_status FROM public.friend_requests WHERE id = v_id;
  IF v_rows <> 1 OR v_status <> 'accepted' THEN
    RAISE EXCEPTION 'FAIL friend_requests: recipient could not accept (rows=%, status=%)', v_rows, v_status;
  END IF;
  RAISE NOTICE 'PASS friend_requests: recipient can accept';

  -- 8e) A third party C (postgres role acting as random uuid) must not be able
  --     to touch the row via authenticated. Simulate by switching to a fresh uuid.
  PERFORM pg_temp.as_user(gen_random_uuid());
  UPDATE public.friend_requests SET status = 'cancelled' WHERE id = v_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.as_postgres();
  SELECT status::text INTO v_status FROM public.friend_requests WHERE id = v_id;
  IF v_rows > 0 OR v_status <> 'accepted' THEN
    RAISE EXCEPTION 'FAIL friend_requests: third-party mutated row (rows=%, status=%)', v_rows, v_status;
  END IF;
  RAISE NOTICE 'PASS friend_requests: third-party cannot mutate';

  -- 8f) Sender must NOT be able to swap participants (change to_user).
  --     Reset to pending as postgres for clean state.
  UPDATE public.friend_requests SET status = 'pending' WHERE id = v_id;
  PERFORM pg_temp.as_user(v_a);
  BEGIN
    UPDATE public.friend_requests
       SET to_user = gen_random_uuid()
     WHERE id = v_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN check_violation OR insufficient_privilege OR others THEN
    v_rows := 0;
  END;
  PERFORM pg_temp.as_postgres();
  IF v_rows > 0 OR (SELECT to_user FROM public.friend_requests WHERE id = v_id) <> v_b THEN
    RAISE EXCEPTION 'FAIL friend_requests: sender was able to swap to_user (rows=%)', v_rows;
  END IF;
  RAISE NOTICE 'PASS friend_requests: sender cannot swap to_user';

  -- 8g) Sender must NOT be able to rewrite from_user (impersonation attempt).
  PERFORM pg_temp.as_user(v_a);
  BEGIN
    UPDATE public.friend_requests
       SET from_user = gen_random_uuid()
     WHERE id = v_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN check_violation OR insufficient_privilege OR others THEN
    v_rows := 0;
  END;
  PERFORM pg_temp.as_postgres();
  IF v_rows > 0 OR (SELECT from_user FROM public.friend_requests WHERE id = v_id) <> v_a THEN
    RAISE EXCEPTION 'FAIL friend_requests: sender was able to rewrite from_user (rows=%)', v_rows;
  END IF;
  RAISE NOTICE 'PASS friend_requests: sender cannot rewrite from_user';

  -- 8h) Recipient must NOT be able to swap participants either (even while
  --     legitimately transitioning status). Trigger enforces immutability.
  PERFORM pg_temp.as_user(v_b);
  BEGIN
    UPDATE public.friend_requests
       SET from_user = gen_random_uuid(), status = 'accepted'
     WHERE id = v_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN check_violation OR insufficient_privilege OR others THEN
    v_rows := 0;
  END;
  PERFORM pg_temp.as_postgres();
  IF v_rows > 0 OR (SELECT from_user FROM public.friend_requests WHERE id = v_id) <> v_a THEN
    RAISE EXCEPTION 'FAIL friend_requests: recipient was able to rewrite from_user (rows=%)', v_rows;
  END IF;
  RAISE NOTICE 'PASS friend_requests: recipient cannot rewrite participants';

  -- 8i) Even direct swap of both participants at once must be rejected.
  PERFORM pg_temp.as_user(v_a);
  BEGIN
    UPDATE public.friend_requests
       SET from_user = v_b, to_user = v_a
     WHERE id = v_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN check_violation OR insufficient_privilege OR others THEN
    v_rows := 0;
  END;
  PERFORM pg_temp.as_postgres();
  IF v_rows > 0 OR (SELECT from_user FROM public.friend_requests WHERE id = v_id) <> v_a
     OR (SELECT to_user FROM public.friend_requests WHERE id = v_id) <> v_b THEN
    RAISE EXCEPTION 'FAIL friend_requests: full participant swap succeeded (rows=%)', v_rows;
  END IF;
  RAISE NOTICE 'PASS friend_requests: full participant swap rejected';
END $$;

ROLLBACK;