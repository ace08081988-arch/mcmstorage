ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS source_id uuid;
CREATE INDEX IF NOT EXISTS idx_sales_source ON public.sales(user_id, source, source_id);

UPDATE public.sales s
   SET source = 'request_prep', source_id = rp.id
  FROM public.request_preparations rp
 WHERE s.source IS NULL
   AND rp.sold_at IS NOT NULL
   AND s.user_id = rp.user_id
   AND s.customer_id IS NOT DISTINCT FROM rp.sold_customer_id
   AND s.note = 'Penyiapan request: ' || rp.title_id::text
   AND s.created_at BETWEEN rp.sold_at - interval '10 seconds' AND rp.sold_at + interval '10 seconds';

CREATE OR REPLACE FUNCTION public.send_request_prep_to_customer(
  _prep_id uuid, _customer_id uuid, _party_name text, _total_amount numeric,
  _payment_method text, _note text, _paid_amount numeric DEFAULT NULL::numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
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
  v_paid numeric;
  v_sale_pm text;
  v_debt_amount numeric;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Tidak terautentikasi'; END IF;

  IF _payment_method NOT IN ('kas','hutang','partial') THEN
    RAISE EXCEPTION 'Metode bayar tidak valid (harus kas, hutang, atau partial)';
  END IF;
  IF _total_amount IS NULL OR _total_amount < 0 THEN RAISE EXCEPTION 'Total tidak valid'; END IF;
  IF _party_name IS NULL OR btrim(_party_name) = '' THEN RAISE EXCEPTION 'Nama pelanggan wajib diisi'; END IF;

  IF _payment_method = 'kas' THEN
    v_paid := _total_amount;
  ELSIF _payment_method = 'hutang' THEN
    v_paid := 0;
  ELSE
    IF _paid_amount IS NULL OR _paid_amount <= 0 OR _paid_amount >= _total_amount THEN
      RAISE EXCEPTION 'Jumlah dibayar tidak valid untuk bayar sebagian';
    END IF;
    v_paid := _paid_amount;
  END IF;
  v_debt_amount := _total_amount - v_paid;
  v_sale_pm := CASE WHEN v_debt_amount > 0 THEN 'hutang' ELSE 'kas' END;

  SELECT * INTO v_prep FROM public.request_preparations
    WHERE id = _prep_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Penyiapan tidak ditemukan'; END IF;
  IF v_prep.sold_at IS NOT NULL THEN RAISE EXCEPTION 'Penyiapan sudah dikirim ke pelanggan sebelumnya'; END IF;

  SELECT COALESCE(SUM(actual_grams), 0), COUNT(*) INTO v_total_qty, v_row_count
    FROM public.request_preparation_items WHERE preparation_id = _prep_id;
  IF v_row_count = 0 THEN RAISE EXCEPTION 'Penyiapan tidak memiliki item'; END IF;
  IF v_total_qty <= 0 THEN RAISE EXCEPTION 'Total kuantitas item tidak valid'; END IF;

  FOR it IN
    SELECT id, warehouse_item_id, actual_grams FROM public.request_preparation_items
      WHERE preparation_id = _prep_id ORDER BY id
  LOOP
    v_qty := it.actual_grams;
    v_alloc := ROUND((_total_amount * v_qty / v_total_qty)::numeric, 2);
    v_alloc_sum := v_alloc_sum + v_alloc;
    v_per_base := CASE WHEN v_qty > 0 THEN v_alloc / v_qty ELSE 0 END;

    DELETE FROM public.request_preparation_items WHERE id = it.id;

    INSERT INTO public.sales(
      user_id, item_id, qty_base, price_per_base, total_revenue,
      cost_at_sale, note, customer_id, payment_method, source, source_id
    ) VALUES (
      v_uid, it.warehouse_item_id, v_qty, v_per_base, v_alloc, 0,
      COALESCE(_note, 'Penyiapan request: ' || v_prep.title_id::text),
      _customer_id, v_sale_pm, 'request_prep', _prep_id
    );
  END LOOP;

  IF v_alloc_sum <> _total_amount AND v_row_count > 0 THEN
    UPDATE public.sales
      SET total_revenue = total_revenue + (_total_amount - v_alloc_sum),
          price_per_base = CASE WHEN qty_base > 0
            THEN (total_revenue + (_total_amount - v_alloc_sum)) / qty_base
            ELSE price_per_base END
      WHERE id = (
        SELECT id FROM public.sales
          WHERE user_id = v_uid AND source = 'request_prep' AND source_id = _prep_id
          ORDER BY created_at DESC LIMIT 1
      );
  END IF;

  IF v_debt_amount > 0 THEN
    INSERT INTO public.debts(
      user_id, kind, party_name, customer_id, amount, note, source, source_id
    ) VALUES (
      v_uid, 'piutang', _party_name, _customer_id, v_debt_amount,
      _note, 'request_prep', _prep_id
    ) RETURNING id INTO v_debt_id;
  END IF;

  UPDATE public.request_preparations
    SET sold_at = now(), sold_customer_id = _customer_id, sold_party_name = _party_name,
        sold_total = _total_amount, sold_paid_amount = v_paid, sold_payment_method = _payment_method
    WHERE id = _prep_id;

  RETURN _prep_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.unsend_request_prep(_prep_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid uuid;
  v_prep public.request_preparations%ROWTYPE;
  v_paid_count int := 0;
  v_sales_restored int := 0;
  v_debts_removed int := 0;
  s record;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Tidak terautentikasi'; END IF;

  SELECT * INTO v_prep FROM public.request_preparations
    WHERE id = _prep_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Penyiapan tidak ditemukan'; END IF;
  IF v_prep.sold_at IS NULL THEN RAISE EXCEPTION 'Penyiapan ini belum berstatus terkirim'; END IF;

  SELECT COUNT(*) INTO v_paid_count
    FROM public.debt_payments dp
    JOIN public.debts d ON d.id = dp.debt_id
   WHERE d.user_id = v_uid AND d.source = 'request_prep' AND d.source_id = _prep_id;
  IF v_paid_count > 0 THEN
    RAISE EXCEPTION 'Tidak bisa dibatalkan: piutang paket ini sudah menerima pembayaran. Hapus pembayaran itu dulu.';
  END IF;

  -- Kembalikan item penyiapan dari baris penjualan yang berasal dari paket ini.
  FOR s IN
    SELECT id, item_id, qty_base FROM public.sales
     WHERE user_id = v_uid AND source = 'request_prep' AND source_id = _prep_id
  LOOP
    DELETE FROM public.sales WHERE id = s.id;  -- trigger kembalikan stok
    INSERT INTO public.request_preparation_items(preparation_id, user_id, warehouse_item_id, actual_grams)
      VALUES (_prep_id, v_uid, s.item_id, s.qty_base);  -- trigger potong stok lagi
    v_sales_restored := v_sales_restored + 1;
  END LOOP;

  DELETE FROM public.debts
    WHERE user_id = v_uid AND source = 'request_prep' AND source_id = _prep_id;
  GET DIAGNOSTICS v_debts_removed = ROW_COUNT;

  UPDATE public.request_preparations
     SET sold_at = NULL, sold_customer_id = NULL, sold_party_name = NULL,
         sold_total = NULL, sold_paid_amount = NULL, sold_payment_method = NULL
   WHERE id = _prep_id;

  RETURN jsonb_build_object(
    'prep_id', _prep_id,
    'sales_reverted', v_sales_restored,
    'debts_removed', v_debts_removed
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.unsend_request_prep(uuid) TO authenticated;