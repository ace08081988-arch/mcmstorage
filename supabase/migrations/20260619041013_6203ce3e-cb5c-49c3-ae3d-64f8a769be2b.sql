
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.prep_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Tugas siapkan barang',
  note text,
  share_token text NOT NULL UNIQUE,
  pin_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','cancelled','expired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prep_tasks TO authenticated;
GRANT ALL ON public.prep_tasks TO service_role;
ALTER TABLE public.prep_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages prep_tasks" ON public.prep_tasks FOR ALL TO authenticated
  USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);
CREATE TRIGGER trg_prep_tasks_updated_at BEFORE UPDATE ON public.prep_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_prep_tasks_owner ON public.prep_tasks(owner_user_id, status, created_at DESC);

CREATE TABLE public.prep_task_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.prep_tasks(id) ON DELETE CASCADE,
  warehouse_item_id uuid REFERENCES public.warehouse_items(id) ON DELETE SET NULL,
  name_snapshot text NOT NULL,
  category_snapshot text,
  qty_requested numeric NOT NULL DEFAULT 1,
  qty_prepared numeric NOT NULL DEFAULT 0,
  unit_label text,
  ref_photo_path text,
  note text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prep_task_items TO authenticated;
GRANT ALL ON public.prep_task_items TO service_role;
ALTER TABLE public.prep_task_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages prep_task_items" ON public.prep_task_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.prep_tasks t WHERE t.id = task_id AND t.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.prep_tasks t WHERE t.id = task_id AND t.owner_user_id = auth.uid()));
CREATE INDEX idx_prep_task_items_task ON public.prep_task_items(task_id, position);

CREATE TABLE public.prep_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.prep_tasks(id) ON DELETE CASCADE,
  task_item_id uuid NOT NULL REFERENCES public.prep_task_items(id) ON DELETE CASCADE,
  photo_path text,
  location_url text,
  gps_lat double precision,
  gps_lng double precision,
  note text,
  qty_reported numeric,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prep_submissions TO authenticated;
GRANT ALL ON public.prep_submissions TO service_role;
ALTER TABLE public.prep_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads prep_submissions" ON public.prep_submissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.prep_tasks t WHERE t.id = task_id AND t.owner_user_id = auth.uid()));
CREATE POLICY "owner deletes prep_submissions" ON public.prep_submissions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.prep_tasks t WHERE t.id = task_id AND t.owner_user_id = auth.uid()));
CREATE INDEX idx_prep_submissions_task ON public.prep_submissions(task_id, submitted_at DESC);
CREATE INDEX idx_prep_submissions_item ON public.prep_submissions(task_item_id, submitted_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.prep_submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.prep_task_items;

CREATE OR REPLACE FUNCTION public.prep_get_task(_token text, _pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_task public.prep_tasks%ROWTYPE; v_items jsonb;
BEGIN
  SELECT * INTO v_task FROM public.prep_tasks
    WHERE share_token = _token AND status = 'active' AND expires_at > now() LIMIT 1;
  IF v_task.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_task.pin_hash <> crypt(_pin, v_task.pin_hash) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_pin');
  END IF;
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
END $$;
REVOKE ALL ON FUNCTION public.prep_get_task(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.prep_get_task(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.prep_submit(
  _token text, _pin text, _task_item_id uuid, _photo_path text,
  _location_url text, _gps_lat double precision, _gps_lng double precision,
  _note text, _qty_reported numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_task public.prep_tasks%ROWTYPE; v_item public.prep_task_items%ROWTYPE; v_sub_id uuid;
BEGIN
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
END $$;
REVOKE ALL ON FUNCTION public.prep_submit(text, text, uuid, text, text, double precision, double precision, text, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.prep_submit(text, text, uuid, text, text, double precision, double precision, text, numeric) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.prep_create_task(
  _title text, _note text, _pin text, _share_token text, _items jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_task_id uuid; v_item jsonb; v_pos int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF length(coalesce(_pin,'')) < 4 THEN RAISE EXCEPTION 'pin_too_short'; END IF;
  INSERT INTO public.prep_tasks(owner_user_id, title, note, share_token, pin_hash)
  VALUES (v_uid, coalesce(nullif(_title,''),'Tugas siapkan barang'), _note, _share_token, crypt(_pin, gen_salt('bf',8)))
  RETURNING id INTO v_task_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    INSERT INTO public.prep_task_items(task_id, warehouse_item_id, name_snapshot, category_snapshot, qty_requested, unit_label, ref_photo_path, note, position)
    VALUES (v_task_id, nullif(v_item->>'warehouse_item_id','')::uuid,
      coalesce(v_item->>'name', 'Item'), v_item->>'category',
      coalesce((v_item->>'qty_requested')::numeric, 1),
      v_item->>'unit_label', v_item->>'ref_photo_path', v_item->>'note', v_pos);
    v_pos := v_pos + 1;
  END LOOP;
  RETURN v_task_id;
END $$;
REVOKE ALL ON FUNCTION public.prep_create_task(text, text, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.prep_create_task(text, text, text, text, jsonb) TO authenticated;

CREATE POLICY "prep-photos public read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'prep-photos');
CREATE POLICY "prep-photos anon insert" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'prep-photos');
CREATE POLICY "prep-photos auth delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'prep-photos');
