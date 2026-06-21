
-- 1) Replace SQLERRM leak in request_submit_via_task with a generic message
CREATE OR REPLACE FUNCTION public.request_submit_via_task(_token text, _pin text, _title_id uuid, _items jsonb, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _prep_task_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_title public.request_titles%ROWTYPE;
  v_prep_id uuid; v_item jsonb; v_wid uuid; v_grams numeric;
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
  SELECT * INTO v_title FROM public.request_titles WHERE id = _title_id LIMIT 1;
  IF v_title.id IS NULL OR v_title.user_id <> v_task.owner_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_title');
  END IF;

  INSERT INTO public.request_preparations(
    user_id, title_id, photo_path, location_url, gps_lat, gps_lng, note, created_by, prep_task_item_id, via_task_id
  ) VALUES (
    v_task.owner_user_id, v_title.id, _photo_path, _location_url, _gps_lat, _gps_lng, _note, 'worker', _prep_task_item_id, v_task.id
  ) RETURNING id INTO v_prep_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb)) LOOP
    v_wid := nullif(v_item->>'warehouse_item_id','')::uuid;
    v_grams := coalesce((v_item->>'actual_grams')::numeric, 0);
    IF v_wid IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.request_preparation_items(preparation_id, user_id, warehouse_item_id, actual_grams)
    VALUES (v_prep_id, v_task.owner_user_id, v_wid, v_grams);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'id', v_prep_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'request_submit_via_task error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'error', 'internal_error');
END $function$;

-- 2) Move cron secret out of email_send_state into Vault-backed RPC
CREATE OR REPLACE FUNCTION public.get_email_cron_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_secret text;
BEGIN
  IF auth.jwt() ->> 'role' <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'email_queue_cron_secret'
    LIMIT 1;
  RETURN v_secret;
END $$;

REVOKE ALL ON FUNCTION public.get_email_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_cron_secret() TO service_role;

-- Drop the plaintext mirror column; secret remains in Vault and is read via RPC
ALTER TABLE public.email_send_state DROP COLUMN IF EXISTS cron_secret;
