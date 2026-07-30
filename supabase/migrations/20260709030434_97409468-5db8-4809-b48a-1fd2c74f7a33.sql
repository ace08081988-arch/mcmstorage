-- C5: hardening race stok POS.
-- 1) Trigger apply_sale: baca stok dengan row-lock supaya dua insert paralel serialize.
CREATE OR REPLACE FUNCTION public.apply_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stock numeric;
  v_avg numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- FOR UPDATE mengunci baris warehouse_items sampai transaksi commit,
    -- sehingga insert sales konkuren untuk item yang sama diserialisasi.
    SELECT stock_base, avg_cost_per_base INTO v_stock, v_avg
      FROM warehouse_items
      WHERE id = NEW.item_id AND user_id = NEW.user_id
      FOR UPDATE;
    IF v_stock IS NULL THEN RAISE EXCEPTION 'Barang tidak ditemukan'; END IF;
    IF v_stock < NEW.qty_base THEN
      RAISE EXCEPTION 'Stok tidak cukup (tersedia %, diminta %)', v_stock, NEW.qty_base;
    END IF;
    NEW.total_revenue := NEW.qty_base * NEW.price_per_base;
    NEW.cost_at_sale := NEW.qty_base * v_avg;
    UPDATE warehouse_items
      SET stock_base = v_stock - NEW.qty_base, updated_at = now()
      WHERE id = NEW.item_id AND user_id = NEW.user_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE warehouse_items
      SET stock_base = stock_base + OLD.qty_base, updated_at = now()
      WHERE id = OLD.item_id AND user_id = OLD.user_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;

-- 2) RPC atomic untuk POS Kasir. Validasi kepemilikan + lock + insert dalam
--    satu transaksi. Trigger apply_sale tetap yang mengurangi stok (SSOT).
CREATE OR REPLACE FUNCTION public.pos_commit_sale(
  _item_id uuid,
  _qty_base numeric,
  _price_per_base numeric,
  _note text DEFAULT 'POS Kasir'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_stock numeric;
  v_sale_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tidak terautentikasi' USING ERRCODE = '42501';
  END IF;
  IF _qty_base IS NULL OR _qty_base <= 0 THEN
    RAISE EXCEPTION 'Kuantitas tidak valid' USING ERRCODE = '22023';
  END IF;
  IF _price_per_base IS NULL OR _price_per_base < 0 THEN
    RAISE EXCEPTION 'Harga tidak valid' USING ERRCODE = '22023';
  END IF;

  -- Row-lock: pastikan barang milik user + serialize akses konkuren.
  SELECT user_id, stock_base INTO v_owner, v_stock
    FROM public.warehouse_items
    WHERE id = _item_id
    FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Barang tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'Tidak berhak menjual barang ini' USING ERRCODE = '42501';
  END IF;
  IF v_stock < _qty_base THEN
    RAISE EXCEPTION 'Stok tidak cukup (tersedia %, diminta %)', v_stock, _qty_base
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.sales (
    user_id, item_id, qty_base, price_per_base,
    total_revenue, cost_at_sale, payment_method, note
  ) VALUES (
    v_uid, _item_id, _qty_base, _price_per_base,
    _qty_base * _price_per_base, 0, 'cash', COALESCE(_note, 'POS Kasir')
  ) RETURNING id INTO v_sale_id;

  RETURN v_sale_id;
END $function$;

REVOKE ALL ON FUNCTION public.pos_commit_sale(uuid, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_commit_sale(uuid, numeric, numeric, text) TO authenticated;