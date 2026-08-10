ALTER TABLE public.request_preparations
  ADD COLUMN IF NOT EXISTS location_urls text[];

UPDATE public.request_preparations
   SET location_urls = ARRAY[location_url]::text[]
 WHERE location_urls IS NULL
   AND location_url IS NOT NULL
   AND length(trim(location_url)) > 0;

DROP FUNCTION IF EXISTS public.request_submit_via_task(text, text, uuid, jsonb, text, text, double precision, double precision, text, uuid, text[]);

CREATE OR REPLACE FUNCTION public.request_submit_via_task(
  _token text,
  _pin text,
  _title_id uuid,
  _items jsonb,
  _photo_path text,
  _location_url text,
  _gps_lat double precision,
  _gps_lng double precision,
  _note text,
  _prep_task_item_id uuid,
  _photo_paths text[],
  _location_urls text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_title public.request_titles%ROWTYPE;
  v_prep_id uuid; v_item jsonb; v_wid uuid; v_grams numeric; v_locked timestamptz;
  v_target numeric; v_title_item public.request_title_items%ROWTYPE;
  v_owned_wid uuid;
  v_paths text[]; v_p text; v_first_photo text;
  v_locs text[]; v_loc text; v_i int;
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

  -- Daftar lokasi disejajarkan dengan urutan foto: index i = foto ke-i.
  v_locs := ARRAY[]::text[];
  FOR v_i IN 1..array_length(v_paths,1) LOOP
    v_loc := NULL;
    IF _location_urls IS NOT NULL AND array_length(_location_urls,1) >= v_i THEN
      v_loc := nullif(trim(coalesce(_location_urls[v_i], '')), '');
    END IF;
    IF v_i = 1 AND v_loc IS NULL THEN
      v_loc := nullif(trim(coalesce(_location_url, '')), '');
    END IF;
    IF v_loc IS NOT NULL THEN
      IF length(v_loc) > 2048 THEN RETURN jsonb_build_object('ok', false, 'error', 'url_too_long'); END IF;
      IF v_loc !~* '^https://' THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_url'); END IF;
    END IF;
    v_locs := array_append(v_locs, coalesce(v_loc, ''));
  END LOOP;

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
    user_id, title_id, photo_path, photo_paths, location_url, location_urls, gps_lat, gps_lng, note, created_by, prep_task_item_id, via_task_id
  ) VALUES (
    v_task.owner_user_id, v_title.id, v_first_photo, v_paths,
    nullif(v_locs[1], ''), v_locs,
    _gps_lat, _gps_lng, _note, 'worker', _prep_task_item_id, v_task.id
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

  IF v_used + 1 >= coalesce(v_task.max_submissions, 1) THEN
    UPDATE public.prep_tasks
       SET status = 'done', completed_at = now()
     WHERE id = v_task.id AND status = 'active';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_prep_id,
    'photo_count', coalesce(array_length(v_paths,1),0),
    'location_count', (SELECT count(*) FROM unnest(v_locs) l WHERE l <> ''));
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'request_submit_via_task error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'error', 'internal_error');
END $function$;