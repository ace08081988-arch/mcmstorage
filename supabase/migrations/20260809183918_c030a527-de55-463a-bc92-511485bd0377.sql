-- Sprint 2 / Tahap 3 — penjaga stok & indeks (forward-only, tidak mengubah data)

-- 1) Penjaga stok tidak boleh negatif
CREATE OR REPLACE FUNCTION public.guard_warehouse_stock_non_negative()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.stock_base IS NOT NULL AND NEW.stock_base < 0 THEN
    RAISE EXCEPTION 'Stok tidak boleh minus (barang %, hasil %)', NEW.id, NEW.stock_base
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_warehouse_stock_non_negative() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_warehouse_stock_non_negative() TO service_role;

DROP TRIGGER IF EXISTS trg_warehouse_stock_non_negative ON public.warehouse_items;
CREATE TRIGGER trg_warehouse_stock_non_negative
  BEFORE INSERT OR UPDATE OF stock_base ON public.warehouse_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_warehouse_stock_non_negative();

-- 2) Indeks penelusuran sumber transaksi
CREATE INDEX IF NOT EXISTS idx_sales_user_source
  ON public.sales (user_id, source, source_id);
CREATE INDEX IF NOT EXISTS idx_debts_user_source
  ON public.debts (user_id, source, source_id);
CREATE INDEX IF NOT EXISTS idx_request_preparations_user_sold
  ON public.request_preparations (user_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_user_item
  ON public.purchases (user_id, item_id, created_at DESC);