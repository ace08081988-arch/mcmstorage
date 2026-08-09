-- =========================================================
-- Sprint 2 / Tahap 1 — forward-only, tidak mengubah data
-- =========================================================

-- 1) BUGFIX: unsend_request_prep_check merujuk debts.paid_amount (kolom tidak ada)
CREATE OR REPLACE FUNCTION public.unsend_request_prep_check(_prep_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_prep public.request_preparations%ROWTYPE;
  v_pay_count int := 0;
  v_pay_total numeric := 0;
  v_debt_count int := 0;
  v_debt_total numeric := 0;
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

  SELECT COUNT(*), COALESCE(SUM(d.amount),0)
    INTO v_debt_count, v_debt_total
    FROM public.debts d
   WHERE d.user_id = v_uid AND d.source = 'request_prep' AND d.source_id = _prep_id;

  v_debt_remaining := GREATEST(v_debt_total - v_pay_total, 0);

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
      'debts_total', v_debt_total,
      'debt_remaining', v_debt_remaining,
      'sales_count', v_sales_count,
      'sales_total', v_sales_total,
      'cash_paid', v_paid_cash,
      'sold_total', COALESCE(v_prep.sold_total,0)
    )
  );
END;
$function$;

-- 2) apply_purchase: kunci baris barang sebelum menghitung stok/HPP
CREATE OR REPLACE FUNCTION public.apply_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stock numeric;
  v_avg numeric;
  v_added numeric;
  v_cost numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_added := NEW.package_qty * NEW.package_size_snapshot;
    v_cost := NEW.package_qty * NEW.price_per_package;
    NEW.base_added := v_added;
    NEW.total_cost := v_cost;

    SELECT stock_base, COALESCE(avg_cost_per_base, 0) INTO v_stock, v_avg
      FROM warehouse_items
     WHERE id = NEW.item_id AND user_id = NEW.user_id
     FOR UPDATE;
    IF v_stock IS NULL THEN RAISE EXCEPTION 'Barang tidak ditemukan'; END IF;

    UPDATE warehouse_items
      SET stock_base = v_stock + v_added,
          avg_cost_per_base = CASE WHEN (v_stock + v_added) > 0
            THEN ((v_stock * v_avg) + v_cost) / (v_stock + v_added)
            ELSE 0 END,
          updated_at = now()
      WHERE id = NEW.item_id AND user_id = NEW.user_id;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM warehouse_items
      WHERE id = OLD.item_id AND user_id = OLD.user_id FOR UPDATE;
    UPDATE warehouse_items
      SET stock_base = stock_base - OLD.base_added,
          updated_at = now()
      WHERE id = OLD.item_id AND user_id = OLD.user_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;

-- 3) Cabut EXECUTE dari PUBLIC pada fungsi yang SUDAH punya grant eksplisit
--    (aman: peran aplikasi tetap memegang izinnya masing-masing)
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proacl IS NOT NULL
      AND EXISTS (SELECT 1 FROM unnest(p.proacl::text[]) a WHERE a LIKE '=X/%')
      AND EXISTS (
        SELECT 1 FROM unnest(p.proacl::text[]) a
        WHERE a LIKE 'anon=%' OR a LIKE 'authenticated=%' OR a LIKE 'service_role=%'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
  END LOOP;
END
$do$;

-- 4) Fungsi pemeliharaan internal: hanya service_role
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN (
        'query_metrics_prune',
        'email_queue_dispatch',
        'enqueue_email',
        'delete_email',
        'move_to_dlq',
        'expire_subscriptions',
        'get_email_cron_secret'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$do$;

-- 5) Laporan rekonsiliasi (READ-ONLY, tidak memperbaiki apa pun)
CREATE OR REPLACE FUNCTION public.request_prep_reconcile_report_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_rows jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Tidak terautentikasi'; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'sold_at' DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'prep_id', rp.id,
      'sold_at', rp.sold_at,
      'party_name', rp.sold_party_name,
      'sold_total', COALESCE(rp.sold_total, 0),
      'payment_method', rp.sold_payment_method,
      'sales_count', (SELECT count(*) FROM public.sales s
                       WHERE s.user_id = rp.user_id AND s.source = 'request_prep' AND s.source_id = rp.id),
      'debts_count', (SELECT count(*) FROM public.debts d
                       WHERE d.user_id = rp.user_id AND d.source = 'request_prep' AND d.source_id = rp.id),
      'items_left', (SELECT count(*) FROM public.request_preparation_items i
                       WHERE i.preparation_id = rp.id),
      'auto_fixable', false,
      'reason', CASE
        WHEN COALESCE(rp.sold_total, 0) = 0 THEN 'Total nol — kemungkinan paket uji, tidak perlu tindakan'
        ELSE 'Item penyiapan sudah terhapus, baris penjualan tidak dapat direkonstruksi otomatis'
      END
    ) AS x
    FROM public.request_preparations rp
    WHERE rp.user_id = v_uid
      AND rp.sold_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.sales s
         WHERE s.user_id = rp.user_id AND s.source = 'request_prep' AND s.source_id = rp.id
      )
  ) t;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'dry_run', true,
    'unlinked_count', jsonb_array_length(v_rows),
    'rows', v_rows
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.request_prep_reconcile_report_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_prep_reconcile_report_v1() TO authenticated, service_role;