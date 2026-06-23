CREATE OR REPLACE FUNCTION public.prep_pin_reset(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.prep_tasks%ROWTYPE;
  v_deleted integer := 0;
  v_acked integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO v_task FROM public.prep_tasks
   WHERE share_token = _token LIMIT 1;
  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_task.owner_user_id <> v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  WITH d AS (
    DELETE FROM public.prep_pin_failures
     WHERE share_token = _token
     RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM d;

  WITH u AS (
    UPDATE public.prep_pin_alerts
       SET acknowledged_at = now()
     WHERE share_token = _token
       AND acknowledged_at IS NULL
     RETURNING 1
  )
  SELECT count(*) INTO v_acked FROM u;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_failures', v_deleted,
    'acknowledged_alerts', v_acked
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prep_pin_reset(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prep_pin_reset(text) TO authenticated, service_role;