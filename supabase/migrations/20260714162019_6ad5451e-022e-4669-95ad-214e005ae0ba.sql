CREATE OR REPLACE FUNCTION public.prep_submit(_token text, _pin text, _task_item_id uuid, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _qty_reported numeric, _expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _photo_paths text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_item public.prep_task_items%ROWTYPE; v_sub_id uuid;
        v_stock numeric; v_deduct numeric; v_locked timestamptz;
        v_first_photo text; v_paths text[]; v_p text;
        v_used int;
BEGIN
  v_locked := public.prep_pin_locked_until(_token);
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited',
      'retry_after', extract(epoch from (v_locked - now()))::int);
  END IF;

  v_paths := ARRAY[]::text[];
  IF _photo_paths IS NOT NULL THEN
    FOREACH v_p IN ARRAY _photo_paths LOOP
      IF v_p IS NOT NULL AND length(trim(v_p)) > 0 THEN
        v_paths := array_append(v_paths, v_p);
      END IF;
    END LOOP;
  END IF;
  IF coalesce(array_length(v_paths,1),0) = 0 AND _photo_path IS NOT NULL AND length(trim(_photo_path)) > 0 THEN
    v_paths := ARRAY[_photo_path]::text[];
  END IF;
  IF coalesce(array_length(v_paths,1),0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'photo_required');
  END IF;
  v_first_photo := v_paths[1];

  IF _location_url IS NOT NULL THEN
    IF length(_location_url) > 2048 THEN RETURN jsonb_build_object('ok', false, 'error', 'url_too_long'); END IF;
    IF _location_url !~* '^https://' THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_url'); END IF;
  END IF;
  IF _note IS NOT NULL AND length(_note) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'note_too_long');
  END IF;
  SELECT * INTO v_task FROM public.prep_tasks
    WHERE share_token = _token AND status = 'active' AND expires_at > now() LIMIT 1;
  IF v_task.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_task.pin_hash <> extensions.crypt(_pin, v_task.pin_hash) THEN
    PERFORM public.record_prep_pin_failure(_token);
    RETURN jsonb_build_object('ok', false, 'error', 'bad_pin');
  END IF;

  SELECT count(*) INTO v_used FROM public.prep_submissions WHERE task_id = v_task.id;
  IF v_used >= coalesce(v_task.max_submissions, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'task_exhausted');
  END IF;

  SELECT * INTO v_item FROM public.prep_task_items WHERE id = _task_item_id AND task_id = v_task.id LIMIT 1;
  IF v_item.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_item'); END IF;

  IF _expected_updated_at IS NOT NULL
     AND v_item.updated_at IS NOT NULL
     AND v_item.updated_at > _expected_updated_at + interval '1 second' THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'item_changed',
      'current_updated_at', v_item.updated_at
    );
  END IF;

  v_deduct := COALESCE(NULLIF(v_item.qty_requested, 0), _qty_reported, 0);

  INSERT INTO public.prep_submissions(task_id, task_item_id, photo_path, photo_paths, location_url, gps_lat, gps_lng, note, qty_reported)
  VALUES (v_task.id, v_item.id, v_first_photo, v_paths, _location_url, _gps_lat, _gps_lng, _note, v_deduct)
  RETURNING id INTO v_sub_id;

  IF v_deduct > 0 THEN
    UPDATE public.prep_task_items
      SET qty_prepared = COALESCE(qty_prepared,0) + v_deduct
      WHERE id = v_item.id;

    IF v_item.warehouse_item_id IS NOT NULL THEN
      SELECT stock_base INTO v_stock FROM public.warehouse_items
        WHERE id = v_item.warehouse_item_id AND user_id = v_task.owner_user_id
        FOR UPDATE;
      IF v_stock IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'item_not_found');
      END IF;
      IF v_stock < v_deduct THEN
        RETURN jsonb_build_object('ok', false, 'error', 'insufficient_stock',
          'available', v_stock, 'requested', v_deduct);
      END IF;
      UPDATE public.warehouse_items
        SET stock_base = stock_base - v_deduct, updated_at = now()
        WHERE id = v_item.warehouse_item_id AND user_id = v_task.owner_user_id;
    END IF;
  END IF;

  -- Auto-complete jika sudah mencapai kuota. Gunakan 'done' agar sesuai
  -- prep_tasks_status_check ('active','done','cancelled','expired').
  IF v_used + 1 >= coalesce(v_task.max_submissions, 1) THEN
    UPDATE public.prep_tasks
       SET status = 'done', completed_at = now()
     WHERE id = v_task.id AND status = 'active';
  END IF;

  RETURN jsonb_build_object('ok', true, 'submission_id', v_sub_id, 'deducted', v_deduct, 'photo_count', coalesce(array_length(v_paths,1),0));
END $function$;