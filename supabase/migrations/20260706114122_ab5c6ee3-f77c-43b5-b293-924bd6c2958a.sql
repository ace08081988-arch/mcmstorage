-- 1) Kolom max_submissions di prep_tasks
ALTER TABLE public.prep_tasks
  ADD COLUMN IF NOT EXISTS max_submissions int NOT NULL DEFAULT 1;

-- Backfill: task lama (sebelum migrasi ini) dianggap unlimited-legacy (999)
-- supaya alur /tugas-baru & ecer yang sudah beredar tidak tiba-tiba mati.
UPDATE public.prep_tasks SET max_submissions = 999
 WHERE max_submissions = 1 AND created_at < now();

-- 2) prep_create_task: tambah parameter _max_submissions
CREATE OR REPLACE FUNCTION public.prep_create_task(
  _title text, _note text, _pin text, _share_token text, _items jsonb,
  _scheduled_at timestamptz DEFAULT NULL,
  _max_submissions int DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_task_id uuid;
  v_item jsonb;
  v_pos int := 0;
  v_max int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF length(coalesce(_pin,'')) < 4 THEN RAISE EXCEPTION 'pin_too_short'; END IF;
  IF _share_token IS NULL OR length(_share_token) < 8 THEN
    RAISE EXCEPTION 'invalid_share_token';
  END IF;

  v_max := greatest(1, coalesce(_max_submissions, 1));

  INSERT INTO public.prep_tasks(owner_user_id, title, note, share_token, pin_hash, scheduled_at, max_submissions)
  VALUES (
    v_uid,
    coalesce(nullif(_title,''),'Tugas siapkan barang'),
    _note,
    _share_token,
    extensions.crypt(_pin, extensions.gen_salt('bf', 8)),
    _scheduled_at,
    v_max
  )
  RETURNING id INTO v_task_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    INSERT INTO public.prep_task_items(
      task_id, warehouse_item_id, name_snapshot, category_snapshot,
      qty_requested, unit_label, ref_photo_path, note, position
    )
    VALUES (
      v_task_id,
      nullif(v_item->>'warehouse_item_id','')::uuid,
      coalesce(v_item->>'name', 'Item'),
      v_item->>'category',
      coalesce((v_item->>'qty_requested')::numeric, 1),
      v_item->>'unit_label',
      v_item->>'ref_photo_path',
      v_item->>'note',
      v_pos
    );
    v_pos := v_pos + 1;
  END LOOP;

  RETURN v_task_id;
END $function$;

-- 3) prep_submit: enforce kuota + auto-complete
CREATE OR REPLACE FUNCTION public.prep_submit(
  _token text, _pin text, _task_item_id uuid,
  _photo_path text, _location_url text,
  _gps_lat double precision, _gps_lng double precision,
  _note text, _qty_reported numeric,
  _expected_updated_at timestamptz DEFAULT NULL,
  _photo_paths text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

  -- Kuota: hitung total submissions untuk task ini
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

  -- Auto-complete jika sudah mencapai kuota
  IF v_used + 1 >= coalesce(v_task.max_submissions, 1) THEN
    UPDATE public.prep_tasks
       SET status = 'completed', completed_at = now()
     WHERE id = v_task.id AND status = 'active';
  END IF;

  RETURN jsonb_build_object('ok', true, 'submission_id', v_sub_id, 'deducted', v_deduct, 'photo_count', coalesce(array_length(v_paths,1),0));
END $function$;

-- 4) request_submit_via_task: enforce kuota + auto-complete
CREATE OR REPLACE FUNCTION public.request_submit_via_task(
  _token text, _pin text, _title_id uuid, _items jsonb,
  _photo_path text, _location_url text,
  _gps_lat double precision, _gps_lng double precision,
  _note text, _prep_task_item_id uuid,
  _photo_paths text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_title public.request_titles%ROWTYPE;
  v_prep_id uuid; v_item jsonb; v_wid uuid; v_grams numeric; v_locked timestamptz;
  v_target numeric; v_title_item public.request_title_items%ROWTYPE;
  v_owned_wid uuid;
  v_paths text[]; v_p text; v_first_photo text;
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

  -- Kuota: hitung preparation yang sudah masuk lewat task ini
  SELECT count(*) INTO v_used FROM public.request_preparations WHERE via_task_id = v_task.id;
  IF v_used >= coalesce(v_task.max_submissions, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'task_exhausted');
  END IF;

  SELECT * INTO v_title FROM public.request_titles WHERE id = _title_id LIMIT 1;
  IF v_title.id IS NULL OR v_title.user_id <> v_task.owner_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_title');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb)) LOOP
    v_wid := nullif(v_item->>'warehouse_item_id','')::uuid;
    v_grams := coalesce((v_item->>'actual_grams')::numeric, 0);
    IF v_wid IS NULL THEN CONTINUE; END IF;
    IF v_grams < 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'bad_grams');
    END IF;
    SELECT id INTO v_owned_wid FROM public.warehouse_items
      WHERE id = v_wid AND user_id = v_task.owner_user_id;
    IF v_owned_wid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'item_not_owned');
    END IF;
    SELECT * INTO v_title_item FROM public.request_title_items
      WHERE title_id = v_title.id AND warehouse_item_id = v_wid
      ORDER BY position, created_at LIMIT 1;
    IF v_title_item.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'item_not_in_title');
    END IF;
    v_target := coalesce(v_title_item.target_grams, 0);
    IF v_target > 0 AND v_grams > v_target THEN
      RETURN jsonb_build_object('ok', false, 'error', 'grams_exceed_target',
        'target', v_target, 'submitted', v_grams);
    END IF;
  END LOOP;

  INSERT INTO public.request_preparations(
    user_id, title_id, photo_path, photo_paths, location_url, gps_lat, gps_lng, note, created_by, prep_task_item_id, via_task_id
  ) VALUES (
    v_task.owner_user_id, v_title.id, v_first_photo, v_paths, _location_url, _gps_lat, _gps_lng, _note, 'worker', _prep_task_item_id, v_task.id
  ) RETURNING id INTO v_prep_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb)) LOOP
    v_wid := nullif(v_item->>'warehouse_item_id','')::uuid;
    v_grams := coalesce((v_item->>'actual_grams')::numeric, 0);
    IF v_wid IS NULL THEN CONTINUE; END IF;
    SELECT id INTO v_owned_wid FROM public.warehouse_items
      WHERE id = v_wid AND user_id = v_task.owner_user_id;
    IF v_owned_wid IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.request_preparation_items(preparation_id, user_id, warehouse_item_id, actual_grams)
    VALUES (v_prep_id, v_task.owner_user_id, v_wid, v_grams);
  END LOOP;

  -- Auto-complete jika sudah mencapai kuota
  IF v_used + 1 >= coalesce(v_task.max_submissions, 1) THEN
    UPDATE public.prep_tasks
       SET status = 'completed', completed_at = now()
     WHERE id = v_task.id AND status = 'active';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_prep_id, 'photo_count', coalesce(array_length(v_paths,1),0));
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'request_submit_via_task error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'error', 'internal_error');
END $function$;