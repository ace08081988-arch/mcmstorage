-- 1) Tabel pencatat kegagalan PIN (internal, service_role only)
CREATE TABLE public.prep_pin_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_token text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.prep_pin_failures TO service_role;
ALTER TABLE public.prep_pin_failures ENABLE ROW LEVEL SECURITY;
-- Tidak ada policy untuk anon/authenticated → RLS memblokir baca/tulis langsung.
CREATE INDEX prep_pin_failures_token_time
  ON public.prep_pin_failures(share_token, attempted_at DESC);

-- 2) Tabel peringatan untuk pemilik tugas
CREATE TABLE public.prep_pin_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.prep_tasks(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  share_token text NOT NULL,
  failure_count integer NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.prep_pin_alerts TO authenticated;
GRANT ALL ON public.prep_pin_alerts TO service_role;
ALTER TABLE public.prep_pin_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads own pin alerts"
  ON public.prep_pin_alerts FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY "owner acks own pin alerts"
  ON public.prep_pin_alerts FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- Blok INSERT/DELETE oleh authenticated; hanya service_role / SECURITY DEFINER fn.
CREATE POLICY "no client insert pin alerts"
  ON public.prep_pin_alerts AS RESTRICTIVE
  FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "no client delete pin alerts"
  ON public.prep_pin_alerts AS RESTRICTIVE
  FOR DELETE TO anon, authenticated USING (false);

CREATE INDEX prep_pin_alerts_owner_unack
  ON public.prep_pin_alerts(owner_user_id, acknowledged_at, created_at DESC);

-- 3) Helper internal: catat kegagalan + buat alert bila melewati ambang
CREATE OR REPLACE FUNCTION public.record_prep_pin_failure(_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.prep_tasks%ROWTYPE;
  v_count integer;
  v_window_start timestamptz := now() - interval '10 minutes';
  v_already boolean;
BEGIN
  INSERT INTO public.prep_pin_failures(share_token) VALUES (_token);

  SELECT * INTO v_task FROM public.prep_tasks WHERE share_token = _token LIMIT 1;
  IF v_task.id IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_count
    FROM public.prep_pin_failures
   WHERE share_token = _token AND attempted_at >= v_window_start;

  IF v_count >= 5 THEN
    SELECT EXISTS(
      SELECT 1 FROM public.prep_pin_alerts
       WHERE share_token = _token
         AND acknowledged_at IS NULL
         AND created_at >= v_window_start
    ) INTO v_already;

    IF NOT v_already THEN
      INSERT INTO public.prep_pin_alerts(
        task_id, owner_user_id, share_token, failure_count, window_start, window_end
      ) VALUES (
        v_task.id, v_task.owner_user_id, _token, v_count, v_window_start, now()
      );
    ELSE
      -- Perbarui hitungan & window_end pada alert yang masih terbuka.
      UPDATE public.prep_pin_alerts
         SET failure_count = v_count, window_end = now()
       WHERE share_token = _token AND acknowledged_at IS NULL
         AND created_at >= v_window_start;
    END IF;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_prep_pin_failure(text) FROM public, anon, authenticated;

-- 4) Update prep_get_task: catat kegagalan saat PIN salah
CREATE OR REPLACE FUNCTION public.prep_get_task(_token text, _pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_items jsonb;
BEGIN
  SELECT * INTO v_task FROM public.prep_tasks
    WHERE share_token = _token AND status = 'active' AND expires_at > now() LIMIT 1;
  IF v_task.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_task.pin_hash <> extensions.crypt(_pin, v_task.pin_hash) THEN
    PERFORM public.record_prep_pin_failure(_token);
    RETURN jsonb_build_object('ok', false, 'error', 'bad_pin');
  END IF;

  INSERT INTO public.prep_upload_grants(share_token, expires_at)
  VALUES (v_task.share_token, now() + interval '15 minutes')
  ON CONFLICT (share_token) DO UPDATE
    SET expires_at = EXCLUDED.expires_at,
        issued_at = now();

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'name', i.name_snapshot, 'category', i.category_snapshot,
    'qty_requested', i.qty_requested, 'qty_prepared', i.qty_prepared,
    'unit_label', i.unit_label, 'ref_photo_path', i.ref_photo_path, 'note', i.note,
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
    'status', v_task.status, 'expires_at', v_task.expires_at
  ), 'items', v_items);
END $function$;

-- 5) Update prep_submit: catat kegagalan saat PIN salah
CREATE OR REPLACE FUNCTION public.prep_submit(_token text, _pin text, _task_item_id uuid, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _qty_reported numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_item public.prep_task_items%ROWTYPE; v_sub_id uuid; v_stock numeric; v_deduct numeric;
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
  IF v_task.pin_hash <> extensions.crypt(_pin, v_task.pin_hash) THEN
    PERFORM public.record_prep_pin_failure(_token);
    RETURN jsonb_build_object('ok', false, 'error', 'bad_pin');
  END IF;
  SELECT * INTO v_item FROM public.prep_task_items WHERE id = _task_item_id AND task_id = v_task.id LIMIT 1;
  IF v_item.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_item'); END IF;

  v_deduct := COALESCE(NULLIF(v_item.qty_requested, 0), _qty_reported, 0);

  INSERT INTO public.prep_submissions(task_id, task_item_id, photo_path, location_url, gps_lat, gps_lng, note, qty_reported)
  VALUES (v_task.id, v_item.id, _photo_path, _location_url, _gps_lat, _gps_lng, _note, v_deduct)
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

  RETURN jsonb_build_object('ok', true, 'submission_id', v_sub_id, 'deducted', v_deduct);
END $function$;