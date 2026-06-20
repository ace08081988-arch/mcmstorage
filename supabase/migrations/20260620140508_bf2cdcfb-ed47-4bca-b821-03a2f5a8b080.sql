
-- 1) request_titles: judul paket multi-produk
CREATE TABLE public.request_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  note text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.request_titles TO authenticated;
GRANT ALL ON public.request_titles TO service_role;
ALTER TABLE public.request_titles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own request_titles" ON public.request_titles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_request_titles_updated
  BEFORE UPDATE ON public.request_titles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) request_title_items: item template dalam judul
CREATE TABLE public.request_title_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id uuid NOT NULL REFERENCES public.request_titles(id) ON DELETE CASCADE,
  warehouse_item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE RESTRICT,
  target_grams numeric NOT NULL DEFAULT 0,
  unit_label text NOT NULL DEFAULT 'gram',
  note text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.request_title_items TO authenticated;
GRANT ALL ON public.request_title_items TO service_role;
ALTER TABLE public.request_title_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own request_title_items" ON public.request_title_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.request_titles t WHERE t.id = title_id AND t.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.request_titles t WHERE t.id = title_id AND t.user_id = auth.uid())
  );
CREATE TRIGGER trg_request_title_items_updated
  BEFORE UPDATE ON public.request_title_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_request_title_items_title ON public.request_title_items(title_id);

-- 3) request_preparations: realisasi 1 paket
CREATE TABLE public.request_preparations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title_id uuid NOT NULL REFERENCES public.request_titles(id) ON DELETE RESTRICT,
  photo_path text,
  location_url text,
  gps_lat double precision,
  gps_lng double precision,
  note text,
  created_by text NOT NULL DEFAULT 'admin',
  prep_task_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.request_preparations TO authenticated;
GRANT ALL ON public.request_preparations TO service_role;
ALTER TABLE public.request_preparations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own request_preparations" ON public.request_preparations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_request_preparations_title ON public.request_preparations(title_id);

-- 4) request_preparation_items: detail item per penyiapan (potong stok)
CREATE TABLE public.request_preparation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_id uuid NOT NULL REFERENCES public.request_preparations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  warehouse_item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE RESTRICT,
  actual_grams numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.request_preparation_items TO authenticated;
GRANT ALL ON public.request_preparation_items TO service_role;
ALTER TABLE public.request_preparation_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own request_preparation_items" ON public.request_preparation_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_request_prep_items_prep ON public.request_preparation_items(preparation_id);

-- 5) Trigger pengurangan stok per item
CREATE OR REPLACE FUNCTION public.apply_request_preparation_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_stock numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.actual_grams > 0 THEN
      SELECT stock_base INTO v_stock FROM public.warehouse_items
        WHERE id = NEW.warehouse_item_id AND user_id = NEW.user_id FOR UPDATE;
      IF v_stock IS NULL THEN RAISE EXCEPTION 'Barang tidak ditemukan'; END IF;
      IF v_stock < NEW.actual_grams THEN
        RAISE EXCEPTION 'Stok tidak cukup (tersedia %, diminta %)', v_stock, NEW.actual_grams;
      END IF;
      UPDATE public.warehouse_items
        SET stock_base = stock_base - NEW.actual_grams, updated_at = now()
        WHERE id = NEW.warehouse_item_id AND user_id = NEW.user_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.actual_grams > 0 THEN
      UPDATE public.warehouse_items
        SET stock_base = stock_base + OLD.actual_grams, updated_at = now()
        WHERE id = OLD.warehouse_item_id AND user_id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_apply_request_preparation_item
  AFTER INSERT OR DELETE ON public.request_preparation_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_request_preparation_item();

-- 6) RPC pegawai: list judul + items via task token
CREATE OR REPLACE FUNCTION public.request_list_titles_via_task(_token text, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_task public.prep_tasks%ROWTYPE; v_rows jsonb;
BEGIN
  SELECT * INTO v_task FROM public.prep_tasks
    WHERE share_token = _token AND status = 'active' AND expires_at > now() LIMIT 1;
  IF v_task.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_task.pin_hash <> extensions.crypt(_pin, v_task.pin_hash) THEN
    PERFORM public.record_prep_pin_failure(_token);
    RETURN jsonb_build_object('ok', false, 'error', 'bad_pin');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'note', t.note,
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
  WHERE t.user_id = v_task.owner_user_id;
  RETURN jsonb_build_object('ok', true, 'titles', v_rows);
END $$;

-- 7) RPC pegawai: submit penyiapan request
CREATE OR REPLACE FUNCTION public.request_submit_via_task(
  _token text, _pin text, _title_id uuid, _items jsonb,
  _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision,
  _note text, _prep_task_item_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
    user_id, title_id, photo_path, location_url, gps_lat, gps_lng, note, created_by, prep_task_item_id
  ) VALUES (
    v_task.owner_user_id, v_title.id, _photo_path, _location_url, _gps_lat, _gps_lng, _note, 'worker', _prep_task_item_id
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
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;
