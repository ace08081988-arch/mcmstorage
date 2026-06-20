
-- 1) ecer_titles
CREATE TABLE public.ecer_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  warehouse_item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_grams numeric NOT NULL DEFAULT 0,
  unit_label text NOT NULL DEFAULT 'gram',
  note text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecer_titles TO authenticated;
GRANT ALL ON public.ecer_titles TO service_role;

ALTER TABLE public.ecer_titles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ecer_titles owner all"
  ON public.ecer_titles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_ecer_titles_user_item ON public.ecer_titles(user_id, warehouse_item_id);

CREATE TRIGGER trg_ecer_titles_updated_at
  BEFORE UPDATE ON public.ecer_titles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) ecer_preparations
CREATE TABLE public.ecer_preparations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title_id uuid NOT NULL REFERENCES public.ecer_titles(id) ON DELETE CASCADE,
  warehouse_item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE CASCADE,
  actual_grams numeric NOT NULL CHECK (actual_grams >= 0),
  photo_path text,
  location_url text,
  gps_lat double precision,
  gps_lng double precision,
  note text,
  created_by text NOT NULL DEFAULT 'admin', -- 'admin' | 'worker'
  prep_task_item_id uuid REFERENCES public.prep_task_items(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecer_preparations TO authenticated;
GRANT ALL ON public.ecer_preparations TO service_role;

ALTER TABLE public.ecer_preparations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ecer_preparations owner all"
  ON public.ecer_preparations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_ecer_prep_title ON public.ecer_preparations(title_id, created_at DESC);
CREATE INDEX idx_ecer_prep_user ON public.ecer_preparations(user_id, created_at DESC);

-- 3) Trigger: auto deduct stok
CREATE OR REPLACE FUNCTION public.apply_ecer_preparation()
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

CREATE TRIGGER trg_apply_ecer_preparation
  AFTER INSERT OR DELETE ON public.ecer_preparations
  FOR EACH ROW EXECUTE FUNCTION public.apply_ecer_preparation();

-- 4) RPC: list ecer titles for a worker via task
CREATE OR REPLACE FUNCTION public.ecer_list_titles_via_task(_token text, _pin text, _warehouse_item_id uuid)
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
    'id', t.id, 'name', t.name, 'target_grams', t.target_grams,
    'unit_label', t.unit_label, 'note', t.note
  ) ORDER BY t.position, t.created_at), '[]'::jsonb) INTO v_rows
  FROM public.ecer_titles t
  WHERE t.user_id = v_task.owner_user_id
    AND t.warehouse_item_id = _warehouse_item_id;
  RETURN jsonb_build_object('ok', true, 'titles', v_rows);
END $$;

-- 5) RPC: submit ecer preparation via task
CREATE OR REPLACE FUNCTION public.ecer_submit_via_task(
  _token text, _pin text, _title_id uuid, _actual_grams numeric,
  _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision,
  _note text, _prep_task_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

GRANT EXECUTE ON FUNCTION public.ecer_list_titles_via_task(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ecer_submit_via_task(text, text, uuid, numeric, text, text, double precision, double precision, text, uuid) TO anon, authenticated;
