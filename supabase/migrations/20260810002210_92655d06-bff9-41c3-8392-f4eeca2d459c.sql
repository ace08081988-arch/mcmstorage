-- Sprint 5B: forward-only, no business data mutation.

-- 1) Least privilege: trigger function should not be PUBLIC-executable.
REVOKE ALL ON FUNCTION public.record_stock_ledger() FROM PUBLIC;

-- 2) Read-only admin reconciliation report.
CREATE OR REPLACE FUNCTION public.admin_reconcile_report_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_orphans jsonb;
  v_zero jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at'), '[]'::jsonb) INTO v_orphans
  FROM (
    SELECT jsonb_build_object(
      'preparation_id', rp.id,
      'created_at', rp.created_at,
      'title_id', rp.title_id,
      'title_name', rt.name,
      'sold_at', rp.sold_at,
      'sold_total', rp.sold_total,
      'sold_party_name', rp.sold_party_name,
      'item_rows', 0,
      'candidate_titles', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('title_id', t2.id, 'name', t2.name)), '[]'::jsonb)
        FROM public.request_titles t2
        WHERE t2.id = rp.title_id
      ),
      'reason', 'Rincian barang (request_preparation_items) tidak ada; sumber stok tidak dapat direkonstruksi.',
      'recoverable', false,
      'suggested_action', CASE
        WHEN coalesce(rp.sold_total, 0) = 0 THEN 'Tandai sebagai data uji / void manual'
        ELSE 'Verifikasi manual ke catatan penjualan; jangan backfill otomatis'
      END
    ) AS x
    FROM public.request_preparations rp
    LEFT JOIN public.request_titles rt ON rt.id = rp.title_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.request_preparation_items i WHERE i.preparation_id = rp.id
    )
  ) s;

  SELECT coalesce(jsonb_agg(y ORDER BY y->>'created_at'), '[]'::jsonb) INTO v_zero
  FROM (
    SELECT jsonb_build_object(
      'preparation_id', rp.id,
      'created_at', rp.created_at,
      'sold_total', coalesce(rp.sold_total, 0),
      'classification', 'data_uji',
      'note', 'Nilai nol tanpa rincian barang — ditandai data uji, tidak dibuatkan penjualan.'
    ) AS y
    FROM public.request_preparations rp
    WHERE coalesce(rp.sold_total, 0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM public.request_preparation_items i WHERE i.preparation_id = rp.id
      )
  ) z;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'read_only', true,
    'orphan_requests', v_orphans,
    'orphan_count', jsonb_array_length(v_orphans),
    'zero_value_test_data', v_zero,
    'zero_value_count', jsonb_array_length(v_zero)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reconcile_report_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_report_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_report_v1() TO service_role;

-- 3) Telemetry retention (90 hari). Dry-run default: hanya menghitung.
CREATE OR REPLACE FUNCTION public.telemetry_cleanup_v1(
  _days integer DEFAULT 90,
  _dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cutoff timestamptz;
  v_vitals bigint := 0;
  v_apk bigint := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _days < 7 THEN
    RAISE EXCEPTION 'retensi minimal 7 hari';
  END IF;
  v_cutoff := now() - make_interval(days => _days);

  SELECT count(*) INTO v_vitals FROM public.web_vital_samples WHERE created_at < v_cutoff;
  SELECT count(*) INTO v_apk FROM public.apk_download_events WHERE created_at < v_cutoff;

  IF NOT _dry_run THEN
    DELETE FROM public.web_vital_samples WHERE created_at < v_cutoff;
    DELETE FROM public.apk_download_events WHERE created_at < v_cutoff;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', _dry_run,
    'cutoff', v_cutoff,
    'web_vital_samples', v_vitals,
    'apk_download_events', v_apk
  );
END;
$$;

REVOKE ALL ON FUNCTION public.telemetry_cleanup_v1(integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.telemetry_cleanup_v1(integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.telemetry_cleanup_v1(integer, boolean) TO service_role;