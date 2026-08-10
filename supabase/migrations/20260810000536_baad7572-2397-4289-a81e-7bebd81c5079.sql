-- Pembersihan fixture uji Sprint 5. Ledger stok bersifat append-only, jadi
-- pelindungnya dinonaktifkan hanya selama transaksi ini, terbatas pada satu
-- barang uji, lalu diaktifkan kembali. Idempotent: aman dijalankan ulang.
DO $cleanup$
DECLARE
  v_item uuid := '00000000-5555-4000-8000-000000000001';
BEGIN
  IF EXISTS (SELECT 1 FROM public.warehouse_items WHERE id = v_item AND name = 'ZZ-TEST-SPRINT5') THEN
    ALTER TABLE public.stock_ledger DISABLE TRIGGER trg_stock_ledger_immutable;
    DELETE FROM public.stock_ledger WHERE warehouse_item_id = v_item;
    DELETE FROM public.warehouse_items WHERE id = v_item AND name = 'ZZ-TEST-SPRINT5';
    ALTER TABLE public.stock_ledger ENABLE TRIGGER trg_stock_ledger_immutable;
  END IF;
END
$cleanup$;

-- Jaring pengaman: pastikan pelindung append-only kembali aktif apa pun yang terjadi.
ALTER TABLE public.stock_ledger ENABLE TRIGGER trg_stock_ledger_immutable;