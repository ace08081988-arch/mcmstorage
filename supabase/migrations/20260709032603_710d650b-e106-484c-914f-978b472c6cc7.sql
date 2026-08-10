-- H6: DB SSOT for "kartu terkirim" — sebelumnya di localStorage saja.
ALTER TABLE public.prep_submissions
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_channel text CHECK (sent_channel IN ('wa','chat')),
  ADD COLUMN IF NOT EXISTS sent_maps_url text;

CREATE INDEX IF NOT EXISTS prep_submissions_sent_at_idx
  ON public.prep_submissions (sent_at)
  WHERE sent_at IS NOT NULL;

-- RPC: batch mark submissions sent — user hanya boleh menandai submission
-- yang berada di prep_task miliknya (owner_user_id). SECURITY DEFINER
-- supaya RLS UPDATE tidak perlu dilonggarkan untuk seluruh row.
CREATE OR REPLACE FUNCTION public.prep_submissions_mark_sent(
  _ids uuid[],
  _channel text,
  _maps_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _channel NOT IN ('wa','chat') THEN RAISE EXCEPTION 'invalid_channel'; END IF;
  IF _ids IS NULL OR array_length(_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'updated', 0);
  END IF;

  UPDATE public.prep_submissions ps
     SET sent_at = COALESCE(ps.sent_at, now()),
         sent_channel = _channel,
         sent_maps_url = _maps_url
    FROM public.prep_tasks t
   WHERE ps.id = ANY(_ids)
     AND ps.task_id = t.id
     AND t.owner_user_id = v_uid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.prep_submissions_mark_sent(uuid[], text, text) TO authenticated;

-- Inverse: unmark (untuk tombol "Batal Kirim"/Hapus dari Riwayat).
CREATE OR REPLACE FUNCTION public.prep_submissions_unmark_sent(
  _ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _ids IS NULL OR array_length(_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'updated', 0);
  END IF;
  UPDATE public.prep_submissions ps
     SET sent_at = NULL,
         sent_channel = NULL,
         sent_maps_url = NULL
    FROM public.prep_tasks t
   WHERE ps.id = ANY(_ids)
     AND ps.task_id = t.id
     AND t.owner_user_id = v_uid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.prep_submissions_unmark_sent(uuid[]) TO authenticated;

-- H1: shared piutang summary — SSOT tunggal untuk Dashboard & halaman
-- piutang. Menggabungkan dua sumber yang selama ini paralel:
--   (a) sales.payment_method='hutang' dikurangi customer_payments
--   (b) debts.kind='piutang' dikurangi debt_payments
-- Filter user_id supaya RLS-friendly: dipanggil sebagai SECURITY INVOKER
-- alias caller-context; tidak butuh SECURITY DEFINER karena semua tabel
-- yang dibaca sudah ber-RLS.
CREATE OR REPLACE FUNCTION public.piutang_summary_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH
    hutang_sales AS (
      SELECT COALESCE(SUM(total_revenue), 0)::numeric AS v
      FROM public.sales
      WHERE user_id = auth.uid()
        AND payment_method = 'hutang'
    ),
    hutang_paid AS (
      SELECT COALESCE(SUM(amount), 0)::numeric AS v
      FROM public.customer_payments
      WHERE user_id = auth.uid()
    ),
    piutang_manual AS (
      SELECT COALESCE(SUM(amount), 0)::numeric AS v
      FROM public.debts
      WHERE user_id = auth.uid()
        AND kind = 'piutang'
    ),
    piutang_paid AS (
      SELECT COALESCE(SUM(dp.amount), 0)::numeric AS v
      FROM public.debt_payments dp
      JOIN public.debts d ON d.id = dp.debt_id
      WHERE dp.user_id = auth.uid()
        AND d.kind = 'piutang'
    )
  SELECT jsonb_build_object(
    'sales_hutang_gross', (SELECT v FROM hutang_sales),
    'sales_hutang_paid',  (SELECT v FROM hutang_paid),
    'manual_gross',       (SELECT v FROM piutang_manual),
    'manual_paid',        (SELECT v FROM piutang_paid),
    'total_outstanding',
      GREATEST((SELECT v FROM hutang_sales) - (SELECT v FROM hutang_paid), 0)
      + GREATEST((SELECT v FROM piutang_manual) - (SELECT v FROM piutang_paid), 0)
  );
$$;

GRANT EXECUTE ON FUNCTION public.piutang_summary_v1() TO authenticated;

-- H3: dokumentasikan trigger apply_sale sebagai SSOT cost_at_sale
COMMENT ON COLUMN public.sales.cost_at_sale IS
  'Diisi otomatis oleh trigger apply_sale (qty_base * avg_cost_per_base saat commit). Jangan set manual dari klien — akan ditimpa.';
COMMENT ON COLUMN public.sales.total_revenue IS
  'Diisi otomatis oleh trigger apply_sale (qty_base * price_per_base). Jangan set manual dari klien — akan ditimpa.';