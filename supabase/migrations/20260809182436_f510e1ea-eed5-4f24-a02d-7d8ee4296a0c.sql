-- 1) Blokir reopen pesanan yang sudah selesai (kecuali dihapus).
CREATE OR REPLACE FUNCTION public.order_requests_block_reopen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'selesai' AND NEW.status IS DISTINCT FROM 'selesai' THEN
    RAISE EXCEPTION 'Pesanan sudah selesai dan tidak bisa dibuka ulang'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_order_requests_block_reopen ON public.order_requests;
CREATE TRIGGER trg_order_requests_block_reopen
  BEFORE UPDATE ON public.order_requests
  FOR EACH ROW EXECUTE FUNCTION public.order_requests_block_reopen();

-- 2) Idempotency: satu pesanan hanya boleh punya satu sale.
CREATE UNIQUE INDEX IF NOT EXISTS sales_order_request_unique
  ON public.sales (source_id)
  WHERE source = 'order_request';

-- 3) RPC atomik proses pesanan.
CREATE OR REPLACE FUNCTION public.order_process_v1(
  _order_id uuid,
  _payment_method text,
  _paid_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ord public.order_requests%ROWTYPE;
  v_item public.warehouse_items%ROWTYPE;
  v_qty_base numeric;
  v_per_base numeric;
  v_total numeric;
  v_paid numeric;
  v_sale_id uuid;
  v_existing uuid;
  v_party text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tidak terautentikasi' USING ERRCODE = '42501';
  END IF;
  IF _payment_method IS NULL OR _payment_method NOT IN ('kas','partial','hutang') THEN
    RAISE EXCEPTION 'Metode pembayaran wajib dipilih (kas/partial/hutang)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ord FROM public.order_requests WHERE id = _order_id FOR UPDATE;
  IF v_ord.id IS NULL THEN
    RAISE EXCEPTION 'Pesanan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_ord.user_id <> v_uid THEN
    RAISE EXCEPTION 'Tidak berhak memproses pesanan ini' USING ERRCODE = '42501';
  END IF;

  -- Idempotent: kalau sale-nya sudah ada, kembalikan hasil lama.
  SELECT id INTO v_existing FROM public.sales
    WHERE source = 'order_request' AND source_id = _order_id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('status','already_processed','sale_id',v_existing,'order_id',_order_id);
  END IF;

  IF v_ord.status = 'selesai' THEN
    RAISE EXCEPTION 'Pesanan sudah selesai' USING ERRCODE = '23514';
  END IF;
  IF v_ord.status NOT IN ('menunggu','siap') THEN
    RAISE EXCEPTION 'Status pesanan tidak bisa diproses (%).', v_ord.status USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_item FROM public.warehouse_items WHERE id = v_ord.item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Barang tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.user_id <> v_uid THEN
    RAISE EXCEPTION 'Barang bukan milik Anda' USING ERRCODE = '42501';
  END IF;

  v_qty_base := CASE WHEN v_ord.qty_mode = 'base'
    THEN v_ord.qty ELSE v_ord.qty * v_item.package_size END;
  IF v_qty_base IS NULL OR v_qty_base <= 0 THEN
    RAISE EXCEPTION 'Jumlah pesanan tidak valid' USING ERRCODE = '22023';
  END IF;
  IF v_item.stock_base < v_qty_base THEN
    RAISE EXCEPTION 'Stok tidak cukup (tersedia %, diminta %)', v_item.stock_base, v_qty_base
      USING ERRCODE = '23514';
  END IF;

  v_per_base := COALESCE(
    CASE WHEN v_ord.qty_mode = 'base' THEN v_ord.price_per_unit
         ELSE v_ord.price_per_unit / NULLIF(v_item.package_size,0) END, 0);
  v_total := v_qty_base * v_per_base;

  v_paid := CASE
    WHEN _payment_method = 'kas' THEN v_total
    WHEN _payment_method = 'hutang' THEN 0
    ELSE COALESCE(_paid_amount, -1)
  END;
  IF _payment_method = 'partial' AND (v_paid <= 0 OR v_paid >= v_total) THEN
    RAISE EXCEPTION 'Jumlah bayar sebagian harus lebih dari 0 dan kurang dari total' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sales (
    user_id, item_id, qty_base, price_per_base, total_revenue,
    note, customer_id, payment_method, source, source_id
  ) VALUES (
    v_uid, v_item.id, v_qty_base, v_per_base, 0,
    'Pesanan: ' || COALESCE(v_ord.note, '-'), v_ord.customer_id,
    _payment_method, 'order_request', _order_id
  ) RETURNING id INTO v_sale_id;

  IF v_ord.customer_id IS NOT NULL THEN
    SELECT name INTO v_party FROM public.customers WHERE id = v_ord.customer_id;
    IF v_paid > 0 THEN
      INSERT INTO public.customer_payments (user_id, customer_id, sale_id, amount, note)
      VALUES (v_uid, v_ord.customer_id, v_sale_id, v_paid, 'Pembayaran pesanan');
    END IF;
    IF v_total - v_paid > 0 THEN
      INSERT INTO public.debts (user_id, kind, party_name, customer_id, amount, note, source, source_id)
      VALUES (v_uid, 'piutang', COALESCE(v_party,'Pelanggan'), v_ord.customer_id,
              v_total - v_paid, 'Sisa pesanan', 'order_request', _order_id);
    END IF;
  END IF;

  INSERT INTO public.order_request_events (order_id, user_id, from_status, to_status, note)
  VALUES (_order_id, v_uid, v_ord.status, 'selesai', 'Diproses jadi penjualan');

  UPDATE public.order_requests SET status = 'selesai', updated_at = now() WHERE id = _order_id;

  RETURN jsonb_build_object(
    'status','processed','sale_id',v_sale_id,'order_id',_order_id,
    'total',v_total,'paid',v_paid,'qty_base',v_qty_base);
END $$;

REVOKE ALL ON FUNCTION public.order_process_v1(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_process_v1(uuid, text, numeric) TO authenticated;

-- 4) RPC atomik simpan judul request + itemnya.
CREATE OR REPLACE FUNCTION public.request_title_save_v1(
  _title_id uuid,
  _name text,
  _note text,
  _position integer,
  _items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := _title_id;
  v_owner uuid;
  v_count integer;
  v_bad integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tidak terautentikasi' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR btrim(_name) = '' THEN
    RAISE EXCEPTION 'Nama judul wajib diisi' USING ERRCODE = '22023';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'Daftar barang tidak valid' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_count FROM jsonb_array_elements(_items);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Judul harus punya minimal satu barang' USING ERRCODE = '22023';
  END IF;

  -- Validasi seluruh daftar dulu: semua barang harus milik user.
  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(_items) e
  LEFT JOIN public.warehouse_items w
    ON w.id = (e->>'warehouse_item_id')::uuid AND w.user_id = v_uid
  WHERE w.id IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Ada barang yang tidak ditemukan atau bukan milik Anda' USING ERRCODE = '42501';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.request_titles (user_id, name, note, position)
    VALUES (v_uid, btrim(_name), NULLIF(btrim(COALESCE(_note,'')),''), COALESCE(_position,0))
    RETURNING id INTO v_id;
  ELSE
    SELECT user_id INTO v_owner FROM public.request_titles WHERE id = v_id FOR UPDATE;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'Judul tidak ditemukan' USING ERRCODE = 'P0002';
    END IF;
    IF v_owner <> v_uid THEN
      RAISE EXCEPTION 'Judul bukan milik Anda' USING ERRCODE = '42501';
    END IF;
    UPDATE public.request_titles
      SET name = btrim(_name),
          note = NULLIF(btrim(COALESCE(_note,'')),''),
          position = COALESCE(_position, position),
          updated_at = now()
      WHERE id = v_id;
    DELETE FROM public.request_title_items WHERE title_id = v_id;
  END IF;

  INSERT INTO public.request_title_items
    (title_id, warehouse_item_id, target_grams, unit_label, note, position)
  SELECT v_id,
         (e->>'warehouse_item_id')::uuid,
         COALESCE((e->>'target_grams')::numeric, 0),
         COALESCE(NULLIF(e->>'unit_label',''), 'gram'),
         NULLIF(e->>'note',''),
         COALESCE((e->>'position')::int, (ord - 1)::int)
  FROM jsonb_array_elements(_items) WITH ORDINALITY AS t(e, ord);

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.request_title_save_v1(uuid, text, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_title_save_v1(uuid, text, text, integer, jsonb) TO authenticated;