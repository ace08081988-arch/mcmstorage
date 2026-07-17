-- 1. Corrective backfill: link active tasks to titles with matching names.
-- This helps existing tasks like 'bagas' find their 'bagas' package automatically.
INSERT INTO public.prep_task_request_titles(task_id, title_id)
SELECT t.id, rt.id
FROM public.prep_tasks t
JOIN public.request_titles rt ON rt.user_id = t.owner_user_id
WHERE t.status = 'active' 
  AND t.expires_at > now()
  AND (t.title ILIKE '%' || rt.name || '%' OR rt.name ILIKE '%' || t.title || '%')
ON CONFLICT DO NOTHING;

-- 2. Fix: Only fallback to all active packages for tasks created BEFORE the explicit link feature.
-- Tasks created after the feature (2026-07-17 06:30) must respect the explicit selection in prep_task_request_titles.
CREATE OR REPLACE FUNCTION public.request_list_titles_via_task(_token text, _pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_task public.prep_tasks%ROWTYPE;
  v_rows jsonb;
  v_locked timestamptz;
  v_has_explicit boolean;
  -- Feature introduction timestamp: 2026-07-17 06:37:00 (approx)
  v_feature_cutoff timestamptz := '2026-07-17 06:30:00+00';
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

  -- Check if this task has explicit links
  SELECT EXISTS (
    SELECT 1 FROM public.prep_task_request_titles ptrt
    WHERE ptrt.task_id = v_task.id
  ) INTO v_has_explicit;

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
  WHERE t.user_id = v_task.owner_user_id
    AND (
      -- Fallback only for OLD tasks. 
      -- NEW tasks (after cutoff) showing no links means the user explicitly unchecked everything.
      (v_has_explicit = false AND v_task.created_at < v_feature_cutoff)
      OR EXISTS (
        SELECT 1 FROM public.prep_task_request_titles ptrt
        WHERE ptrt.title_id = t.id AND ptrt.task_id = v_task.id
      )
    )
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
