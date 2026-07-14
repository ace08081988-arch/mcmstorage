-- Regresi: perhitungan "Selesai" pada `public.request_list_titles_via_task`
-- hanya boleh berdasarkan pasangan (title, owner) LINTAS `via_task_id`/PIN,
-- dan menghormati siklus penyiapan ulang (`request_titles.reprep_requested_at`).
--
-- Jalankan:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/request_list_titles_selesai_scope.sql
--
-- Semua data uji dibuat di dalam BEGIN…ROLLBACK sehingga tidak ada baris
-- yang tersisa di database. Setiap assertion memakai PERFORM + RAISE
-- EXCEPTION pada kegagalan; sukses mencetak PASS via RAISE NOTICE.

-- CATATAN WAKTU: `now()` fixed ke transaction start dalam satu transaksi,
-- sehingga tidak bisa dipakai untuk memesan urutan waktu antar-statement.
-- Test ini konsisten memakai `clock_timestamp()` untuk cutoff & created_at
-- prep siklus baru, dan `pg_sleep` untuk memastikan cutoff < prep baru.

BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  v_owner uuid;
  v_title uuid;
  v_item_wh uuid;
  v_task_a uuid; v_token_a text := 'tst-token-A-' || substr(md5(random()::text),1,8);
  v_task_b uuid; v_token_b text := 'tst-token-B-' || substr(md5(random()::text),1,8);
  v_pin_a text := '1234';
  v_pin_b text := '5678';
  v_prep_a uuid;
  v_prep_b uuid;
  v_res jsonb;
  v_titles jsonb;
  v_match jsonb;
  v_reprep_ts timestamptz;
BEGIN
  -- ---------- owner + katalog gudang ----------
  SELECT id INTO v_owner FROM public.profiles ORDER BY id LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'FAIL: butuh minimal 1 profil untuk menjalankan test';
  END IF;

  SELECT id INTO v_item_wh FROM public.warehouse_items WHERE user_id = v_owner LIMIT 1;
  IF v_item_wh IS NULL THEN
    INSERT INTO public.warehouse_items(user_id, name, category, base_unit, stock_base)
    VALUES (v_owner, 'Test Item Reprep', 'test', 'g', 0)
    RETURNING id INTO v_item_wh;
  END IF;

  -- ---------- title + isi ----------
  INSERT INTO public.request_titles(user_id, name, note, position)
  VALUES (v_owner, 'Paket Test Reprep', NULL, 0)
  RETURNING id INTO v_title;

  INSERT INTO public.request_title_items(title_id, warehouse_item_id, target_grams, unit_label, position)
  VALUES (v_title, v_item_wh, 100, 'g', 0);

  -- ---------- 2 task berbeda (token+PIN beda) milik owner yang sama ----------
  INSERT INTO public.prep_tasks(owner_user_id, share_token, pin_hash, status, expires_at)
  VALUES (v_owner, v_token_a, extensions.crypt(v_pin_a, extensions.gen_salt('bf')), 'active', now() + interval '1 day')
  RETURNING id INTO v_task_a;

  INSERT INTO public.prep_tasks(owner_user_id, share_token, pin_hash, status, expires_at)
  VALUES (v_owner, v_token_b, extensions.crypt(v_pin_b, extensions.gen_salt('bf')), 'active', now() + interval '1 day')
  RETURNING id INTO v_task_b;

  -- ================================================================
  -- Skenario 1: BELUM ada prep → title muncul di kedua task, submitted_count=0.
  -- ================================================================
  v_res := public.request_list_titles_via_task(v_token_b, v_pin_b);
  IF (v_res->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL S1: RPC token B tidak ok: %', v_res;
  END IF;
  v_titles := v_res->'titles';
  SELECT elem INTO v_match FROM jsonb_array_elements(v_titles) elem WHERE elem->>'id' = v_title::text;
  IF v_match IS NULL THEN
    RAISE EXCEPTION 'FAIL S1: title seharusnya muncul sebelum ada prep';
  END IF;
  IF (v_match->>'submitted_count')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL S1: submitted_count harus 0, dapat %', v_match->>'submitted_count';
  END IF;
  RAISE NOTICE 'PASS S1: sebelum ada prep, title tampil di task B dengan submitted_count=0';

  -- ================================================================
  -- Skenario 2: Pegawai LAIN (task A / PIN A) mengirim prep → title HARUS
  -- HILANG dari daftar task B (owner sama, task berbeda). Ini akar bug lama:
  -- dahulu filter memakai `via_task_id = task saat ini`, sehingga title
  -- masih ikut di task B.
  -- ================================================================
  INSERT INTO public.request_preparations(user_id, title_id, via_task_id, created_by, photo_paths)
  VALUES (v_owner, v_title, v_task_a, 'worker', ARRAY[]::text[])
  RETURNING id INTO v_prep_a;

  v_res := public.request_list_titles_via_task(v_token_b, v_pin_b);
  v_titles := v_res->'titles';
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_titles) elem WHERE elem->>'id' = v_title::text) THEN
    RAISE EXCEPTION 'FAIL S2: title BOCOR ke task B padahal sudah disiapkan lewat task A';
  END IF;
  RAISE NOTICE 'PASS S2: prep via task A menyembunyikan title dari task B (lintas via_task/PIN)';

  -- Sekaligus verifikasi: task A pun tidak lagi menampilkan title (aturan
  -- "1 title = 1 prep per siklus"). Ini menjaga simetri antar-task.
  v_res := public.request_list_titles_via_task(v_token_a, v_pin_a);
  v_titles := v_res->'titles';
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_titles) elem WHERE elem->>'id' = v_title::text) THEN
    RAISE EXCEPTION 'FAIL S2b: title masih muncul di task A padahal sudah disiapkan';
  END IF;
  RAISE NOTICE 'PASS S2b: title juga hilang dari task A setelah prep dikirim';

  -- ================================================================
  -- Skenario 3: Owner menekan "Minta penyiapan ulang" — set
  -- reprep_requested_at = now(). Title HARUS kembali muncul di task B
  -- dengan submitted_count=0, karena prep lama < cutoff.
  -- ================================================================
  -- Cutoff harus strictly > created_at prep lama. `now()` fixed per-xact,
  -- jadi pakai clock_timestamp() + jeda kecil supaya urutan monotonik.
  PERFORM pg_sleep(0.05);
  v_reprep_ts := clock_timestamp();
  UPDATE public.request_titles SET reprep_requested_at = v_reprep_ts WHERE id = v_title;

  v_res := public.request_list_titles_via_task(v_token_b, v_pin_b);
  v_titles := v_res->'titles';
  SELECT elem INTO v_match FROM jsonb_array_elements(v_titles) elem WHERE elem->>'id' = v_title::text;
  IF v_match IS NULL THEN
    RAISE EXCEPTION 'FAIL S3: title tidak muncul kembali setelah reprep_requested_at diisi';
  END IF;
  IF (v_match->>'submitted_count')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL S3: submitted_count harus 0 di siklus baru, dapat %', v_match->>'submitted_count';
  END IF;
  RAISE NOTICE 'PASS S3: reprep_requested_at memunculkan kembali title dengan siklus bersih';

  -- ================================================================
  -- Skenario 4: Prep BARU (created_at > reprep_requested_at) via task B
  -- kembali menyembunyikan title, tanpa terganggu prep lama.
  -- ================================================================
  -- created_at prep lama pakai default now() (= xact start) ⇒ < v_reprep_ts.
  -- created_at prep baru harus > v_reprep_ts; set eksplisit dari clock().
  PERFORM pg_sleep(0.05);
  INSERT INTO public.request_preparations(user_id, title_id, via_task_id, created_by, photo_paths, created_at)
  VALUES (v_owner, v_title, v_task_b, 'worker', ARRAY[]::text[], clock_timestamp())
  RETURNING id INTO v_prep_b;

  v_res := public.request_list_titles_via_task(v_token_b, v_pin_b);
  v_titles := v_res->'titles';
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_titles) elem WHERE elem->>'id' = v_title::text) THEN
    RAISE EXCEPTION 'FAIL S4: title masih muncul setelah prep siklus baru dikirim';
  END IF;
  RAISE NOTICE 'PASS S4: prep di siklus baru menutup kembali title (2 prep total, 1 aktif)';

  -- ================================================================
  -- Skenario 5: Prep milik OWNER LAIN untuk title berbeda TIDAK boleh
  -- mempengaruhi title milik owner ini — scope owner harus dihormati.
  -- (Sanity check: title kita masih tersembunyi karena prep sendiri,
  -- bukan karena bocoran cross-owner.)
  -- ================================================================
  DECLARE
    v_other uuid;
    v_other_title uuid;
  BEGIN
    SELECT id INTO v_other FROM public.profiles WHERE id <> v_owner ORDER BY id LIMIT 1;
    IF v_other IS NOT NULL THEN
      INSERT INTO public.request_titles(user_id, name, position)
      VALUES (v_other, 'Paket Test Reprep OTHER', 0)
      RETURNING id INTO v_other_title;
      INSERT INTO public.request_preparations(user_id, title_id, created_by, photo_paths)
      VALUES (v_other, v_other_title, 'admin', ARRAY[]::text[]);

      -- Bersihkan siklus title milik owner utama supaya bisa dilihat lagi
      -- (prep sendiri sudah 2, semua ≤ now; kita bersihkan agar test murni
      -- mengukur pengaruh cross-owner).
      DELETE FROM public.request_preparations WHERE title_id = v_title;
      UPDATE public.request_titles SET reprep_requested_at = NULL WHERE id = v_title;

      v_res := public.request_list_titles_via_task(v_token_b, v_pin_b);
      v_titles := v_res->'titles';
      SELECT elem INTO v_match FROM jsonb_array_elements(v_titles) elem WHERE elem->>'id' = v_title::text;
      IF v_match IS NULL THEN
        RAISE EXCEPTION 'FAIL S5: prep dari owner lain seharusnya tidak menyembunyikan title kita';
      END IF;
      IF (v_match->>'submitted_count')::int <> 0 THEN
        RAISE EXCEPTION 'FAIL S5: submitted_count bocor dari prep owner lain: %', v_match->>'submitted_count';
      END IF;
      RAISE NOTICE 'PASS S5: scope owner dihormati — prep owner lain tidak mempengaruhi hitungan';
    ELSE
      RAISE NOTICE 'SKIP S5: hanya ada 1 profil di DB, cross-owner tidak diuji';
    END IF;
  END;

  RAISE NOTICE 'ALL PASS: request_list_titles_via_task "Selesai" scope regression';
END $$;

ROLLBACK;