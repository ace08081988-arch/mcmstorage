-- Regression test: partial-index sold_at IS NULL untuk `ecer_preparations`
-- Menjamin dua hal setelah perubahan indeks apa pun di masa depan:
--   1. KORREKTNESS  — filter `sold_at IS NULL` per user_id hanya
--      mengembalikan baris milik user tersebut yang belum terjual.
--   2. PLAN PATH    — planner mau memilih salah satu partial index
--      (idx_ecer_prep_active_per_user / idx_ecer_prep_active_per_title)
--      untuk hot-path daftar Aktif — bukan Seq Scan + Filter.
--
-- Menyusul konvensi test lain di repo ini (bukan pgTAP extension,
-- melainkan plpgsql assertion di dalam BEGIN…ROLLBACK). Jalankan:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/ecer_prep_active_index.sql

BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  v_user_a uuid;
  v_user_b uuid;
  v_title_a uuid := gen_random_uuid();
  v_title_b uuid := gen_random_uuid();
  v_item    uuid := gen_random_uuid();
  v_count_a_active int;
  v_count_a_all    int;
  v_leaked         int;
  v_plan           text;
BEGIN
  -- Pinjam dua profile berbeda sebagai user_a / user_b tanpa membuat auth.users.
  SELECT id INTO v_user_a FROM public.profiles ORDER BY created_at LIMIT 1;
  SELECT id INTO v_user_b FROM public.profiles WHERE id <> v_user_a
                         ORDER BY created_at LIMIT 1;
  IF v_user_a IS NULL OR v_user_b IS NULL THEN
    RAISE EXCEPTION 'butuh minimal 2 profil di public.profiles untuk menjalankan test ini';
  END IF;

  -- Seed: 5 aktif + 3 terjual untuk user A, 4 aktif untuk user B.
  INSERT INTO public.ecer_preparations
    (user_id, title_id, warehouse_item_id, actual_grams, created_by, sold_at, created_at)
  SELECT v_user_a, v_title_a, v_item, 100, 'test', NULL,
         now() - (g || ' min')::interval
  FROM generate_series(1,5) g;
  INSERT INTO public.ecer_preparations
    (user_id, title_id, warehouse_item_id, actual_grams, created_by, sold_at, created_at)
  SELECT v_user_a, v_title_a, v_item, 100, 'test', now(),
         now() - (g || ' min')::interval
  FROM generate_series(6,8) g;
  INSERT INTO public.ecer_preparations
    (user_id, title_id, warehouse_item_id, actual_grams, created_by, sold_at, created_at)
  SELECT v_user_b, v_title_b, v_item, 100, 'test', NULL,
         now() - (g || ' min')::interval
  FROM generate_series(1,4) g;

  -- Refresh statistik agar planner melihat data segar dari transaksi ini.
  ANALYZE public.ecer_preparations;

  ---------------------------------------------------------------------------
  -- 1) KORREKTNESS
  ---------------------------------------------------------------------------
  SELECT count(*) INTO v_count_a_active
  FROM public.ecer_preparations
  WHERE user_id = v_user_a AND sold_at IS NULL;
  IF v_count_a_active <> 5 THEN
    RAISE EXCEPTION 'FAIL korrektness: aktif user_a harusnya 5, dapat %', v_count_a_active;
  END IF;

  SELECT count(*) INTO v_count_a_all
  FROM public.ecer_preparations
  WHERE user_id = v_user_a;
  IF v_count_a_all <> 8 THEN
    RAISE EXCEPTION 'FAIL korrektness: total user_a harusnya 8, dapat %', v_count_a_all;
  END IF;

  -- Tidak boleh ada baris user_b yang bocor ke query milik user_a.
  SELECT count(*) INTO v_leaked
  FROM public.ecer_preparations
  WHERE user_id = v_user_a AND sold_at IS NULL
    AND (title_id = v_title_b OR user_id = v_user_b);
  IF v_leaked <> 0 THEN
    RAISE EXCEPTION 'FAIL isolasi: data user_b bocor ke query user_a (%)', v_leaked;
  END IF;
  RAISE NOTICE 'PASS korrektness sold_at IS NULL per user';

  ---------------------------------------------------------------------------
  -- 2) PLAN PATH
  --    Paksa planner tidak pakai Seq Scan; kalau partial index utuh, planner
  --    HARUS bisa memilih salah satu partial index (per_user atau per_title).
  --    Kalau seseorang men-drop partial index, planner terpaksa index-scan
  --    generik dengan Filter (sold_at IS NULL) — string plan tidak akan
  --    menyebut partial index kita, test gagal.
  ---------------------------------------------------------------------------
  SET LOCAL enable_seqscan = off;

  -- Hot path A: daftar aktif per user, urut created_at DESC (paginate/LIMIT).
  EXECUTE format(
    'EXPLAIN (FORMAT TEXT) SELECT id FROM public.ecer_preparations '
    'WHERE user_id = %L AND sold_at IS NULL '
    'ORDER BY created_at DESC LIMIT 20',
    v_user_a
  ) INTO v_plan;
  IF position('idx_ecer_prep_active_per_user' IN v_plan) = 0 THEN
    RAISE EXCEPTION E'FAIL plan per_user: partial index tidak dipakai.\nPlan:\n%', v_plan;
  END IF;
  RAISE NOTICE 'PASS plan pakai idx_ecer_prep_active_per_user';

  -- Hot path B: daftar aktif per title (ReadyEcerSection).
  EXECUTE format(
    'EXPLAIN (FORMAT TEXT) SELECT id FROM public.ecer_preparations '
    'WHERE title_id = %L AND sold_at IS NULL '
    'ORDER BY created_at DESC LIMIT 20',
    v_title_a
  ) INTO v_plan;
  IF position('idx_ecer_prep_active_per_title' IN v_plan) = 0 THEN
    RAISE EXCEPTION E'FAIL plan per_title: partial index tidak dipakai.\nPlan:\n%', v_plan;
  END IF;
  RAISE NOTICE 'PASS plan pakai idx_ecer_prep_active_per_title';
END $$;

ROLLBACK;