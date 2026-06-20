ALTER TABLE public.ready_packages DROP CONSTRAINT IF EXISTS ready_packages_status_check;
ALTER TABLE public.ready_packages ADD CONSTRAINT ready_packages_status_check CHECK (status IN ('ready','sent','archived','cancelled','failed'));

CREATE OR REPLACE FUNCTION public.apply_ready_package()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  ELSIF TG_OP = 'UPDATE' THEN
    -- Restore stock when a previously-deducting status transitions to 'cancelled'
    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
      UPDATE public.warehouse_items
        SET stock_base = stock_base + OLD.qty_base, updated_at = now()
        WHERE id = OLD.warehouse_item_id AND user_id = OLD.user_id;
    -- Re-deduct if reverting from 'cancelled' back to any deducting status
    ELSIF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
      SELECT stock_base INTO v_stock FROM public.warehouse_items
        WHERE id = NEW.warehouse_item_id AND user_id = NEW.user_id FOR UPDATE;
      IF v_stock IS NULL THEN RAISE EXCEPTION 'Barang tidak ditemukan'; END IF;
      IF v_stock < NEW.qty_base THEN
        RAISE EXCEPTION 'Stok tidak cukup (tersedia %, diminta %)', v_stock, NEW.qty_base;
      END IF;
      UPDATE public.warehouse_items
        SET stock_base = v_stock - NEW.qty_base, updated_at = now()
        WHERE id = NEW.warehouse_item_id AND user_id = NEW.user_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('ready','sent','archived','failed') THEN
      UPDATE public.warehouse_items
        SET stock_base = stock_base + OLD.qty_base, updated_at = now()
        WHERE id = OLD.warehouse_item_id AND user_id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS ready_packages_apply ON public.ready_packages;
CREATE TRIGGER ready_packages_apply
  BEFORE INSERT OR UPDATE OR DELETE ON public.ready_packages
  FOR EACH ROW EXECUTE FUNCTION public.apply_ready_package();