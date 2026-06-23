
CREATE OR REPLACE FUNCTION public.prep_get_task(_token text, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_items jsonb; v_locked timestamptz;
BEGIN
  v_locked := public.prep_pin_locked_until(_token);
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited',
      'retry_after', extract(epoch from (v_locked - now()))::int);
  END IF;

  SELECT * INTO v_task FROM public.prep_tasks
    WHERE share_token = _token LIMIT 1;
  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_task.status IN ('done','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'closed', 'status', v_task.status);
  END IF;
  IF v_task.status = 'expired' OR v_task.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired',
      'expires_at', v_task.expires_at);
  END IF;
  IF v_task.pin_hash <> extensions.crypt(_pin, v_task.pin_hash) THEN
    PERFORM public.record_prep_pin_failure(_token);
    RETURN jsonb_build_object('ok', false, 'error', 'bad_pin');
  END IF;

  INSERT INTO public.prep_upload_grants(share_token, expires_at)
  VALUES (v_task.share_token, now() + interval '15 minutes')
  ON CONFLICT (share_token) DO UPDATE
    SET expires_at = EXCLUDED.expires_at, issued_at = now();

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'name', i.name_snapshot, 'category', i.category_snapshot,
    'qty_requested', i.qty_requested, 'qty_prepared', i.qty_prepared,
    'unit_label', i.unit_label, 'ref_photo_path', i.ref_photo_path, 'note', i.note,
    'updated_at', i.updated_at,
    'submissions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'photo_path', s.photo_path, 'location_url', s.location_url,
        'note', s.note, 'submitted_at', s.submitted_at
      ) ORDER BY s.submitted_at DESC), '[]'::jsonb)
      FROM public.prep_submissions s WHERE s.task_item_id = i.id
    )
  ) ORDER BY i.position), '[]'::jsonb) INTO v_items
  FROM public.prep_task_items i WHERE i.task_id = v_task.id;

  RETURN jsonb_build_object('ok', true, 'task', jsonb_build_object(
    'id', v_task.id, 'title', v_task.title, 'note', v_task.note,
    'status', v_task.status, 'expires_at', v_task.expires_at,
    'updated_at', v_task.updated_at
  ), 'items', v_items);
END $function$;
