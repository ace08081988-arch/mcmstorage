-- Helper/factory data untuk test skenario `request_*` + `prep_tasks`.
--
-- Tujuan: menyederhanakan setup owner / title / task / prep sehingga test
-- regresi (lintas via_task/PIN, lintas pegawai/owner) tidak perlu menulis
-- ulang boilerplate INSERT yang panjang.
--
-- Konvensi:
--   • Semua factory adalah SECURITY INVOKER, dibuat di schema `test_helper`.
--   • Dipanggil di dalam BEGIN…ROLLBACK milik test — factory TIDAK commit.
--   • Semua factory idempoten terhadap katalog (warehouse item) tetapi
--     selalu membuat baris baru untuk title/task/prep supaya skenario
--     independen.
--   • Setelah SET LOCAL search_path memasukkan `test_helper`, test bisa
--     memanggil `mk_*` tanpa prefix schema.
--
-- Cara pakai di file test:
--
--   BEGIN;
--   \i supabase/tests/helpers/request_prep_factories.sql
--   SET LOCAL search_path = test_helper, public, extensions;
--   DO $$
--   DECLARE
--     v_owner uuid := mk_owner();
--     v_title uuid := mk_title(v_owner, 'Paket A');
--     v_task  record := mk_task(v_owner, 'tok-A', '1234');
--   BEGIN
--     PERFORM mk_title_item(v_title, mk_warehouse_item(v_owner), 100);
--     PERFORM mk_prep(v_owner, v_title, v_task.id);   -- prep dari pegawai
--     -- assertion …
--   END $$;
--   ROLLBACK;

CREATE SCHEMA IF NOT EXISTS test_helper;

-- ---------- owner ----------
-- Ambil profil pertama sebagai owner default. Test yang butuh owner spesifik
-- (mis. skenario cross-owner) memanggil `mk_owner_other(existing)` untuk
-- profil selain `existing`, atau langsung menyodorkan UUID sendiri.
CREATE OR REPLACE FUNCTION test_helper.mk_owner()
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.profiles ORDER BY id LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'test_helper.mk_owner: butuh minimal 1 baris di public.profiles';
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION test_helper.mk_owner_other(existing uuid)
RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.profiles WHERE id <> existing ORDER BY id LIMIT 1;
$$;

-- ---------- katalog gudang ----------
-- Kembalikan warehouse_item milik owner. Jika belum ada, buat satu baru
-- sehingga skenario yang butuh isi title tidak gagal di lingkungan kosong.
CREATE OR REPLACE FUNCTION test_helper.mk_warehouse_item(
  p_owner uuid,
  p_name  text DEFAULT 'Test Item Factory'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.warehouse_items WHERE user_id = p_owner LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.warehouse_items(user_id, name, category, base_unit, stock_base)
    VALUES (p_owner, p_name, 'test', 'g', 0)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- ---------- title + items ----------
CREATE OR REPLACE FUNCTION test_helper.mk_title(
  p_owner uuid,
  p_name  text DEFAULT 'Paket Test',
  p_position int DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.request_titles(user_id, name, note, position)
  VALUES (p_owner, p_name, NULL, p_position)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION test_helper.mk_title_item(
  p_title uuid,
  p_item  uuid,
  p_grams numeric DEFAULT 100,
  p_unit  text    DEFAULT 'g',
  p_position int  DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.request_title_items(title_id, warehouse_item_id, target_grams, unit_label, position)
  VALUES (p_title, p_item, p_grams, p_unit, p_position)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------- prep_task (share_token + PIN) ----------
-- Kembalikan (id, token, pin) supaya test bisa memakai token+PIN saat
-- memanggil `public.request_list_titles_via_task(token, pin)` tanpa
-- menyimpan variabelnya sendiri.
CREATE TYPE test_helper.task_ref AS (id uuid, token text, pin text);

CREATE OR REPLACE FUNCTION test_helper.mk_task(
  p_owner uuid,
  p_token text DEFAULT NULL,
  p_pin   text DEFAULT NULL
) RETURNS test_helper.task_ref LANGUAGE plpgsql AS $$
DECLARE
  v_token text := COALESCE(p_token, 'tst-' || substr(md5(random()::text), 1, 10));
  v_pin   text := COALESCE(p_pin, lpad((floor(random() * 10000))::int::text, 4, '0'));
  v_id uuid;
BEGIN
  INSERT INTO public.prep_tasks(owner_user_id, share_token, pin_hash, status, expires_at)
  VALUES (
    p_owner,
    v_token,
    extensions.crypt(v_pin, extensions.gen_salt('bf')),
    'active',
    now() + interval '1 day'
  )
  RETURNING id INTO v_id;
  RETURN (v_id, v_token, v_pin)::test_helper.task_ref;
END $$;

-- ---------- request_preparations ----------
-- `p_via_task` NULL = prep tidak berasal dari share link (mis. dibuat admin
-- langsung). `p_created_at` NULL = default `now()` (transaction start);
-- test siklus reprep meneruskan `clock_timestamp()` supaya monotonik.
CREATE OR REPLACE FUNCTION test_helper.mk_prep(
  p_owner      uuid,
  p_title      uuid,
  p_via_task   uuid        DEFAULT NULL,
  p_created_by text        DEFAULT 'worker',
  p_created_at timestamptz DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.request_preparations(
    user_id, title_id, via_task_id, created_by, photo_paths, created_at
  )
  VALUES (
    p_owner, p_title, p_via_task, p_created_by, ARRAY[]::text[],
    COALESCE(p_created_at, now())
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------- helpers assertion ringkas ----------
-- Panggil RPC dan ambil elemen title untuk id tertentu (NULL bila tidak ada).
CREATE OR REPLACE FUNCTION test_helper.list_title_entry(
  p_token text, p_pin text, p_title uuid
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_res jsonb := public.request_list_titles_via_task(p_token, p_pin);
  v_match jsonb;
BEGIN
  IF (v_res->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'list_title_entry: RPC not ok: %', v_res;
  END IF;
  SELECT elem INTO v_match
  FROM jsonb_array_elements(v_res->'titles') elem
  WHERE elem->>'id' = p_title::text;
  RETURN v_match;   -- NULL berarti title tersembunyi
END $$;