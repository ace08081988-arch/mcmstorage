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

-- ---------------------------------------------------------------------
-- 9) fr_update_participant / recipient-only status transitions.
--    Verifies at the *policy* layer (not just trigger) that only the
--    matching recipient (auth.uid() = to_user) can update status, and
--    the sender identity (from_user) can NOT be tampered with.
-- ---------------------------------------------------------------------

-- 9-static) Assert the expected policies exist with correct qual/with_check.
DO $$
DECLARE v_qual text; v_check text;
BEGIN
  SELECT qual, with_check INTO v_qual, v_check
    FROM pg_policies
   WHERE schemaname='public' AND tablename='friend_requests'
     AND policyname='fr_update_recipient';
  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'FAIL fr_update_recipient policy missing';
  END IF;
  IF v_qual !~ 'to_user' OR v_check !~ 'to_user' THEN
    RAISE EXCEPTION 'FAIL fr_update_recipient does not scope by to_user (qual=%, check=%)', v_qual, v_check;
  END IF;
  RAISE NOTICE 'PASS fr_update_recipient policy scoped by to_user=auth.uid()';

  SELECT qual, with_check INTO v_qual, v_check
    FROM pg_policies
   WHERE schemaname='public' AND tablename='friend_requests'
     AND policyname='fr_update_sender_cancel_only';
  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'FAIL fr_update_sender_cancel_only policy missing';
  END IF;
  IF v_qual !~ 'from_user' OR v_check !~ 'cancelled' THEN
    RAISE EXCEPTION 'FAIL fr_update_sender_cancel_only not restricted to sender→cancelled (qual=%, check=%)', v_qual, v_check;
  END IF;
  RAISE NOTICE 'PASS fr_update_sender_cancel_only restricted to sender cancel';

  -- No permissive UPDATE policy may exist that lets from_user set arbitrary status.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='friend_requests'
       AND cmd='UPDATE'
       AND policyname NOT IN ('fr_update_recipient','fr_update_sender_cancel_only')
  ) THEN
    RAISE EXCEPTION 'FAIL unexpected UPDATE policy on friend_requests — audit required';
  END IF;
  RAISE NOTICE 'PASS friend_requests has only the two vetted UPDATE policies';
END $$;

-- 9-runtime) Behavioural: only the true recipient can transition status.
DO $$
DECLARE
  v_a uuid; v_b uuid; v_c uuid;
  v_id uuid; v_rows int; v_status text; v_from uuid;
BEGIN
  IF NOT current_setting('test.can_switch')::boolean THEN
    RAISE NOTICE 'SKIP 9-runtime: role switching unavailable';
    RETURN;
  END IF;

  SELECT id INTO v_a FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_b FROM auth.users WHERE id <> v_a ORDER BY created_at LIMIT 1;
  SELECT id INTO v_c FROM auth.users WHERE id NOT IN (v_a, v_b) ORDER BY created_at LIMIT 1;
  IF v_a IS NULL OR v_b IS NULL OR v_c IS NULL THEN
    RAISE NOTICE 'SKIP 9-runtime: need at least 3 auth.users';
    RETURN;
  END IF;

  DELETE FROM public.friend_requests
   WHERE (from_user, to_user) IN ((v_a,v_b),(v_b,v_a),(v_a,v_c),(v_c,v_a),(v_b,v_c),(v_c,v_b));

  -- A → B pending.
  PERFORM pg_temp.as_user(v_a);
  INSERT INTO public.friend_requests(from_user, to_user, status)
  VALUES (v_a, v_b, 'pending') RETURNING id INTO v_id;
  PERFORM pg_temp.as_postgres();

  -- 9a) A third authenticated user C (not recipient) must NOT be able to accept.
  PERFORM pg_temp.as_user(v_c);
  UPDATE public.friend_requests SET status='accepted' WHERE id=v_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.as_postgres();
  SELECT status::text INTO v_status FROM public.friend_requests WHERE id=v_id;
  IF v_rows > 0 OR v_status <> 'pending' THEN
    RAISE EXCEPTION 'FAIL 9a: non-recipient C accepted (rows=%, status=%)', v_rows, v_status;
  END IF;
  RAISE NOTICE 'PASS 9a: only the row-matched recipient can accept (C blocked)';

  -- 9b) Recipient B accepts — must succeed AND from_user must remain v_a
  --     (immutability guarded by trigger even during a legitimate status write).
  PERFORM pg_temp.as_user(v_b);
  UPDATE public.friend_requests SET status='accepted' WHERE id=v_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.as_postgres();
  SELECT status::text, from_user INTO v_status, v_from FROM public.friend_requests WHERE id=v_id;
  IF v_rows <> 1 OR v_status <> 'accepted' OR v_from <> v_a THEN
    RAISE EXCEPTION 'FAIL 9b: recipient accept broke invariants (rows=%, status=%, from=%)', v_rows, v_status, v_from;
  END IF;
  RAISE NOTICE 'PASS 9b: recipient accept preserves from_user identity';

  -- 9c) Once accepted, even the recipient may not flip it back (only pending → accepted/rejected).
  PERFORM pg_temp.as_user(v_b);
  BEGIN
    UPDATE public.friend_requests SET status='pending' WHERE id=v_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN others THEN v_rows := 0;
  END;
  PERFORM pg_temp.as_postgres();
  SELECT status::text INTO v_status FROM public.friend_requests WHERE id=v_id;
  IF v_status <> 'accepted' THEN
    RAISE EXCEPTION 'FAIL 9c: accepted request was reopened (status=%)', v_status;
  END IF;
  RAISE NOTICE 'PASS 9c: accepted status is terminal for recipient';
END $$;

-- ---------------------------------------------------------------------
-- 10) start_dm gate. Tampering with friend_requests must NOT unlock a DM.
--     Only a genuine recipient-accepted transition can make start_dm succeed.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_a uuid; v_b uuid; v_c uuid;
  v_id uuid; v_dm uuid; v_rows int; v_status text;
  v_sqlstate text; v_msg text;
BEGIN
  IF NOT current_setting('test.can_switch')::boolean THEN
    RAISE NOTICE 'SKIP 10: role switching unavailable';
    RETURN;
  END IF;

  SELECT id INTO v_a FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_b FROM auth.users WHERE id <> v_a ORDER BY created_at LIMIT 1;
  SELECT id INTO v_c FROM auth.users WHERE id NOT IN (v_a, v_b) ORDER BY created_at LIMIT 1;
  IF v_a IS NULL OR v_b IS NULL OR v_c IS NULL THEN
    RAISE NOTICE 'SKIP 10: need at least 3 auth.users';
    RETURN;
  END IF;

  -- Clean slate: no friendship, no contact link, no existing DM.
  DELETE FROM public.friend_requests
   WHERE (from_user, to_user) IN ((v_a,v_b),(v_b,v_a));
  DELETE FROM public.customers
   WHERE (user_id=v_a AND account_user_id=v_b) OR (user_id=v_b AND account_user_id=v_a);
  DELETE FROM public.suppliers
   WHERE (user_id=v_a AND account_user_id=v_b) OR (user_id=v_b AND account_user_id=v_a);

  -- A → B pending.
  PERFORM pg_temp.as_user(v_a);
  INSERT INTO public.friend_requests(from_user, to_user, status)
  VALUES (v_a, v_b, 'pending') RETURNING id INTO v_id;

  -- 10a) start_dm while pending must raise 'not_allowed'.
  BEGIN
    v_dm := public.start_dm(v_b);
    v_msg := NULL;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.as_postgres();
  IF v_dm IS NOT NULL OR v_msg IS DISTINCT FROM 'not_allowed' THEN
    RAISE EXCEPTION 'FAIL 10a: start_dm did not reject pending (dm=%, msg=%)', v_dm, v_msg;
  END IF;
  RAISE NOTICE 'PASS 10a: start_dm blocked while status=pending';

  -- 10b) Sender tries to self-accept (must fail) → start_dm still blocked.
  PERFORM pg_temp.as_user(v_a);
  BEGIN
    UPDATE public.friend_requests SET status='accepted' WHERE id=v_id;
  EXCEPTION WHEN others THEN NULL;
  END;
  v_dm := NULL; v_msg := NULL;
  BEGIN
    v_dm := public.start_dm(v_b);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.as_postgres();
  SELECT status::text INTO v_status FROM public.friend_requests WHERE id=v_id;
  IF v_status = 'accepted' THEN
    RAISE EXCEPTION 'FAIL 10b: sender self-accept succeeded (guards broken)';
  END IF;
  IF v_dm IS NOT NULL OR v_msg IS DISTINCT FROM 'not_allowed' THEN
    RAISE EXCEPTION 'FAIL 10b: start_dm allowed after tampered self-accept (dm=%, msg=%)', v_dm, v_msg;
  END IF;
  RAISE NOTICE 'PASS 10b: sender tamper (self-accept) does not unlock start_dm';

  -- 10c) Third party C tries to accept → RLS blocks → start_dm still not_allowed.
  PERFORM pg_temp.as_user(v_c);
  UPDATE public.friend_requests SET status='accepted' WHERE id=v_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_dm := NULL; v_msg := NULL;
  BEGIN
    v_dm := public.start_dm(v_a);   -- C tries to DM A (unrelated)
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.as_postgres();
  SELECT status::text INTO v_status FROM public.friend_requests WHERE id=v_id;
  IF v_rows > 0 OR v_status = 'accepted' THEN
    RAISE EXCEPTION 'FAIL 10c: third-party accept succeeded (rows=%, status=%)', v_rows, v_status;
  END IF;
  IF v_dm IS NOT NULL OR v_msg IS DISTINCT FROM 'not_allowed' THEN
    RAISE EXCEPTION 'FAIL 10c: third-party opened DM (dm=%, msg=%)', v_dm, v_msg;
  END IF;
  RAISE NOTICE 'PASS 10c: third-party tamper does not unlock start_dm';

  -- 10d) Sender attempts to swap to_user to themself (immutability) → guard rejects
  --      → start_dm still blocked for A↔B.
  PERFORM pg_temp.as_user(v_a);
  BEGIN
    UPDATE public.friend_requests SET to_user = v_a, status = 'accepted' WHERE id = v_id;
  EXCEPTION WHEN others THEN NULL;
  END;
  v_dm := NULL; v_msg := NULL;
  BEGIN
    v_dm := public.start_dm(v_b);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  PERFORM pg_temp.as_postgres();
  IF v_dm IS NOT NULL OR v_msg IS DISTINCT FROM 'not_allowed' THEN
    RAISE EXCEPTION 'FAIL 10d: participant swap unlocked start_dm (dm=%, msg=%)', v_dm, v_msg;
  END IF;
  RAISE NOTICE 'PASS 10d: participant swap does not unlock start_dm';

  -- 10e) Genuine recipient acceptance → start_dm now succeeds for both sides.
  PERFORM pg_temp.as_user(v_b);
  UPDATE public.friend_requests SET status='accepted' WHERE id=v_id;
  v_dm := public.start_dm(v_a);
  IF v_dm IS NULL THEN
    PERFORM pg_temp.as_postgres();
    RAISE EXCEPTION 'FAIL 10e: recipient accept did not unlock start_dm';
  END IF;
  PERFORM pg_temp.as_user(v_a);
  v_dm := public.start_dm(v_b);
  PERFORM pg_temp.as_postgres();
  IF v_dm IS NULL THEN
    RAISE EXCEPTION 'FAIL 10e: reverse direction start_dm failed after accept';
  END IF;
  RAISE NOTICE 'PASS 10e: recipient accept is the ONLY path that opens start_dm';
END $$;

-- =====================================================================
-- 11) Full participant status transition matrix
--     Verifies each allowed transition succeeds ONLY for the correct
--     actor, and every disallowed (actor, from_status, to_status) tuple
--     is rejected by RLS + trigger guard.
-- =====================================================================
DO $$
DECLARE
  v_a uuid := current_setting('test.user_a')::uuid;  -- sender
  v_b uuid := current_setting('test.user_b')::uuid;  -- recipient
  v_c uuid := current_setting('test.user_c')::uuid;  -- third party
  v_id uuid;
  v_status text;
  v_rows int;
  v_deleted int;

  -- Helper: seed a request in the given starting status as service_role.
  --  Uses inline SQL below because plpgsql lacks nested procedures here.
BEGIN
  IF NOT pg_temp.can_switch_roles() THEN
    RAISE NOTICE 'SKIP 11: cannot switch roles in this session';
    RETURN;
  END IF;

  -- ---- 11a) pending → accepted: only recipient (v_b) ----
  -- sender attempt (must fail; status stays pending)
  PERFORM pg_temp.as_postgres();
  INSERT INTO public.friend_requests(from_user,to_user,status)
    VALUES (v_a,v_b,'pending') RETURNING id INTO v_id;

  PERFORM pg_temp.as_user(v_a);
  BEGIN UPDATE public.friend_requests SET status='accepted' WHERE id=v_id;
  EXCEPTION WHEN others THEN NULL; END;
  SELECT status INTO v_status FROM public.friend_requests WHERE id=v_id;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'FAIL 11a: sender self-accept mutated status to %', v_status;
  END IF;

  -- third-party attempt (must fail)
  PERFORM pg_temp.as_user(v_c);
  BEGIN UPDATE public.friend_requests SET status='accepted' WHERE id=v_id;
  EXCEPTION WHEN others THEN NULL; END;
  SELECT status INTO v_status FROM public.friend_requests WHERE id=v_id;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'FAIL 11a: third-party accept mutated status to %', v_status;
  END IF;

  -- recipient attempt (must succeed)
  PERFORM pg_temp.as_user(v_b);
  UPDATE public.friend_requests SET status='accepted' WHERE id=v_id;
  SELECT status INTO v_status FROM public.friend_requests WHERE id=v_id;
  IF v_status <> 'accepted' THEN
    RAISE EXCEPTION 'FAIL 11a: recipient accept blocked (status=%)', v_status;
  END IF;
  RAISE NOTICE 'PASS 11a: pending→accepted only by recipient';

  -- ---- 11b) pending → rejected: only recipient ----
  PERFORM pg_temp.as_postgres();
  INSERT INTO public.friend_requests(from_user,to_user,status)
    VALUES (v_a,v_b,'pending') RETURNING id INTO v_id;

  PERFORM pg_temp.as_user(v_a);
  BEGIN UPDATE public.friend_requests SET status='rejected' WHERE id=v_id;
  EXCEPTION WHEN others THEN NULL; END;
  PERFORM pg_temp.as_user(v_c);
  BEGIN UPDATE public.friend_requests SET status='rejected' WHERE id=v_id;
  EXCEPTION WHEN others THEN NULL; END;
  SELECT status INTO v_status FROM public.friend_requests WHERE id=v_id;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'FAIL 11b: non-recipient reject mutated status to %', v_status;
  END IF;
  PERFORM pg_temp.as_user(v_b);
  UPDATE public.friend_requests SET status='rejected' WHERE id=v_id;
  SELECT status INTO v_status FROM public.friend_requests WHERE id=v_id;
  IF v_status <> 'rejected' THEN
    RAISE EXCEPTION 'FAIL 11b: recipient reject blocked (status=%)', v_status;
  END IF;
  RAISE NOTICE 'PASS 11b: pending→rejected only by recipient';

  -- ---- 11c) pending → cancelled: only sender ----
  PERFORM pg_temp.as_postgres();
  INSERT INTO public.friend_requests(from_user,to_user,status)
    VALUES (v_a,v_b,'pending') RETURNING id INTO v_id;

  -- recipient cannot cancel
  PERFORM pg_temp.as_user(v_b);
  BEGIN UPDATE public.friend_requests SET status='cancelled' WHERE id=v_id;
  EXCEPTION WHEN others THEN NULL; END;
  -- third-party cannot cancel
  PERFORM pg_temp.as_user(v_c);
  BEGIN UPDATE public.friend_requests SET status='cancelled' WHERE id=v_id;
  EXCEPTION WHEN others THEN NULL; END;
  SELECT status INTO v_status FROM public.friend_requests WHERE id=v_id;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'FAIL 11c: non-sender cancel mutated status to %', v_status;
  END IF;
  -- sender can cancel
  PERFORM pg_temp.as_user(v_a);
  UPDATE public.friend_requests SET status='cancelled' WHERE id=v_id;
  SELECT status INTO v_status FROM public.friend_requests WHERE id=v_id;
  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'FAIL 11c: sender cancel blocked (status=%)', v_status;
  END IF;
  RAISE NOTICE 'PASS 11c: pending→cancelled only by sender';

  -- ---- 11d) accepted is terminal (no further transitions) ----
  PERFORM pg_temp.as_postgres();
  INSERT INTO public.friend_requests(from_user,to_user,status)
    VALUES (v_a,v_b,'accepted') RETURNING id INTO v_id;
  PERFORM pg_temp.as_user(v_b);
  BEGIN UPDATE public.friend_requests SET status='rejected' WHERE id=v_id;
  EXCEPTION WHEN others THEN NULL; END;
  PERFORM pg_temp.as_user(v_a);
  BEGIN UPDATE public.friend_requests SET status='cancelled' WHERE id=v_id;
  EXCEPTION WHEN others THEN NULL; END;
  SELECT status INTO v_status FROM public.friend_requests WHERE id=v_id;
  IF v_status <> 'accepted' THEN
    RAISE EXCEPTION 'FAIL 11d: accepted mutated to % (should be terminal)', v_status;
  END IF;
  RAISE NOTICE 'PASS 11d: accepted is terminal';

  -- ---- 11e) DELETE: rejected row deletable only by recipient ----
  PERFORM pg_temp.as_postgres();
  INSERT INTO public.friend_requests(from_user,to_user,status)
    VALUES (v_a,v_b,'rejected') RETURNING id INTO v_id;
  -- sender cannot delete a rejected row
  PERFORM pg_temp.as_user(v_a);
  DELETE FROM public.friend_requests WHERE id=v_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'FAIL 11e: sender deleted a rejected row';
  END IF;
  -- third party cannot delete
  PERFORM pg_temp.as_user(v_c);
  DELETE FROM public.friend_requests WHERE id=v_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'FAIL 11e: third-party deleted a rejected row';
  END IF;
  -- recipient can delete
  PERFORM pg_temp.as_user(v_b);
  DELETE FROM public.friend_requests WHERE id=v_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'FAIL 11e: recipient could not delete rejected row (rows=%)', v_deleted;
  END IF;
  RAISE NOTICE 'PASS 11e: rejected → delete only by recipient';

  -- ---- 11f) DELETE: cancelled row deletable by BOTH sender and recipient ----
  --      (fr_delete_from_self covers sender pending/cancelled; fr_delete_to_self
  --       covers recipient rejected/cancelled)
  PERFORM pg_temp.as_postgres();
  INSERT INTO public.friend_requests(from_user,to_user,status)
    VALUES (v_a,v_b,'cancelled') RETURNING id INTO v_id;
  -- third party still cannot delete
  PERFORM pg_temp.as_user(v_c);
  DELETE FROM public.friend_requests WHERE id=v_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'FAIL 11f: third-party deleted a cancelled row';
  END IF;
  -- recipient deletes it
  PERFORM pg_temp.as_user(v_b);
  DELETE FROM public.friend_requests WHERE id=v_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'FAIL 11f: recipient could not delete cancelled row';
  END IF;
  -- fresh row: sender also allowed to delete cancelled
  PERFORM pg_temp.as_postgres();
  INSERT INTO public.friend_requests(from_user,to_user,status)
    VALUES (v_a,v_b,'cancelled') RETURNING id INTO v_id;
  PERFORM pg_temp.as_user(v_a);
  DELETE FROM public.friend_requests WHERE id=v_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'FAIL 11f: sender could not delete own cancelled row';
  END IF;
  RAISE NOTICE 'PASS 11f: cancelled → delete by sender or recipient only';

  -- ---- 11g) DELETE: pending row deletable only by sender ----
  PERFORM pg_temp.as_postgres();
  INSERT INTO public.friend_requests(from_user,to_user,status)
    VALUES (v_a,v_b,'pending') RETURNING id INTO v_id;
  -- recipient cannot delete pending
  PERFORM pg_temp.as_user(v_b);
  DELETE FROM public.friend_requests WHERE id=v_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'FAIL 11g: recipient deleted a pending row';
  END IF;
  -- third party cannot delete pending
  PERFORM pg_temp.as_user(v_c);
  DELETE FROM public.friend_requests WHERE id=v_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'FAIL 11g: third-party deleted a pending row';
  END IF;
  -- sender can delete pending
  PERFORM pg_temp.as_user(v_a);
  DELETE FROM public.friend_requests WHERE id=v_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'FAIL 11g: sender could not delete own pending row';
  END IF;
  RAISE NOTICE 'PASS 11g: pending → delete only by sender';

  -- ---- 11h) DELETE: accepted row NOT deletable by anyone (except service_role) ----
  PERFORM pg_temp.as_postgres();
  INSERT INTO public.friend_requests(from_user,to_user,status)
    VALUES (v_a,v_b,'accepted') RETURNING id INTO v_id;
  FOR v_status IN SELECT unnest(ARRAY[v_a::text,v_b::text,v_c::text]) LOOP
    PERFORM pg_temp.as_user(v_status::uuid);
    DELETE FROM public.friend_requests WHERE id=v_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 0 THEN
      RAISE EXCEPTION 'FAIL 11h: actor % deleted an accepted row', v_status;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS 11h: accepted rows not deletable via RLS';

  -- Cleanup: reset role so ROLLBACK is clean.
  PERFORM pg_temp.as_postgres();
END $$;

ROLLBACK;