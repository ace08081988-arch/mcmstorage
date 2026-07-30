-- 1) Kolom penjualan di self_prep_items
ALTER TABLE public.self_prep_items
  ADD COLUMN IF NOT EXISTS sold_at timestamptz,
  ADD COLUMN IF NOT EXISTS sold_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_total numeric,
  ADD COLUMN IF NOT EXISTS sold_paid_amount numeric,
  ADD COLUMN IF NOT EXISTS sold_payment_method text,
  ADD COLUMN IF NOT EXISTS sold_debt_id uuid REFERENCES public.debts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_summary text;

-- Constraint metode bayar (hanya cek bila terisi)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'self_prep_items_sold_payment_method_check'
  ) THEN
    ALTER TABLE public.self_prep_items
      ADD CONSTRAINT self_prep_items_sold_payment_method_check
      CHECK (sold_payment_method IS NULL OR sold_payment_method IN ('kas','hutang','sebagian'));
  END IF;
END $$;

-- 2) Perluas source pada debts untuk mencakup 'self_prep'
ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_source_check;
ALTER TABLE public.debts
  ADD CONSTRAINT debts_source_check
  CHECK (source = ANY (ARRAY['manual','purchase','sale','request_prep','ecer_prep','self_prep']));

-- 3) Indeks bantu pencarian tugas sudah/belum terjual
CREATE INDEX IF NOT EXISTS self_prep_items_user_sold_idx
  ON public.self_prep_items (user_id, sold_at DESC NULLS LAST);
