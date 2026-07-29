CREATE OR REPLACE FUNCTION public.fix_request_prep_payment(
  _prep_id uuid,
  _payment_method text,
  _paid_amount numeric,
  _party_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prep public.request_preparations%ROWTYPE;
  v_total numeric;
  v_paid numeric;
  v_remaining numeric;
  v_debt public.debts%ROWTYPE;
  v_paid_rows numeric := 0;
  v_party text;
  v_debt_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tidak terautentikasi';
  END IF;
  IF _payment_method NOT IN ('kas','hutang') THEN
    RAISE EXCEPTION 'Metode bayar tidak valid (harus kas atau hutang)';
  END IF;

  SELECT * INTO v_prep FROM public.request_preparations
    WHERE id = _prep_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Penyiapan tidak ditemukan';
  END IF;
  IF v_prep.sold_at IS NULL THEN
    RAISE EXCEPTION 'Penyiapan belum terkirim — koreksi hanya untuk paket terkirim';
  END IF;

  v_total := COALESCE(v_prep.sold_total, 0);
  v_paid := GREATEST(COALESCE(_paid_amount, 0), 0);
  IF _payment_method = 'kas' THEN
    v_paid := v_total;
  END IF;
  IF v_paid > v_total THEN
    RAISE EXCEPTION 'Jumlah dibayar melebihi total (%).', v_total;
  END IF;
  v_remaining := ROUND(v_total - v_paid, 2);
  v_party := COALESCE(NULLIF(btrim(COALESCE(_party_name, '')), ''), v_prep.sold_party_name, 'Pelanggan');

  SELECT * INTO v_debt FROM public.debts
    WHERE user_id = v_uid AND source = 'request_prep' AND source_id = _prep_id
    ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid_rows
      FROM public.debt_payments WHERE debt_id = v_debt.id;
    IF v_paid_rows > 0 THEN
      RAISE EXCEPTION 'Piutang paket ini sudah punya riwayat cicilan (%). Koreksi lewat pembayaran piutang.', v_paid_rows;
    END IF;
  END IF;

  IF v_remaining > 0 THEN
    IF v_debt.id IS NOT NULL THEN
      UPDATE public.debts
        SET amount = v_remaining,
            party_name = v_party,
            customer_id = v_prep.sold_customer_id,
            note = COALESCE(note, '') 
        WHERE id = v_debt.id
        RETURNING id INTO v_debt_id;
    ELSE
      INSERT INTO public.debts(user_id, kind, party_name, customer_id, amount, note, source, source_id)
      VALUES (v_uid, 'piutang', v_party, v_prep.sold_customer_id, v_remaining,
              'Koreksi pencatatan penyiapan request', 'request_prep', _prep_id)
      RETURNING id INTO v_debt_id;
    END IF;
  ELSIF v_debt.id IS NOT NULL THEN
    DELETE FROM public.debts WHERE id = v_debt.id;
  END IF;

  UPDATE public.request_preparations
    SET sold_paid_amount = v_paid,
        sold_payment_method = _payment_method,
        sold_party_name = v_party
    WHERE id = _prep_id;

  RETURN jsonb_build_object(
    'prep_id', _prep_id,
    'total', v_total,
    'paid', v_paid,
    'remaining', v_remaining,
    'debt_id', v_debt_id,
    'payment_method', _payment_method
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fix_request_prep_payment(uuid, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fix_request_prep_payment(uuid, text, numeric, text) TO authenticated;