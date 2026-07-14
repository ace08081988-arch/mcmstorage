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

-- Muat factory data. File helper mendefinisikan schema `test_helper`
-- (mk_owner / mk_title / mk_task / mk_prep / list_title_entry) sehingga
-- setiap skenario tinggal memanggilnya tanpa boilerplate INSERT.
\i supabase/tests/helpers/request_prep_factories.sql
SET LOCAL search_path = test_helper, public, extensions;

DO $$
DECLARE
  v_owner uuid;
  v_title uuid;
  v_task_a test_helper.task_ref;
  v_task_b test_helper.task_ref;
  v_match jsonb;
  v_reprep_ts timestamptz;
BEGIN
  -- ---------- setup lewat factory ----------
  v_owner  := mk_owner();
  v_title  := mk_title(v_owner, 'Paket Test Reprep');
  PERFORM mk_title_item(v_title, mk_warehouse_item(v_owner, 'Test Item Reprep'), 100);
  -- 2 task berbeda (token+PIN beda) milik owner yang sama
  v_task_a := mk_task(v_owner, 'tst-token-A-' || substr(md5(random()::text),1,8), '1234');
  v_task_b := mk_task(v_owner, 'tst-token-B-' || substr(md5(random()::text),1,8), '5678');

  -- ================================================================
  -- Skenario 1: BELUM ada prep → title muncul di kedua task, submitted_count=0.
  -- ================================================================
  v_match := list_title_entry(v_task_b.token, v_task_b.pin, v_title);
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
  PERFORM mk_prep(v_owner, v_title, v_task_a.id);
  IF list_title_entry(v_task_b.token, v_task_b.pin, v_title) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL S2: title BOCOR ke task B padahal sudah disiapkan lewat task A';
  END IF;
  RAISE NOTICE 'PASS S2: prep via task A menyembunyikan title dari task B (lintas via_task/PIN)';

  -- Sekaligus verifikasi: task A pun tidak lagi menampilkan title (aturan
  -- "1 title = 1 prep per siklus"). Ini menjaga simetri antar-task.
  IF list_title_entry(v_task_a.token, v_task_a.pin, v_title) IS NOT NULL THEN
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

  v_match := list_title_entry(v_task_b.token, v_task_b.pin, v_title);
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
  PERFORM pg_sleep(0.05);
  PERFORM mk_prep(v_owner, v_title, v_task_b.id, 'worker', clock_timestamp());
  IF list_title_entry(v_task_b.token, v_task_b.pin, v_title) IS NOT NULL THEN
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
    v_other := mk_owner_other(v_owner);
    IF v_other IS NOT NULL THEN
      v_other_title := mk_title(v_other, 'Paket Test Reprep OTHER');
      PERFORM mk_prep(v_other, v_other_title, NULL, 'admin');

      -- Bersihkan siklus title milik owner utama supaya bisa dilihat lagi
      -- (prep sendiri sudah 2, semua ≤ now; kita bersihkan agar test murni
      -- mengukur pengaruh cross-owner).
      DELETE FROM public.request_preparations WHERE title_id = v_title;
      UPDATE public.request_titles SET reprep_requested_at = NULL WHERE id = v_title;

      v_match := list_title_entry(v_task_b.token, v_task_b.pin, v_title);
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

  -- ================================================================
  -- Skenario 6: Request untuk (title, owner) yang SAMA sudah pernah
  -- DIKIRIM KE ADMIN oleh pegawai lain (task A / PIN A). Pegawai kedua
  -- (task B / PIN B) membuka daftar → title HARUS terhitung "Selesai"
  -- (yakni: tersembunyi dari daftar task B) meski dikirim dari task+PIN
  -- yang berbeda. Skenario ini menegaskan scope (title, owner) LINTAS
  -- via_task/PIN untuk siklus yang sedang aktif — termasuk kasus umum
  -- di lapangan: satu pegawai sudah menyerahkan ke admin, pegawai lain
  -- membuka link-nya sendiri dan tidak boleh melihat title itu lagi.
  -- ================================================================
  -- Titik awal: setelah S5, prep title milik owner utama sudah dihapus
  -- dan reprep_requested_at = NULL. Kirim prep dari task A (pegawai lain,
  -- PIN berbeda) untuk mensimulasi "sudah dikirim ke admin dari pegawai lain".
  PERFORM mk_prep(v_owner, v_title, v_task_a.id);
  IF list_title_entry(v_task_b.token, v_task_b.pin, v_title) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL S6: title masih muncul di task B padahal pegawai lain (task A) sudah kirim ke admin';
  END IF;
  RAISE NOTICE 'PASS S6: prep pegawai lain (task A) tetap dihitung Selesai untuk task B (lintas PIN)';

  -- Sanity: task A yang mengirim pun sudah tidak menampilkan title
  -- (simetri dengan S2b) — memastikan tidak ada jalur task yang bocor.
  IF list_title_entry(v_task_a.token, v_task_a.pin, v_title) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL S6b: title masih muncul di task A setelah prep dikirim';
  END IF;
  RAISE NOTICE 'PASS S6b: title juga hilang dari task A (simetri lintas PIN)';

  RAISE NOTICE 'ALL PASS: request_list_titles_via_task "Selesai" scope regression';
END $$;

ROLLBACK;