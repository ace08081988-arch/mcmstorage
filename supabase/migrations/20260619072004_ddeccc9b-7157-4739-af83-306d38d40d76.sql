
CREATE POLICY "Block anon and authenticated email send log access"
ON public.email_send_log
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "Users read own otp challenges" ON public.device_otp_challenges;
CREATE POLICY "Users read own otp challenges"
ON public.device_otp_challenges
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Block direct inserts on prep_submissions"
ON public.prep_submissions
AS RESTRICTIVE
FOR INSERT
TO anon, authenticated
WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.prep_submit(_token text, _pin text, _task_item_id uuid, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _qty_reported numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_item public.prep_task_items%ROWTYPE; v_sub_id uuid;
BEGIN
  IF _location_url IS NOT NULL THEN
    IF length(_location_url) > 2048 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'url_too_long');
    END IF;
    IF _location_url !~* '^https://' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_url');
    END IF;
  END IF;
  IF _note IS NOT NULL AND length(_note) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'note_too_long');
  END IF;
  SELECT * INTO v_task FROM public.prep_tasks
    WHERE share_token = _token AND status = 'active' AND expires_at > now() LIMIT 1;
  IF v_task.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_task.pin_hash <> crypt(_pin, v_task.pin_hash) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_pin');
  END IF;
  SELECT * INTO v_item FROM public.prep_task_items WHERE id = _task_item_id AND task_id = v_task.id LIMIT 1;
  IF v_item.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_item'); END IF;
  INSERT INTO public.prep_submissions(task_id, task_item_id, photo_path, location_url, gps_lat, gps_lng, note, qty_reported)
  VALUES (v_task.id, v_item.id, _photo_path, _location_url, _gps_lat, _gps_lng, _note, _qty_reported)
  RETURNING id INTO v_sub_id;
  IF _qty_reported IS NOT NULL THEN
    UPDATE public.prep_task_items SET qty_prepared = COALESCE(qty_prepared,0) + _qty_reported WHERE id = v_item.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'submission_id', v_sub_id);
END $function$;

DROP POLICY IF EXISTS "prep-photos public read" ON storage.objects;
DROP POLICY IF EXISTS "prep-photos guarded read" ON storage.objects;
CREATE POLICY "prep-photos guarded read"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'prep-photos'
  AND (
    EXISTS (
      SELECT 1 FROM public.prep_tasks t
      WHERE t.share_token = (storage.foldername(name))[1]
        AND t.status = 'active'
        AND t.expires_at > now()
    )
    OR EXISTS (
      SELECT 1 FROM public.prep_tasks t
      WHERE t.share_token = (storage.foldername(name))[1]
        AND t.owner_user_id = auth.uid()
    )
  )
);

REVOKE EXECUTE ON FUNCTION public.prep_create_task(text, text, text, text, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.email_queue_health() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
