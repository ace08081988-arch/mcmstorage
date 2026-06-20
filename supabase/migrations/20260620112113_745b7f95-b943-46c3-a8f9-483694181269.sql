
-- Ready-to-send packages per warehouse item
CREATE TABLE public.ready_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  warehouse_item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE CASCADE,
  qty_base numeric NOT NULL CHECK (qty_base > 0),
  photo_path text,
  location_url text,
  gps_lat double precision,
  gps_lng double precision,
  note text,
  price_per_base numeric,
  total_price numeric,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','sent','archived')),
  sent_at timestamptz,
  sent_to_name text,
  sent_to_phone text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ready_packages_user_item_idx ON public.ready_packages(user_id, warehouse_item_id, status);
CREATE INDEX ready_packages_user_status_idx ON public.ready_packages(user_id, status, sent_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ready_packages TO authenticated;
GRANT ALL ON public.ready_packages TO service_role;

ALTER TABLE public.ready_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their ready packages"
  ON public.ready_packages FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER ready_packages_set_updated_at
  BEFORE UPDATE ON public.ready_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Stock deduction on create; restoration only if deleted while still 'ready'
CREATE OR REPLACE FUNCTION public.apply_ready_package()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_stock numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT stock_base INTO v_stock FROM public.warehouse_items
      WHERE id = NEW.warehouse_item_id AND user_id = NEW.user_id FOR UPDATE;
    IF v_stock IS NULL THEN RAISE EXCEPTION 'Barang tidak ditemukan'; END IF;
    IF v_stock < NEW.qty_base THEN
      RAISE EXCEPTION 'Stok tidak cukup (tersedia %, diminta %)', v_stock, NEW.qty_base;
    END IF;
    UPDATE public.warehouse_items
      SET stock_base = v_stock - NEW.qty_base, updated_at = now()
      WHERE id = NEW.warehouse_item_id AND user_id = NEW.user_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'ready' THEN
      UPDATE public.warehouse_items
        SET stock_base = stock_base + OLD.qty_base, updated_at = now()
        WHERE id = OLD.warehouse_item_id AND user_id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER ready_packages_apply
  BEFORE INSERT OR DELETE ON public.ready_packages
  FOR EACH ROW EXECUTE FUNCTION public.apply_ready_package();

-- Storage policies for the ready-packages bucket (created via storage tool separately)
CREATE POLICY "Owners read their ready-package photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ready-packages' AND owner = auth.uid());

CREATE POLICY "Owners upload ready-package photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ready-packages' AND owner = auth.uid());

CREATE POLICY "Owners delete ready-package photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ready-packages' AND owner = auth.uid());
