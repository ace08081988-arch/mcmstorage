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
    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
      UPDATE public.warehouse_items
        SET stock_base = stock_base + OLD.qty_base, updated_at = now()
        WHERE id = OLD.warehouse_item_id AND user_id = OLD.user_id;
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
    -- Stok hanya dikembalikan bila barang belum benar-benar keluar ke pembeli:
    --   ready  : masih di gudang, belum dikirim  -> kembalikan
    --   failed : gagal kirim, barang tidak jadi keluar -> kembalikan
    --   sent / archived : sudah dikirim (ada transaksi jual beli) -> JANGAN kembalikan
    --   cancelled       : stok sudah dikembalikan saat status berubah -> jangan dobel
    IF OLD.status IN ('ready', 'failed') THEN
      UPDATE public.warehouse_items
        SET stock_base = stock_base + OLD.qty_base, updated_at = now()
        WHERE id = OLD.warehouse_item_id AND user_id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;