CREATE OR REPLACE FUNCTION public.unsend_request_prep_check(_prep_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_prep public.request_preparations%ROWTYPE;
  v_pay_count int := 0;
  v_pay_total numeric := 0;
  v_debt_count int := 0;
  v_debt_remaining numeric := 0;
  v_sales_count int := 0;
  v_sales_total numeric := 0;
  v_paid_cash numeric := 0;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Tidak terautentikasi'; END IF;

  SELECT * INTO v_prep FROM public.request_preparations
   WHERE id = _prep_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Penyiapan tidak ditemukan'; END IF;

  IF v_prep.sold_at IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','not_sent','label','Paket belum berstatus terkirim',
      'fix','Tidak ada yang perlu dibatalkan.'));
  END IF;

  SELECT COUNT(*), COALESCE(SUM(dp.amount),0) INTO v_pay_count, v_pay_total
    FROM public.debt_payments dp
    JOIN public.debts d ON d.id = dp.debt_id
   WHERE d.user_id = v_uid AND d.source = 'request_prep' AND d.source_id = _prep_id;

  SELECT COUNT(*), COALESCE(SUM(GREATEST(d.amount - COALESCE(d.paid_amount,0),0)),0)
    INTO v_debt_count, v_debt_remaining
    FROM public.debts d
   WHERE d.user_id = v_uid AND d.source = 'request_prep' AND d.source_id = _prep_id;

  SELECT COUNT(*), COALESCE(SUM(total_revenue),0) INTO v_sales_count, v_sales_total
    FROM public.sales
   WHERE user_id = v_uid AND source = 'request_prep' AND source_id = _prep_id;

  v_paid_cash := COALESCE(v_prep.sold_paid_amount, 0);

  IF v_pay_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','debt_paid',
      'label', v_pay_count || ' pembayaran piutang sudah tercatat (total ' || v_pay_total || ')',
      'fix','Hapus dulu pembayaran piutang paket ini di halaman Hutang & Piutang, lalu ulangi batal kirim.'));
  END IF;

  IF v_prep.sold_at IS NOT NULL AND v_paid_cash > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','cash_received',
      'label','Uang tunai sudah diterima pada paket ini (' || v_paid_cash || ')',
      'fix','Kembalikan uangnya lalu koreksi lewat "Perbaiki bayar" (set bayar 0) sebelum batal kirim.'));
  END IF;

  IF v_sales_count = 0 AND v_prep.sold_at IS NOT NULL THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code','no_sales_rows',
      'label','Tidak ada baris penjualan dari paket ini — stok tidak akan berubah saat dibatalkan'));
  END IF;

  IF v_debt_count = 0 AND v_prep.sold_at IS NOT NULL AND v_paid_cash = 0 THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code','no_debt_rows',
      'label','Tidak ada catatan piutang dari paket ini'));
  END IF;

  RETURN jsonb_build_object(
    'prep_id', _prep_id,
    'can_unsend', (jsonb_array_length(v_blockers) = 0),
    'blockers', v_blockers,
    'warnings', v_warnings,
    'details', jsonb_build_object(
      'payments_count', v_pay_count,
      'payments_total', v_pay_total,
      'debts_count', v_debt_count,
      'debt_remaining', v_debt_remaining,
      'sales_count', v_sales_count,
      'sales_total', v_sales_total,
      'cash_paid', v_paid_cash,
      'sold_total', COALESCE(v_prep.sold_total,0)
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.unsend_request_prep_check(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.unsend_request_prep(_prep_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_prep public.request_preparations%ROWTYPE;
  v_paid_count int := 0;
  v_paid_total numeric := 0;
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

  SELECT COUNT(*), COALESCE(SUM(dp.amount),0) INTO v_paid_count, v_paid_total
    FROM public.debt_payments dp
    JOIN public.debts d ON d.id = dp.debt_id
   WHERE d.user_id = v_uid AND d.source = 'request_prep' AND d.source_id = _prep_id;
  IF v_paid_count > 0 THEN
    RAISE EXCEPTION 'Tidak bisa dibatalkan: piutang paket ini sudah menerima % pembayaran (total %). Hapus pembayaran itu dulu di halaman Hutang & Piutang.', v_paid_count, v_paid_total;
  END IF;

  IF COALESCE(v_prep.sold_paid_amount,0) > 0 THEN
    RAISE EXCEPTION 'Tidak bisa dibatalkan: uang tunai % sudah tercatat diterima pada paket ini. Set bayar 0 lewat "Perbaiki bayar" dulu.', v_prep.sold_paid_amount;
  END IF;

  FOR s IN
    SELECT id, item_id, qty_base FROM public.sales
     WHERE user_id = v_uid AND source = 'request_prep' AND source_id = _prep_id
  LOOP
    DELETE FROM public.sales WHERE id = s.id;
    INSERT INTO public.request_preparation_items(preparation_id, user_id, warehouse_item_id, actual_grams)
      VALUES (_prep_id, v_uid, s.item_id, s.qty_base);
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
$function$;