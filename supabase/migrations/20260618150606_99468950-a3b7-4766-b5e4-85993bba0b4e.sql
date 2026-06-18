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
    SELECT stock_base, avg_cost_per_base INTO v_stock, v_avg
      FROM warehouse_items WHERE id = NEW.item_id AND user_id = NEW.user_id;
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
    UPDATE warehouse_items
      SET stock_base = stock_base - OLD.base_added,
          updated_at = now()
      WHERE id = OLD.item_id AND user_id = OLD.user_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.apply_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      WHERE id = NEW.item_id AND user_id = NEW.user_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE warehouse_items
      SET stock_base = stock_base + OLD.qty_base, updated_at = now()
      WHERE id = OLD.item_id AND user_id = OLD.user_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;