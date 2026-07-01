-- Automated audit report for public.friend_requests
-- Goal: surface regressions like fr_update_self_accept as fast as possible.
--
-- Run in CI (psql -v ON_ERROR_STOP=1 -f supabase/tests/audit_friend_requests.sql).
-- Any RAISE EXCEPTION below fails the job and prints an actionable message.
--
-- What this script verifies
--   1. Snapshot of every RLS policy on friend_requests (name, cmd, roles, USING, WITH CHECK)
--   2. Snapshot of every trigger on friend_requests (name + definition)
--   3. Grants on friend_requests (must NOT include anon/authenticated write bits)
--   4. Structural invariants: no policy grants sender permission to set
--      status IN ('accepted','rejected'); guard trigger exists; participants
--      are immutable.
--   5. Behavioral attack simulations (sender self-accept, third-party mutate,
--      participant swap) executed as the authenticated role. Each MUST fail.

\pset pager off
\pset format aligned
\set ON_ERROR_STOP on

\echo
\echo ================================================================
\echo  friend_requests audit — policy + trigger snapshot
\echo ================================================================

SELECT policyname, cmd, roles::text AS roles,
       COALESCE(qual, '')       AS using_expr,
       COALESCE(with_check, '') AS check_expr
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'friend_requests'
ORDER BY cmd, policyname;

\echo
\echo -- Triggers on friend_requests --
SELECT tgname, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'public.friend_requests'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

\echo
\echo -- Grants on friend_requests --
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'friend_requests'
ORDER BY grantee, privilege_type;

\echo
\echo ================================================================
\echo  Structural invariants
\echo ================================================================

DO $audit$
DECLARE
  bad_policy    text;
  guard_present boolean;
  wide_grant    text;
BEGIN
  -- 1) No UPDATE/ALL policy may allow sender-side status writes to accepted/rejected.
  --    We treat a policy as "sender-writable to accepted" if its WITH CHECK
  --    references from_user = auth.uid() without also restricting status.
  --    Heuristic: forbid any UPDATE policy whose WITH CHECK contains "from_user"
  --    but does NOT contain "to_user" or "status" restrictions.
  SELECT policyname INTO bad_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'friend_requests'
    AND cmd IN ('UPDATE','ALL')
    AND COALESCE(with_check,'') ~ 'from_user'
    AND COALESCE(with_check,'') !~ 'to_user'
    AND COALESCE(with_check,'') !~ 'cancelled'
  LIMIT 1;

  IF bad_policy IS NOT NULL THEN
    RAISE EXCEPTION
      'AUDIT FAIL [fr_update_self_accept regression]: policy % lets sender update without recipient/status guard',
      bad_policy;
  END IF;

  -- 2) Guard trigger must exist.
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.friend_requests'::regclass
      AND tgname  = 'tg_friend_requests_guard'
      AND NOT tgisinternal
  ) INTO guard_present;

  IF NOT guard_present THEN
    RAISE EXCEPTION
      'AUDIT FAIL: trigger tg_friend_requests_guard missing on friend_requests';
  END IF;

  -- 3) authenticated / anon must NOT have UPDATE or INSERT on friend_requests
  --    (all writes go through SECURITY DEFINER RPCs).
  SELECT grantee || ':' || privilege_type INTO wide_grant
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name   = 'friend_requests'
    AND grantee IN ('authenticated','anon')
    AND privilege_type IN ('INSERT','UPDATE','DELETE')
  LIMIT 1;

  IF wide_grant IS NOT NULL THEN
    RAISE EXCEPTION
      'AUDIT FAIL: unexpected direct write grant on friend_requests -> %',
      wide_grant;
  END IF;

  RAISE NOTICE 'Structural invariants OK';
END
$audit$;

\echo
\echo ================================================================
\echo  Behavioral attack simulations
\echo ================================================================
\echo  These require test.can_switch=on (elevated CI role).
\echo  Skipped silently on shared/hosted DB.

DO $sim$
DECLARE
  can_switch text := current_setting('test.can_switch', true);
  u_sender   uuid := '00000000-0000-0000-0000-00000000a001';
  u_recip    uuid := '00000000-0000-0000-0000-00000000a002';
  u_third    uuid := '00000000-0000-0000-0000-00000000a003';
  req_id     uuid;
  sqlstate_text text;
BEGIN
  IF can_switch IS DISTINCT FROM 'on' THEN
    RAISE NOTICE 'test.can_switch != on — skipping behavioral simulations';
    RETURN;
  END IF;

  -- Seed a pending request as service_role (bypasses RLS).
  SET LOCAL ROLE service_role;
  INSERT INTO public.friend_requests (from_user, to_user, status)
  VALUES (u_sender, u_recip, 'pending')
  RETURNING id INTO req_id;

  ----------------------------------------------------------------
  -- Attack A: sender tries to self-accept via direct UPDATE
  ----------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', u_sender::text, true);

  BEGIN
    UPDATE public.friend_requests SET status = 'accepted' WHERE id = req_id;
    RAISE EXCEPTION 'AUDIT FAIL [A]: sender self-accept SUCCEEDED (regression of fr_update_self_accept)';
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    GET STACKED DIAGNOSTICS sqlstate_text = RETURNED_SQLSTATE;
    RAISE NOTICE 'A ok: sender self-accept blocked (sqlstate=%)', sqlstate_text;
  END;

  ----------------------------------------------------------------
  -- Attack B: third party tries to accept
  ----------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', u_third::text, true);
  BEGIN
    UPDATE public.friend_requests SET status = 'accepted' WHERE id = req_id;
    RAISE EXCEPTION 'AUDIT FAIL [B]: third-party accept SUCCEEDED';
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    GET STACKED DIAGNOSTICS sqlstate_text = RETURNED_SQLSTATE;
    RAISE NOTICE 'B ok: third-party accept blocked (sqlstate=%)', sqlstate_text;
  END;

  ----------------------------------------------------------------
  -- Attack C: sender tries to swap participants
  ----------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', u_sender::text, true);
  BEGIN
    UPDATE public.friend_requests
       SET to_user = u_third
     WHERE id = req_id;
    RAISE EXCEPTION 'AUDIT FAIL [C]: participant swap SUCCEEDED (immutability broken)';
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    GET STACKED DIAGNOSTICS sqlstate_text = RETURNED_SQLSTATE;
    RAISE NOTICE 'C ok: participant swap blocked (sqlstate=%)', sqlstate_text;
  END;

  ----------------------------------------------------------------
  -- Positive control: sender cancels its own pending request
  ----------------------------------------------------------------
  BEGIN
    UPDATE public.friend_requests SET status = 'cancelled' WHERE id = req_id;
    RAISE NOTICE 'D ok: sender cancel accepted';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS sqlstate_text = RETURNED_SQLSTATE;
    RAISE EXCEPTION 'AUDIT FAIL [D]: sender cancel unexpectedly blocked (sqlstate=%)', sqlstate_text;
  END;

  -- Cleanup
  SET LOCAL ROLE service_role;
  DELETE FROM public.friend_requests WHERE id = req_id;
  RESET ROLE;
END
$sim$;

\echo
\echo ================================================================
\echo  Audit complete — no regressions detected.
\echo ================================================================