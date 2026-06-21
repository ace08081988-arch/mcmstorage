
-- 1) Replace ecer_submit_via_task: log SQLERRM server-side, return generic error
CREATE OR REPLACE FUNCTION public.ecer_submit_via_task(_token text, _pin text, _title_id uuid, _actual_grams numeric, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _prep_task_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_title public.ecer_titles%ROWTYPE; v_id uuid;
BEGIN
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
  SELECT * INTO v_title FROM public.ecer_titles WHERE id = _title_id LIMIT 1;
  IF v_title.id IS NULL OR v_title.user_id <> v_task.owner_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_title');
  END IF;
  IF _actual_grams IS NULL OR _actual_grams < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_grams');
  END IF;

  INSERT INTO public.ecer_preparations(
    user_id, title_id, warehouse_item_id, actual_grams,
    photo_path, location_url, gps_lat, gps_lng, note, created_by, prep_task_item_id
  ) VALUES (
    v_task.owner_user_id, v_title.id, v_title.warehouse_item_id, _actual_grams,
    _photo_path, _location_url, _gps_lat, _gps_lng, _note, 'worker', _prep_task_item_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ecer_submit_via_task error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'error', 'internal_error');
END $function$;

-- 2) Server-side CHECK on ready_packages.location_url to enforce https://
ALTER TABLE public.ready_packages
  DROP CONSTRAINT IF EXISTS ready_packages_location_url_https_chk;
ALTER TABLE public.ready_packages
  ADD CONSTRAINT ready_packages_location_url_https_chk
  CHECK (location_url IS NULL OR location_url ~* '^https://');
