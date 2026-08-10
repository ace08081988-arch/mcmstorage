-- SPRINT 5 — gap closure Critical/High (idempotensi submit pegawai,
-- ledger stok immutable, laporan rekonsiliasi read-only).
-- Semua statement ditulis idempotent (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS)
-- supaya aman dijalankan ulang.

-- =====================================================================
-- 1. Guard idempotensi submit portal pegawai
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.worker_submit_idempotency (
  task_id    uuid NOT NULL REFERENCES public.prep_tasks(id) ON DELETE CASCADE,
  client_key text NOT NULL,
  result     jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, client_key)
);

-- Hanya fungsi SECURITY DEFINER di bawah yang menyentuh tabel ini.
REVOKE ALL ON public.worker_submit_idempotency FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.worker_submit_idempotency TO service_role;
ALTER TABLE public.worker_submit_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "no direct access" ON public.worker_submit_idempotency;
CREATE POLICY "no direct access" ON public.worker_submit_idempotency
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS worker_submit_idem_created_idx
  ON public.worker_submit_idempotency (created_at);

-- =====================================================================
-- 2. Ledger stok append-only
--    Setiap perubahan stock_base tercatat sebagai baris delta. Pembalikan
--    (retur/hapus paket) menghasilkan baris delta positif baru, bukan
--    penghapusan baris lama.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.stock_ledger (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           uuid NOT NULL,
  warehouse_item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE CASCADE,
  delta_base        numeric NOT NULL,
  balance_after     numeric NOT NULL,
  reason            text NOT NULL DEFAULT 'stock_change',
  actor             uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.stock_ledger TO authenticated;
GRANT ALL    ON public.stock_ledger TO service_role;
ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner reads own ledger" ON public.stock_ledger;
CREATE POLICY "owner reads own ledger" ON public.stock_ledger
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS stock_ledger_item_idx
  ON public.stock_ledger (warehouse_item_id, id DESC);
CREATE INDEX IF NOT EXISTS stock_ledger_user_idx
  ON public.stock_ledger (user_id, created_at DESC);

-- Immutability: tidak ada UPDATE/DELETE, termasuk lewat service_role.
CREATE OR REPLACE FUNCTION public.stock_ledger_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_ledger bersifat append-only: % ditolak', TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS trg_stock_ledger_immutable ON public.stock_ledger;
CREATE TRIGGER trg_stock_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION public.stock_ledger_immutable();

-- Perekam: satu titik untuk SEMUA jalur (POS, purchase, ecer, ready package,
-- request prep, edit manual) karena semuanya berakhir di warehouse_items.
CREATE OR REPLACE FUNCTION public.record_stock_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_delta numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_delta := COALESCE(NEW.stock_base, 0);
    IF v_delta = 0 THEN RETURN NEW; END IF;
    INSERT INTO public.stock_ledger(user_id, warehouse_item_id, delta_base, balance_after, reason, actor)
    VALUES (NEW.user_id, NEW.id, v_delta, COALESCE(NEW.stock_base,0), 'opening_balance', auth.uid());
    RETURN NEW;
  END IF;

  v_delta := COALESCE(NEW.stock_base, 0) - COALESCE(OLD.stock_base, 0);
  IF v_delta = 0 THEN RETURN NEW; END IF;

  INSERT INTO public.stock_ledger(user_id, warehouse_item_id, delta_base, balance_after, reason, actor)
  VALUES (
    NEW.user_id, NEW.id, v_delta, COALESCE(NEW.stock_base,0),
    COALESCE(NULLIF(current_setting('app.stock_reason', true), ''), 'stock_change'),
    auth.uid()
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_record_stock_ledger ON public.warehouse_items;
CREATE TRIGGER trg_record_stock_ledger
  AFTER INSERT OR UPDATE OF stock_base ON public.warehouse_items
  FOR EACH ROW EXECUTE FUNCTION public.record_stock_ledger();

-- =====================================================================
-- 3. Laporan rekonsiliasi read-only (tanpa menulis apa pun)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.stock_reconcile_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH led AS (
    SELECT warehouse_item_id, sum(delta_base) AS ledger_sum, max(id) AS last_id
      FROM public.stock_ledger WHERE user_id = auth.uid()
     GROUP BY warehouse_item_id
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'items', COALESCE(jsonb_agg(jsonb_build_object(
        'warehouse_item_id', w.id,
        'name', w.name,
        'stock_base', w.stock_base,
        'ledger_sum', COALESCE(l.ledger_sum, 0),
        'diff', COALESCE(w.stock_base,0) - COALESCE(l.ledger_sum, 0),
        'last_ledger_id', l.last_id
      ) ORDER BY abs(COALESCE(w.stock_base,0) - COALESCE(l.ledger_sum,0)) DESC), '[]'::jsonb),
    'mismatch_count', count(*) FILTER (WHERE COALESCE(w.stock_base,0) <> COALESCE(l.ledger_sum,0))
  )
  FROM public.warehouse_items w
  LEFT JOIN led l ON l.warehouse_item_id = w.id
  WHERE w.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.stock_reconcile_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_reconcile_v1() TO authenticated, service_role;

