-- Tambahkan harga jual satuan dasar untuk kebutuhan katalog & sorting
ALTER TABLE public.warehouse_items
  ADD COLUMN IF NOT EXISTS selling_price_per_base numeric DEFAULT NULL;

COMMENT ON COLUMN public.warehouse_items.selling_price_per_base IS 'Harga jual per satuan dasar (base_unit), opsional, untuk ditampilkan & diurutkan di katalog produk.';
