
-- 1) Kolom sold_* di ecer_preparations
ALTER TABLE public.ecer_preparations
  ADD COLUMN IF NOT EXISTS sold_at timestamptz,
  ADD COLUMN IF NOT EXISTS sold_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_party_name text,
  ADD COLUMN IF NOT EXISTS sold_total numeric,
  ADD COLUMN IF NOT EXISTS sold_paid_amount numeric,
  ADD COLUMN IF NOT EXISTS sold_payment_method text,
  ADD COLUMN IF NOT EXISTS sold_note text;

CREATE INDEX IF NOT EXISTS idx_ecer_preparations_sold_at
  ON public.ecer_preparations(user_id, sold_at);

-- Tambah kolom paid_amount ke request_preparations juga
ALTER TABLE public.request_preparations
  ADD COLUMN IF NOT EXISTS sold_paid_amount numeric;

-- 2) Perluas debts.source untuk 'ecer_prep'
ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_source_check;
ALTER TABLE public.debts ADD CONSTRAINT debts_source_check
  CHECK (source = ANY (ARRAY['manual','purchase','sale','request_prep','ecer_prep']));

-- 3) Trigger apply_ecer_preparation: tambah branch UPDATE untuk kompensasi stok saat sold
CREATE OR REPLACE FUNCTION public.apply_ecer_preparation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_stock numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.actual_grams > 0 THEN
      SELECT stock_base INTO v_stock FROM public.warehouse_items
        WHERE id = NEW.warehouse_item_id AND user_id = NEW.user_id FOR UPDATE;
      IF v_stock IS NULL THEN RAISE EXCEPTION 'Barang tidak ditemukan'; END IF;
      IF v_stock < NEW.actual_grams THEN
        RAISE EXCEPTION 'Stok tidak cukup (tersedia %, diminta %)', v_stock, NEW.actual_grams;
      END IF;
      UPDATE public.warehouse_items
        SET stock_base = stock_base - NEW.actual_grams, updated_at = now()
        WHERE id = NEW.warehouse_item_id AND user_id = NEW.user_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Saat prep pindah ke Riwayat Terkirim, kembalikan stok agar sales insert
    -- (yang akan dilakukan oleh RPC) jadi satu-satunya pemotong stok. Net = 1x potong.
    IF OLD.sold_at IS NULL AND NEW.sold_at IS NOT NULL AND OLD.actual_grams > 0 THEN
      UPDATE public.warehouse_items
        SET stock_base = stock_base + OLD.actual_grams, updated_at = now()
        WHERE id = OLD.warehouse_item_id AND user_id = OLD.user_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Hanya kembalikan stok bila prep belum terkirim (untuk yang sold, stok sudah dihandle sales).
    IF OLD.actual_grams > 0 AND OLD.sold_at IS NULL THEN
      UPDATE public.warehouse_items
        SET stock_base = stock_base + OLD.actual_grams, updated_at = now()
        WHERE id = OLD.warehouse_item_id AND user_id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;

-- Pasang trigger untuk UPDATE juga
DROP TRIGGER IF EXISTS trg_apply_ecer_preparation ON public.ecer_preparations;
CREATE TRIGGER trg_apply_ecer_preparation
AFTER INSERT OR UPDATE OF sold_at OR DELETE ON public.ecer_preparations
FOR EACH ROW EXECUTE FUNCTION public.apply_ecer_preparation();

-- 4) RPC send_ecer_preps_to_customer (batch multi-kotak)
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

  -- Normalisasi paid
  IF _payment_method = 'kas' THEN
    v_paid := _total_amount;
  ELSIF _payment_method = 'hutang' THEN
    v_paid := 0;
  ELSE -- partial
    IF _paid_amount IS NULL OR _paid_amount <= 0 OR _paid_amount >= _total_amount THEN
      RAISE EXCEPTION 'Jumlah dibayar tidak valid untuk bayar sebagian';
    END IF;
    v_paid := _paid_amount;
  END IF;

  v_debt_amount := _total_amount - v_paid;
  v_sale_pm := CASE WHEN v_debt_amount > 0 THEN 'hutang' ELSE 'kas' END;

  -- Lock semua prep dan hitung total qty
  SELECT COALESCE(SUM(actual_grams), 0), COUNT(*)
    INTO v_total_qty, v_row_count
    FROM public.ecer_preparations
    WHERE id = ANY(_prep_ids) AND user_id = v_uid AND sold_at IS NULL
    FOR UPDATE;

  IF v_row_count <> array_length(_prep_ids, 1) THEN
    RAISE EXCEPTION 'Sebagian penyiapan tidak ditemukan atau sudah terkirim';
  END IF;
  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Total kuantitas tidak valid';
  END IF;

  v_first_prep := _prep_ids[1];

  -- Iterasi tiap prep: tandai sold (trigger kembalikan stok) + insert sales (potong stok lagi)
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

  -- Sisa pembulatan alokasikan ke sale terakhir
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

  -- Piutang: sisa yang belum dibayar
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

-- 5) Update send_request_prep_to_customer: dukung partial via _paid_amount
CREATE OR REPLACE FUNCTION public.send_request_prep_to_customer(
  _prep_id uuid,
  _customer_id uuid,
  _party_name text,
  _total_amount numeric,
  _payment_method text,
  _note text,
  _paid_amount numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tidak terautentikasi';
  END IF;

  IF _payment_method NOT IN ('kas','hutang','partial') THEN
    RAISE EXCEPTION 'Metode bayar tidak valid (harus kas, hutang, atau partial)';
  END IF;
  IF _total_amount IS NULL OR _total_amount < 0 THEN
    RAISE EXCEPTION 'Total tidak valid';
  END IF;
  IF _party_name IS NULL OR btrim(_party_name) = '' THEN
    RAISE EXCEPTION 'Nama pelanggan wajib diisi';
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

  FOR it IN
    SELECT id, warehouse_item_id, actual_grams
      FROM public.request_preparation_items
      WHERE preparation_id = _prep_id
      ORDER BY id
  LOOP
    v_qty := it.actual_grams;
    v_alloc := ROUND((_total_amount * v_qty / v_total_qty)::numeric, 2);
    v_alloc_sum := v_alloc_sum + v_alloc;
    v_per_base := CASE WHEN v_qty > 0 THEN v_alloc / v_qty ELSE 0 END;

    DELETE FROM public.request_preparation_items WHERE id = it.id;

    INSERT INTO public.sales(
      user_id, item_id, qty_base, price_per_base, total_revenue,
      cost_at_sale, note, customer_id, payment_method
    ) VALUES (
      v_uid, it.warehouse_item_id, v_qty, v_per_base, v_alloc,
      0,
      COALESCE(_note, 'Penyiapan request: ' || v_prep.title_id::text),
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
      _note, 'request_prep', _prep_id
    ) RETURNING id INTO v_debt_id;
  END IF;

  UPDATE public.request_preparations
    SET sold_at = now(),
        sold_customer_id = _customer_id,
        sold_party_name = _party_name,
        sold_total = _total_amount,
        sold_paid_amount = v_paid,
        sold_payment_method = _payment_method
    WHERE id = _prep_id;

  RETURN _prep_id;
END;
$function$;
