
-- 1) Kolom updated_at untuk versi optimistic locking
ALTER TABLE public.prep_task_items
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_prep_task_items_updated_at ON public.prep_task_items;
CREATE TRIGGER trg_prep_task_items_updated_at
BEFORE UPDATE ON public.prep_task_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Broadcast helper: kirim ping ke topic prep:<share_token>
CREATE OR REPLACE FUNCTION public.prep_broadcast_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime
AS $$
DECLARE
  v_token text;
  v_kind  text;
  v_op    text;
  v_item  uuid;
BEGIN
  IF TG_TABLE_NAME = 'prep_tasks' THEN
    v_kind := 'task';
    v_token := COALESCE(NEW.share_token, OLD.share_token);
    v_op := lower(TG_OP);
  ELSIF TG_TABLE_NAME = 'prep_task_items' THEN
    v_kind := 'item';
    v_op := lower(TG_OP);
    v_item := COALESCE(NEW.id, OLD.id);
    SELECT share_token INTO v_token FROM public.prep_tasks
     WHERE id = COALESCE(NEW.task_id, OLD.task_id);
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_token IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  PERFORM realtime.send(
    jsonb_build_object('kind', v_kind, 'op', v_op, 'item_id', v_item, 'ts', extract(epoch from now())),
    'change',
    'prep:' || v_token,
    false  -- public (non-private) channel
  );
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Jangan gagalkan operasi utama hanya karena broadcast bermasalah.
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_prep_tasks_broadcast ON public.prep_tasks;
CREATE TRIGGER trg_prep_tasks_broadcast
AFTER INSERT OR UPDATE OR DELETE ON public.prep_tasks
FOR EACH ROW EXECUTE FUNCTION public.prep_broadcast_change();

DROP TRIGGER IF EXISTS trg_prep_task_items_broadcast ON public.prep_task_items;
CREATE TRIGGER trg_prep_task_items_broadcast
AFTER INSERT OR UPDATE OR DELETE ON public.prep_task_items
FOR EACH ROW EXECUTE FUNCTION public.prep_broadcast_change();

-- 3) RLS pada realtime.messages: izinkan anon SELECT untuk topic prep:*
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='realtime' AND c.relname='messages') THEN
    EXECUTE 'DROP POLICY IF EXISTS "prep_topic_anon_read" ON realtime.messages';
    EXECUTE $p$CREATE POLICY "prep_topic_anon_read"
      ON realtime.messages FOR SELECT TO anon, authenticated
      USING (realtime.topic() LIKE 'prep:%')$p$;
  END IF;
END $$;

-- 4) prep_submit dengan optimistic locking via _expected_updated_at
CREATE OR REPLACE FUNCTION public.prep_submit(
  _token text, _pin text, _task_item_id uuid,
  _photo_path text, _location_url text,
  _gps_lat double precision, _gps_lng double precision,
  _note text, _qty_reported numeric,
  _expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_item public.prep_task_items%ROWTYPE; v_sub_id uuid;
        v_stock numeric; v_deduct numeric; v_locked timestamptz;
BEGIN
  v_locked := public.prep_pin_locked_until(_token);
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited',
      'retry_after', extract(epoch from (v_locked - now()))::int);
  END IF;
  IF _photo_path IS NULL OR length(trim(_photo_path)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'photo_required');
  END IF;
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
  SELECT * INTO v_item FROM public.prep_task_items WHERE id = _task_item_id AND task_id = v_task.id LIMIT 1;
  IF v_item.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_item'); END IF;

  -- Optimistic locking: pegawai mengirim versi item yang dia lihat;
  -- jika admin telah mengubah item sejak itu, tolak.
  IF _expected_updated_at IS NOT NULL
     AND v_item.updated_at IS NOT NULL
     AND v_item.updated_at > _expected_updated_at + interval '1 second' THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'item_changed',
      'current_updated_at', v_item.updated_at
    );
  END IF;

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

-- 5) prep_get_task: sertakan updated_at item agar klien punya versi
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
    WHERE share_token = _token AND status = 'active' AND expires_at > now() LIMIT 1;
  IF v_task.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
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
