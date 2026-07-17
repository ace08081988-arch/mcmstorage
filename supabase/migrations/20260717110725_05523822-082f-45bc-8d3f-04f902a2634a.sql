CREATE OR REPLACE FUNCTION public.request_list_titles_via_task(_token text, _pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_rows jsonb; v_locked timestamptz;
BEGIN
  v_locked := public.prep_pin_locked_until(_token);
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited',
      'retry_after', extract(epoch from (v_locked - now()))::int);
  END IF;
  SELECT * INTO v_task FROM public.prep_tasks
    WHERE share_token = _token AND status = 'active' AND expires_at > now() LIMIT 1;
  IF v_task.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_task.pin_hash <> extensions.crypt(_pin, v_task.pin_hash) THEN
    PERFORM public.record_prep_pin_failure(_token);
    RETURN jsonb_build_object('ok', false, 'error', 'bad_pin');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'note', t.note,
    'submitted_count', (
      SELECT count(*) FROM public.request_preparations rp
      WHERE rp.title_id = t.id
        AND rp.user_id = v_task.owner_user_id
        AND rp.via_task_id = v_task.id
    ),
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', ti.id,
        'warehouse_item_id', ti.warehouse_item_id,
        'product_name', wi.name,
        'target_grams', ti.target_grams,
        'unit_label', ti.unit_label,
        'note', ti.note
      ) ORDER BY ti.position, ti.created_at), '[]'::jsonb)
      FROM public.request_title_items ti
      LEFT JOIN public.warehouse_items wi ON wi.id = ti.warehouse_item_id
      WHERE ti.title_id = t.id
    )
  ) ORDER BY t.position, t.created_at), '[]'::jsonb) INTO v_rows
  FROM public.request_titles t
  JOIN public.prep_task_request_titles ptrt
    ON ptrt.title_id = t.id AND ptrt.task_id = v_task.id
  WHERE t.user_id = v_task.owner_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.request_preparations rp
      WHERE rp.title_id = t.id
        AND rp.user_id = v_task.owner_user_id
        AND rp.via_task_id = v_task.id
    );

  RETURN jsonb_build_object(
    'ok', true,
    'owner_user_id', v_task.owner_user_id,
    'titles', v_rows
  );
END $function$;