-- SPRINT 5 — gap closure Critical/High (idempotensi submit pegawai,
-- ledger stok immutable, laporan rekonsiliasi read-only).
-- Semua statement ditulis idempotent (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS)
-- supaya aman dijalankan ulang.

-- =====================================================================
-- 1. Guard idempotensi submit portal pegawai
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.worker_submit_idempotency (
  task_id    uuid NOT NULL REFERENCES public.prep_tasks(id) ON DELETE CASCADE,
  client_key text NOT NULL,
  result     jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, client_key)
);

-- Hanya fungsi SECURITY DEFINER di bawah yang menyentuh tabel ini.
REVOKE ALL ON public.worker_submit_idempotency FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.worker_submit_idempotency TO service_role;
ALTER TABLE public.worker_submit_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "no direct access" ON public.worker_submit_idempotency;
CREATE POLICY "no direct access" ON public.worker_submit_idempotency
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS worker_submit_idem_created_idx
  ON public.worker_submit_idempotency (created_at);

-- =====================================================================
-- 2. Ledger stok append-only
--    Setiap perubahan stock_base tercatat sebagai baris delta. Pembalikan
--    (retur/hapus paket) menghasilkan baris delta positif baru, bukan
--    penghapusan baris lama.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.stock_ledger (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           uuid NOT NULL,
  warehouse_item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE CASCADE,
  delta_base        numeric NOT NULL,
  balance_after     numeric NOT NULL,
  reason            text NOT NULL DEFAULT 'stock_change',
  actor             uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.stock_ledger TO authenticated;
GRANT ALL    ON public.stock_ledger TO service_role;
ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner reads own ledger" ON public.stock_ledger;
CREATE POLICY "owner reads own ledger" ON public.stock_ledger
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS stock_ledger_item_idx
  ON public.stock_ledger (warehouse_item_id, id DESC);
CREATE INDEX IF NOT EXISTS stock_ledger_user_idx
  ON public.stock_ledger (user_id, created_at DESC);

-- Immutability: tidak ada UPDATE/DELETE, termasuk lewat service_role.
CREATE OR REPLACE FUNCTION public.stock_ledger_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_ledger bersifat append-only: % ditolak', TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS trg_stock_ledger_immutable ON public.stock_ledger;
CREATE TRIGGER trg_stock_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION public.stock_ledger_immutable();

-- Perekam: satu titik untuk SEMUA jalur (POS, purchase, ecer, ready package,
-- request prep, edit manual) karena semuanya berakhir di warehouse_items.
CREATE OR REPLACE FUNCTION public.record_stock_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_delta numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_delta := COALESCE(NEW.stock_base, 0);
    IF v_delta = 0 THEN RETURN NEW; END IF;
    INSERT INTO public.stock_ledger(user_id, warehouse_item_id, delta_base, balance_after, reason, actor)
    VALUES (NEW.user_id, NEW.id, v_delta, COALESCE(NEW.stock_base,0), 'opening_balance', auth.uid());
    RETURN NEW;
  END IF;

  v_delta := COALESCE(NEW.stock_base, 0) - COALESCE(OLD.stock_base, 0);
  IF v_delta = 0 THEN RETURN NEW; END IF;

  INSERT INTO public.stock_ledger(user_id, warehouse_item_id, delta_base, balance_after, reason, actor)
  VALUES (
    NEW.user_id, NEW.id, v_delta, COALESCE(NEW.stock_base,0),
    COALESCE(NULLIF(current_setting('app.stock_reason', true), ''), 'stock_change'),
    auth.uid()
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_record_stock_ledger ON public.warehouse_items;
CREATE TRIGGER trg_record_stock_ledger
  AFTER INSERT OR UPDATE OF stock_base ON public.warehouse_items
  FOR EACH ROW EXECUTE FUNCTION public.record_stock_ledger();

-- =====================================================================
-- 3. Laporan rekonsiliasi read-only (tanpa menulis apa pun)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.stock_reconcile_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH led AS (
    SELECT warehouse_item_id, sum(delta_base) AS ledger_sum, max(id) AS last_id
      FROM public.stock_ledger WHERE user_id = auth.uid()
     GROUP BY warehouse_item_id
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'items', COALESCE(jsonb_agg(jsonb_build_object(
        'warehouse_item_id', w.id,
        'name', w.name,
        'stock_base', w.stock_base,
        'ledger_sum', COALESCE(l.ledger_sum, 0),
        'diff', COALESCE(w.stock_base,0) - COALESCE(l.ledger_sum, 0),
        'last_ledger_id', l.last_id
      ) ORDER BY abs(COALESCE(w.stock_base,0) - COALESCE(l.ledger_sum,0)) DESC), '[]'::jsonb),
    'mismatch_count', count(*) FILTER (WHERE COALESCE(w.stock_base,0) <> COALESCE(l.ledger_sum,0))
  )
  FROM public.warehouse_items w
  LEFT JOIN led l ON l.warehouse_item_id = w.id
  WHERE w.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.stock_reconcile_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_reconcile_v1() TO authenticated, service_role;

-- =====================================================================
-- 4. Idempotensi submit portal pegawai (parameter baru _client_key)
--    DROP dulu supaya TIDAK terjadi overloading (PostgREST: "could not
--    identify candidate function").
-- =====================================================================
DROP FUNCTION IF EXISTS public.ecer_submit_via_task(_token text, _pin text, _title_id uuid, _actual_grams numeric, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _prep_task_item_id uuid);
DROP FUNCTION IF EXISTS public.ecer_submit_via_task(_token text, _pin text, _title_id uuid, _actual_grams numeric, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _prep_task_item_id uuid, _client_key text);
CREATE FUNCTION public.ecer_submit_via_task(_token text, _pin text, _title_id uuid, _actual_grams numeric, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _prep_task_item_id uuid, _client_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_idem_ins int := 0;
  v_idem_prev jsonb;
  v_idem_result jsonb;
 v_task public.prep_tasks%ROWTYPE; v_title public.ecer_titles%ROWTYPE; v_id uuid; v_locked timestamptz;
BEGIN
  v_locked := public.prep_pin_locked_until(_token);
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited',
      'retry_after', extract(epoch from (v_locked - now()))::int);
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
  SELECT * INTO v_title FROM public.ecer_titles WHERE id = _title_id LIMIT 1;
  IF v_title.id IS NULL OR v_title.user_id <> v_task.owner_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_title');
  END IF;
  IF _actual_grams IS NULL OR _actual_grams < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_grams');
  END IF;


  -- SPRINT 5 (Critical): reservasi kunci idempotensi. Retry jaringan, restart
  -- WebView, atau double-tap tidak boleh menghasilkan submission kedua yang
  -- memotong stok dua kali. Reservasi ditaruh SETELAH semua validasi supaya
  -- error validasi tidak "membakar" kunci; bila blok EXCEPTION di bawah kena,
  -- reservasi ikut ter-rollback sehingga retry yang sah tetap bisa jalan.
  IF _client_key IS NOT NULL AND length(btrim(_client_key)) > 0 THEN
    INSERT INTO public.worker_submit_idempotency(task_id, client_key, result)
    VALUES (v_task.id, btrim(_client_key), NULL)
    ON CONFLICT (task_id, client_key) DO NOTHING;
    GET DIAGNOSTICS v_idem_ins = ROW_COUNT;
    IF v_idem_ins = 0 THEN
      SELECT result INTO v_idem_prev FROM public.worker_submit_idempotency
        WHERE task_id = v_task.id AND client_key = btrim(_client_key);
      IF v_idem_prev IS NOT NULL THEN
        RETURN v_idem_prev || jsonb_build_object('idempotent', true);
      END IF;
      RETURN jsonb_build_object('ok', false, 'error', 'in_progress');
    END IF;
  END IF;
  INSERT INTO public.ecer_preparations(
    user_id, title_id, warehouse_item_id, actual_grams,
    photo_path, location_url, gps_lat, gps_lng, note, created_by, prep_task_item_id
  ) VALUES (
    v_task.owner_user_id, v_title.id, v_title.warehouse_item_id, _actual_grams,
    _photo_path, _location_url, _gps_lat, _gps_lng, _note, 'worker', _prep_task_item_id
  ) RETURNING id INTO v_id;

  v_idem_result := jsonb_build_object('ok', true, 'id', v_id);
  IF _client_key IS NOT NULL AND length(btrim(_client_key)) > 0 THEN
    UPDATE public.worker_submit_idempotency SET result = v_idem_result
     WHERE task_id = v_task.id AND client_key = btrim(_client_key);
  END IF;
  RETURN v_idem_result;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ecer_submit_via_task error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'error', 'internal_error');
END $fn$;
REVOKE ALL ON FUNCTION public.ecer_submit_via_task(_token text, _pin text, _title_id uuid, _actual_grams numeric, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _prep_task_item_id uuid, _client_key text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ecer_submit_via_task(_token text, _pin text, _title_id uuid, _actual_grams numeric, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _prep_task_item_id uuid, _client_key text) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.request_submit_via_task(_token text, _pin text, _title_id uuid, _items jsonb, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _prep_task_item_id uuid, _photo_paths text[], _location_urls text[]);
DROP FUNCTION IF EXISTS public.request_submit_via_task(_token text, _pin text, _title_id uuid, _items jsonb, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _prep_task_item_id uuid, _photo_paths text[], _location_urls text[], _client_key text);
CREATE FUNCTION public.request_submit_via_task(_token text, _pin text, _title_id uuid, _items jsonb, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _prep_task_item_id uuid, _photo_paths text[], _location_urls text[], _client_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_idem_ins int := 0;
  v_idem_prev jsonb;
  v_idem_result jsonb;
 v_task public.prep_tasks%ROWTYPE; v_title public.request_titles%ROWTYPE;
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


  -- SPRINT 5 (Critical): reservasi kunci idempotensi. Retry jaringan, restart
  -- WebView, atau double-tap tidak boleh menghasilkan submission kedua yang
  -- memotong stok dua kali. Reservasi ditaruh SETELAH semua validasi supaya
  -- error validasi tidak "membakar" kunci; bila blok EXCEPTION di bawah kena,
  -- reservasi ikut ter-rollback sehingga retry yang sah tetap bisa jalan.
  IF _client_key IS NOT NULL AND length(btrim(_client_key)) > 0 THEN
    INSERT INTO public.worker_submit_idempotency(task_id, client_key, result)
    VALUES (v_task.id, btrim(_client_key), NULL)
    ON CONFLICT (task_id, client_key) DO NOTHING;
    GET DIAGNOSTICS v_idem_ins = ROW_COUNT;
    IF v_idem_ins = 0 THEN
      SELECT result INTO v_idem_prev FROM public.worker_submit_idempotency
        WHERE task_id = v_task.id AND client_key = btrim(_client_key);
      IF v_idem_prev IS NOT NULL THEN
        RETURN v_idem_prev || jsonb_build_object('idempotent', true);
      END IF;
      RETURN jsonb_build_object('ok', false, 'error', 'in_progress');
    END IF;
  END IF;
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

  v_idem_result := jsonb_build_object('ok', true, 'id', v_prep_id,
    'photo_count', coalesce(array_length(v_paths,1),0),
    'location_count', (SELECT count(*) FROM unnest(v_locs) l WHERE l <> ''));
  IF _client_key IS NOT NULL AND length(btrim(_client_key)) > 0 THEN
    UPDATE public.worker_submit_idempotency SET result = v_idem_result
     WHERE task_id = v_task.id AND client_key = btrim(_client_key);
  END IF;
  RETURN v_idem_result;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'request_submit_via_task error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'error', 'internal_error');
END $fn$;
REVOKE ALL ON FUNCTION public.request_submit_via_task(_token text, _pin text, _title_id uuid, _items jsonb, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _prep_task_item_id uuid, _photo_paths text[], _location_urls text[], _client_key text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_submit_via_task(_token text, _pin text, _title_id uuid, _items jsonb, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _prep_task_item_id uuid, _photo_paths text[], _location_urls text[], _client_key text) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.prep_submit(_token text, _pin text, _task_item_id uuid, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _qty_reported numeric, _expected_updated_at timestamp with time zone, _photo_paths text[]);
DROP FUNCTION IF EXISTS public.prep_submit(_token text, _pin text, _task_item_id uuid, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _qty_reported numeric, _expected_updated_at timestamp with time zone, _photo_paths text[], _client_key text);
CREATE FUNCTION public.prep_submit(_token text, _pin text, _task_item_id uuid, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _qty_reported numeric, _expected_updated_at timestamp with time zone, _photo_paths text[], _client_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_idem_ins int := 0;
  v_idem_prev jsonb;
  v_idem_result jsonb;

  v_task public.prep_tasks%ROWTYPE;
  v_item public.prep_task_items%ROWTYPE;
  v_title public.ecer_titles%ROWTYPE;
  v_sub_id uuid;
  v_ecer_prep_id uuid;
  v_stock numeric;
  v_deduct numeric;
  v_locked timestamptz;
  v_first_photo text;
  v_paths text[];
  v_p text;
  v_used int;
  v_item_count int;
  v_limit int;
  v_is_ecer boolean := false;
  v_stock_item_id uuid;
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

  SELECT * INTO v_task
  FROM public.prep_tasks
  WHERE share_token = _token AND status = 'active' AND expires_at > now()
  LIMIT 1;
  IF v_task.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_task.pin_hash <> extensions.crypt(_pin, v_task.pin_hash) THEN
    PERFORM public.record_prep_pin_failure(_token);
    RETURN jsonb_build_object('ok', false, 'error', 'bad_pin');
  END IF;

  SELECT count(*) INTO v_used FROM public.prep_submissions WHERE task_id = v_task.id;
  SELECT count(*) INTO v_item_count FROM public.prep_task_items WHERE task_id = v_task.id;
  v_limit := GREATEST(coalesce(v_task.max_submissions, 1), coalesce(v_item_count, 1));

  IF v_used >= v_limit THEN
    RETURN jsonb_build_object('ok', false, 'error', 'task_exhausted');
  END IF;

  SELECT * INTO v_item
  FROM public.prep_task_items
  WHERE id = _task_item_id AND task_id = v_task.id
  LIMIT 1;
  IF v_item.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_item'); END IF;

  IF _expected_updated_at IS NOT NULL
     AND v_item.updated_at IS NOT NULL
     AND v_item.updated_at > _expected_updated_at + interval '1 second' THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'item_changed',
      'current_updated_at', v_item.updated_at
    );
  END IF;

  v_is_ecer := v_item.ecer_title_id IS NOT NULL;
  IF v_is_ecer THEN
    SELECT * INTO v_title
    FROM public.ecer_titles
    WHERE id = v_item.ecer_title_id
      AND user_id = v_task.owner_user_id
    LIMIT 1;
    IF v_title.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'bad_ecer_title');
    END IF;
  END IF;

  v_deduct := COALESCE(NULLIF(v_item.qty_requested, 0), _qty_reported, 0);
  v_stock_item_id := COALESCE(v_item.warehouse_item_id, v_title.warehouse_item_id);

  IF v_deduct > 0 AND v_stock_item_id IS NOT NULL THEN
    SELECT stock_base INTO v_stock
    FROM public.warehouse_items
    WHERE id = v_stock_item_id AND user_id = v_task.owner_user_id
    FOR UPDATE;
    IF v_stock IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'item_not_found');
    END IF;
    IF v_stock < v_deduct THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_stock',
        'available', v_stock, 'requested', v_deduct);
    END IF;

    IF NOT v_is_ecer THEN
      UPDATE public.warehouse_items
      SET stock_base = stock_base - v_deduct, updated_at = now()
      WHERE id = v_stock_item_id AND user_id = v_task.owner_user_id;
    END IF;
  END IF;


  -- SPRINT 5 (Critical): reservasi kunci idempotensi. Retry jaringan, restart
  -- WebView, atau double-tap tidak boleh menghasilkan submission kedua yang
  -- memotong stok dua kali. Reservasi ditaruh SETELAH semua validasi supaya
  -- error validasi tidak "membakar" kunci; bila blok EXCEPTION di bawah kena,
  -- reservasi ikut ter-rollback sehingga retry yang sah tetap bisa jalan.
  IF _client_key IS NOT NULL AND length(btrim(_client_key)) > 0 THEN
    INSERT INTO public.worker_submit_idempotency(task_id, client_key, result)
    VALUES (v_task.id, btrim(_client_key), NULL)
    ON CONFLICT (task_id, client_key) DO NOTHING;
    GET DIAGNOSTICS v_idem_ins = ROW_COUNT;
    IF v_idem_ins = 0 THEN
      SELECT result INTO v_idem_prev FROM public.worker_submit_idempotency
        WHERE task_id = v_task.id AND client_key = btrim(_client_key);
      IF v_idem_prev IS NOT NULL THEN
        RETURN v_idem_prev || jsonb_build_object('idempotent', true);
      END IF;
      RETURN jsonb_build_object('ok', false, 'error', 'in_progress');
    END IF;
  END IF;
  INSERT INTO public.prep_submissions(
    task_id, task_item_id, photo_path, photo_paths, location_url, gps_lat, gps_lng, note, qty_reported
  )
  VALUES (
    v_task.id, v_item.id, v_first_photo, v_paths, _location_url, _gps_lat, _gps_lng, _note, v_deduct
  )
  RETURNING id INTO v_sub_id;

  IF v_is_ecer THEN
    INSERT INTO public.ecer_preparations(
      user_id,
      title_id,
      warehouse_item_id,
      actual_grams,
      photo_path,
      photo_paths,
      location_url,
      gps_lat,
      gps_lng,
      note,
      created_by,
      prep_task_item_id,
      prep_submission_id
    ) VALUES (
      v_task.owner_user_id,
      v_title.id,
      v_title.warehouse_item_id,
      GREATEST(COALESCE(v_deduct, 0), 0),
      v_first_photo,
      v_paths,
      _location_url,
      _gps_lat,
      _gps_lng,
      _note,
      'worker',
      v_item.id,
      v_sub_id
    )
    RETURNING id INTO v_ecer_prep_id;
  END IF;

  IF v_deduct > 0 THEN
    UPDATE public.prep_task_items
    SET qty_prepared = COALESCE(qty_prepared,0) + v_deduct
    WHERE id = v_item.id;
  END IF;

  IF v_used + 1 >= v_limit THEN
    UPDATE public.prep_tasks
       SET status = 'done', completed_at = now()
     WHERE id = v_task.id AND status = 'active';
  END IF;

  v_idem_result := jsonb_build_object(
    'ok', true,
    'submission_id', v_sub_id,
    'ecer_preparation_id', v_ecer_prep_id,
    'deducted', v_deduct,
    'photo_count', coalesce(array_length(v_paths,1),0)
  );
  IF _client_key IS NOT NULL AND length(btrim(_client_key)) > 0 THEN
    UPDATE public.worker_submit_idempotency SET result = v_idem_result
     WHERE task_id = v_task.id AND client_key = btrim(_client_key);
  END IF;
  RETURN v_idem_result;

END$fn$;
REVOKE ALL ON FUNCTION public.prep_submit(_token text, _pin text, _task_item_id uuid, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _qty_reported numeric, _expected_updated_at timestamp with time zone, _photo_paths text[], _client_key text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prep_submit(_token text, _pin text, _task_item_id uuid, _photo_path text, _location_url text, _gps_lat double precision, _gps_lng double precision, _note text, _qty_reported numeric, _expected_updated_at timestamp with time zone, _photo_paths text[], _client_key text) TO anon, authenticated, service_role;

