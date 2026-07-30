
ALTER TABLE public.request_preparations
  ADD COLUMN IF NOT EXISTS sold_at timestamptz,
  ADD COLUMN IF NOT EXISTS sold_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_party_name text,
  ADD COLUMN IF NOT EXISTS sold_total numeric,
  ADD COLUMN IF NOT EXISTS sold_payment_method text;

CREATE INDEX IF NOT EXISTS idx_request_preparations_sold_at
  ON public.request_preparations(user_id, sold_at);

CREATE OR REPLACE FUNCTION public.send_request_prep_to_customer(
  _prep_id uuid,
  _customer_id uuid,
  _party_name text,
  _total_amount numeric,
  _payment_method text,
  _note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_prep public.request_preparations%ROWTYPE;
  v_total_qty numeric := 0;
  v_debt_id uuid;
  v_alloc_sum numeric := 0;
  v_row_count int := 0;
  it record;
  v_qty numeric;
  v_alloc numeric;
  v_per_base numeric;
  v_last_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tidak terautentikasi';
  END IF;

  IF _payment_method NOT IN ('kas', 'hutang') THEN
    RAISE EXCEPTION 'Metode bayar tidak valid (harus kas atau hutang)';
  END IF;
  IF _total_amount IS NULL OR _total_amount < 0 THEN
    RAISE EXCEPTION 'Total tidak valid';
  END IF;
  IF _party_name IS NULL OR btrim(_party_name) = '' THEN
    RAISE EXCEPTION 'Nama pelanggan wajib diisi';
  END IF;

  SELECT * INTO v_prep
    FROM public.request_preparations
    WHERE id = _prep_id AND user_id = v_uid
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Penyiapan tidak ditemukan';
  END IF;
  IF v_prep.sold_at IS NOT NULL THEN
    RAISE EXCEPTION 'Penyiapan sudah dikirim ke pelanggan sebelumnya';
  END IF;

  SELECT COALESCE(SUM(actual_grams), 0), COUNT(*)
    INTO v_total_qty, v_row_count
    FROM public.request_preparation_items
    WHERE preparation_id = _prep_id;

  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'Penyiapan tidak memiliki item';
  END IF;
  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Total kuantitas item tidak valid';
  END IF;

  -- Konversi tiap item: hapus (kembalikan stok) → catat sales (potong stok lagi + revenue).
  FOR it IN
    SELECT id, warehouse_item_id, actual_grams
      FROM public.request_preparation_items
      WHERE preparation_id = _prep_id
      ORDER BY id
  LOOP
    v_qty := it.actual_grams;
    v_alloc := ROUND((_total_amount * v_qty / v_total_qty)::numeric, 2);
    v_alloc_sum := v_alloc_sum + v_alloc;
    v_last_id := it.id;
    v_per_base := CASE WHEN v_qty > 0 THEN v_alloc / v_qty ELSE 0 END;

    -- Hapus item penyiapan → trigger apply_request_preparation_item kembalikan stok.
    DELETE FROM public.request_preparation_items WHERE id = it.id;

    -- Catat penjualan → trigger apply_sale potong stok & catat cost/revenue.
    INSERT INTO public.sales(
      user_id, item_id, qty_base, price_per_base, total_revenue,
      cost_at_sale, note, customer_id, payment_method
    ) VALUES (
      v_uid, it.warehouse_item_id, v_qty, v_per_base, v_alloc,
      0,
      COALESCE(_note, 'Penyiapan request: ' || v_prep.title_id::text),
      _customer_id,
      CASE WHEN _payment_method = 'kas' THEN 'kas' ELSE 'hutang' END
    );
  END LOOP;

  -- Sisa pembulatan (bila total >= 0,01 dan tidak sama persis) dialokasikan ke sale terakhir.
  IF v_alloc_sum <> _total_amount AND v_row_count > 0 THEN
    UPDATE public.sales
      SET total_revenue = total_revenue + (_total_amount - v_alloc_sum),
          price_per_base = CASE
            WHEN qty_base > 0
              THEN (total_revenue + (_total_amount - v_alloc_sum)) / qty_base
            ELSE price_per_base
          END
      WHERE id = (
        SELECT id FROM public.sales
          WHERE user_id = v_uid
            AND customer_id IS NOT DISTINCT FROM _customer_id
          ORDER BY created_at DESC
          LIMIT 1
      );
  END IF;

  -- Piutang bila hutang.
  IF _payment_method = 'hutang' AND _total_amount > 0 THEN
    INSERT INTO public.debts(
      user_id, kind, party_name, customer_id, amount, note, source, source_id
    ) VALUES (
      v_uid, 'piutang', _party_name, _customer_id, _total_amount,
      _note, 'request_prep', _prep_id
    ) RETURNING id INTO v_debt_id;
  END IF;

  -- Tandai penyiapan sudah terkirim.
  UPDATE public.request_preparations
    SET sold_at = now(),
        sold_customer_id = _customer_id,
        sold_party_name = _party_name,
        sold_total = _total_amount,
        sold_payment_method = _payment_method
    WHERE id = _prep_id;

  RETURN _prep_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_request_prep_to_customer(uuid, uuid, text, numeric, text, text) TO authenticated;
