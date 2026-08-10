
CREATE OR REPLACE FUNCTION public.send_ecer_preps_to_customer(
  _prep_ids uuid[],
  _customer_id uuid,
  _party_name text,
  _total_amount numeric,
  _paid_amount numeric,
  _payment_method text,
  _note text
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_total_qty numeric := 0;
  v_row_count int := 0;
  it record;
  v_alloc numeric;
  v_alloc_sum numeric := 0;
  v_per_base numeric;
  v_paid numeric;
  v_sale_pm text;
  v_debt_amount numeric;
  v_first_prep uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Tidak terautentikasi'; END IF;

  IF _payment_method NOT IN ('kas','hutang','partial') THEN
    RAISE EXCEPTION 'Metode bayar tidak valid';
  END IF;
  IF _total_amount IS NULL OR _total_amount < 0 THEN
    RAISE EXCEPTION 'Total tidak valid';
  END IF;
  IF _party_name IS NULL OR btrim(_party_name) = '' THEN
    RAISE EXCEPTION 'Nama pelanggan wajib diisi';
  END IF;
  IF _prep_ids IS NULL OR array_length(_prep_ids,1) IS NULL THEN
    RAISE EXCEPTION 'Tidak ada penyiapan yang dipilih';
  END IF;

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

  -- Lock baris dulu (tanpa aggregate) — FOR UPDATE tidak boleh dengan SUM/COUNT.
  PERFORM 1
    FROM public.ecer_preparations
    WHERE id = ANY(_prep_ids) AND user_id = v_uid AND sold_at IS NULL
    FOR UPDATE;

  -- Setelah baris terkunci, baru hitung agregat.
  SELECT COALESCE(SUM(actual_grams), 0), COUNT(*)
    INTO v_total_qty, v_row_count
    FROM public.ecer_preparations
    WHERE id = ANY(_prep_ids) AND user_id = v_uid AND sold_at IS NULL;

  IF v_row_count <> array_length(_prep_ids, 1) THEN
    RAISE EXCEPTION 'Sebagian penyiapan tidak ditemukan atau sudah terkirim';
  END IF;
  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Total kuantitas tidak valid';
  END IF;

  v_first_prep := _prep_ids[1];

  FOR it IN
    SELECT id, warehouse_item_id, actual_grams
      FROM public.ecer_preparations
      WHERE id = ANY(_prep_ids) AND user_id = v_uid
      ORDER BY id
  LOOP
    v_alloc := ROUND((_total_amount * it.actual_grams / v_total_qty)::numeric, 2);
    v_alloc_sum := v_alloc_sum + v_alloc;
    v_per_base := CASE WHEN it.actual_grams > 0 THEN v_alloc / it.actual_grams ELSE 0 END;

    UPDATE public.ecer_preparations
      SET sold_at = now(),
          sold_customer_id = _customer_id,
          sold_party_name = _party_name,
          sold_total = v_alloc,
          sold_paid_amount = CASE WHEN _total_amount > 0 THEN ROUND((v_paid * v_alloc / _total_amount)::numeric, 2) ELSE 0 END,
          sold_payment_method = _payment_method,
          sold_note = _note
      WHERE id = it.id;

    INSERT INTO public.sales(
      user_id, item_id, qty_base, price_per_base, total_revenue,
      cost_at_sale, note, customer_id, payment_method
    ) VALUES (
      v_uid, it.warehouse_item_id, it.actual_grams, v_per_base, v_alloc,
      0,
      COALESCE(_note, 'Kirim ecer batch'),
      _customer_id,
      v_sale_pm
    );
  END LOOP;

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

  IF v_debt_amount > 0 THEN
    INSERT INTO public.debts(
      user_id, kind, party_name, customer_id, amount, note, source, source_id
    ) VALUES (
      v_uid, 'piutang', _party_name, _customer_id, v_debt_amount,
      COALESCE(_note, 'Sisa dari kirim ecer batch'),
      'ecer_prep', v_first_prep
    );
  END IF;

  RETURN _prep_ids;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.send_ecer_preps_to_customer(uuid[], uuid, text, numeric, numeric, text, text) TO authenticated;
