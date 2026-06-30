CREATE OR REPLACE FUNCTION public.prep_peek_task(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_task public.prep_tasks%ROWTYPE;
  v_locked timestamptz;
BEGIN
  v_locked := public.prep_pin_locked_until(_token);
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'rate_limited',
      'retry_after', extract(epoch from (v_locked - now()))::int
    );
  END IF;

  SELECT * INTO v_task FROM public.prep_tasks
    WHERE share_token = _token
    LIMIT 1;

  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_task.status <> 'active' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'closed',
      'status', v_task.status
    );
  END IF;

  IF v_task.expires_at <= now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'expired',
      'expires_at', v_task.expires_at
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'title', v_task.title,
    'expires_at', v_task.expires_at
  );
END $$;

GRANT EXECUTE ON FUNCTION public.prep_peek_task(text) TO anon, authenticated, service_role;