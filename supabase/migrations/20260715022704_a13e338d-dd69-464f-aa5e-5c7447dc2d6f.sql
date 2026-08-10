-- Atomic rename kategori: update warehouse_categories + kaskade ke warehouse_items dalam satu transaksi,
-- dengan collision check case-insensitive. RLS tetap berlaku (SECURITY INVOKER default).
CREATE OR REPLACE FUNCTION public.rename_warehouse_category(
  _old_name text,
  _new_name text
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new text := btrim(regexp_replace(_new_name, '\s+', ' ', 'g'));
  v_old text := _old_name;
  v_norm_new text := lower(v_new);
  v_renamed integer := 0;
  v_exists boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tidak ada sesi pengguna' USING ERRCODE = '42501';
  END IF;
  IF v_new = '' THEN
    RAISE EXCEPTION 'Nama kategori tidak boleh kosong' USING ERRCODE = '22023';
  END IF;

  -- Pastikan kategori lama benar milik user (RLS memaksa, tapi kita ingin pesan jelas).
  SELECT EXISTS (
    SELECT 1 FROM public.warehouse_categories
    WHERE user_id = v_uid AND name = v_old
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'Kategori "%" tidak ditemukan', v_old USING ERRCODE = 'P0002';
  END IF;

  -- Collision case-insensitive terhadap kategori lain (izinkan case-only rename).
  SELECT EXISTS (
    SELECT 1 FROM public.warehouse_categories
    WHERE user_id = v_uid
      AND lower(btrim(name)) = v_norm_new
      AND name <> v_old
  ) INTO v_exists;
  IF v_exists THEN
    RAISE EXCEPTION 'Kategori "%" sudah ada', v_new USING ERRCODE = '23505';
  END IF;

  UPDATE public.warehouse_categories
     SET name = v_new
   WHERE user_id = v_uid AND name = v_old;

  UPDATE public.warehouse_items
     SET category = v_new
   WHERE user_id = v_uid AND category ILIKE v_old;
  GET DIAGNOSTICS v_renamed = ROW_COUNT;

  RETURN v_renamed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_warehouse_category(text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rename_warehouse_category(text, text) FROM anon, public;