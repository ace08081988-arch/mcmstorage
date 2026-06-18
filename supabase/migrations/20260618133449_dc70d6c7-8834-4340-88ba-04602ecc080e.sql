
-- Suppliers
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own suppliers" ON public.suppliers FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Warehouse items
CREATE TABLE public.warehouse_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  package_type text NOT NULL CHECK (package_type IN ('gram','pcs','botol','sachet')),
  package_size numeric NOT NULL DEFAULT 1 CHECK (package_size > 0),
  base_unit text NOT NULL CHECK (base_unit IN ('g','pcs')),
  stock_base numeric NOT NULL DEFAULT 0,
  avg_cost_per_base numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_items TO authenticated;
GRANT ALL ON public.warehouse_items TO service_role;
ALTER TABLE public.warehouse_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own warehouse_items" ON public.warehouse_items FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Purchases
CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE CASCADE,
  package_qty numeric NOT NULL CHECK (package_qty > 0),
  package_size_snapshot numeric NOT NULL CHECK (package_size_snapshot > 0),
  base_added numeric NOT NULL,
  price_per_package numeric NOT NULL CHECK (price_per_package >= 0),
  total_cost numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own purchases" ON public.purchases FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Sales
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE CASCADE,
  qty_base numeric NOT NULL CHECK (qty_base > 0),
  price_per_base numeric NOT NULL CHECK (price_per_base >= 0),
  total_revenue numeric NOT NULL,
  cost_at_sale numeric NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sales" ON public.sales FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at triggers
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_warehouse_items_updated BEFORE UPDATE ON public.warehouse_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Purchase trigger: recompute stock & avg cost
CREATE OR REPLACE FUNCTION public.apply_purchase()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    SELECT stock_base, avg_cost_per_base INTO v_stock, v_avg
      FROM warehouse_items WHERE id = NEW.item_id AND user_id = NEW.user_id;
    IF v_stock IS NULL THEN RAISE EXCEPTION 'Barang tidak ditemukan'; END IF;
    UPDATE warehouse_items
      SET stock_base = v_stock + v_added,
          avg_cost_per_base = CASE WHEN (v_stock + v_added) > 0
            THEN ((v_stock * v_avg) + v_cost) / (v_stock + v_added)
            ELSE 0 END,
          updated_at = now()
      WHERE id = NEW.item_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE warehouse_items
      SET stock_base = stock_base - OLD.base_added,
          updated_at = now()
      WHERE id = OLD.item_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_apply_purchase
  BEFORE INSERT OR DELETE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.apply_purchase();

-- Sale trigger: reduce stock
CREATE OR REPLACE FUNCTION public.apply_sale()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock numeric;
  v_avg numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT stock_base, avg_cost_per_base INTO v_stock, v_avg
      FROM warehouse_items WHERE id = NEW.item_id AND user_id = NEW.user_id;
    IF v_stock IS NULL THEN RAISE EXCEPTION 'Barang tidak ditemukan'; END IF;
    IF v_stock < NEW.qty_base THEN
      RAISE EXCEPTION 'Stok tidak cukup (tersedia %, diminta %)', v_stock, NEW.qty_base;
    END IF;
    NEW.total_revenue := NEW.qty_base * NEW.price_per_base;
    NEW.cost_at_sale := NEW.qty_base * v_avg;
    UPDATE warehouse_items
      SET stock_base = v_stock - NEW.qty_base, updated_at = now()
      WHERE id = NEW.item_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE warehouse_items
      SET stock_base = stock_base + OLD.qty_base, updated_at = now()
      WHERE id = OLD.item_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_apply_sale
  BEFORE INSERT OR DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.apply_sale();

CREATE INDEX idx_purchases_user ON public.purchases(user_id, created_at DESC);
CREATE INDEX idx_sales_user ON public.sales(user_id, created_at DESC);
CREATE INDEX idx_warehouse_user ON public.warehouse_items(user_id);
CREATE INDEX idx_suppliers_user ON public.suppliers(user_id);
