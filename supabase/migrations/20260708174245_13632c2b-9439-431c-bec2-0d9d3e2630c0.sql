-- Slice A: Chat foundation — kategori + linked business object references.
-- Additive-only, backward compatible. Default kategori 'customer' agar semua
-- percakapan lama tetap terlihat di UI list saat slice D dieksekusi.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS linked_customer_id uuid NULL,
  ADD COLUMN IF NOT EXISTS linked_request_prep_id uuid NULL,
  ADD COLUMN IF NOT EXISTS linked_ecer_prep_id uuid NULL,
  ADD COLUMN IF NOT EXISTS linked_task_id uuid NULL,
  ADD COLUMN IF NOT EXISTS linked_product_id uuid NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

-- Batasi kategori pada 4 nilai SSOT. Constraint validasi hanya nilai baru;
-- baris lama sudah default 'customer' sehingga tidak ada pelanggaran.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_category_check'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_category_check
      CHECK (category IN ('customer','employee','internal','archived'));
  END IF;
END$$;

-- Foreign keys: SET NULL agar penghapusan objek bisnis tidak menghapus chat.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_linked_customer_id_fkey') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_linked_customer_id_fkey
      FOREIGN KEY (linked_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_linked_request_prep_id_fkey') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_linked_request_prep_id_fkey
      FOREIGN KEY (linked_request_prep_id) REFERENCES public.request_preparations(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_linked_ecer_prep_id_fkey') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_linked_ecer_prep_id_fkey
      FOREIGN KEY (linked_ecer_prep_id) REFERENCES public.ecer_preparations(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_linked_task_id_fkey') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_linked_task_id_fkey
      FOREIGN KEY (linked_task_id) REFERENCES public.prep_tasks(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_linked_product_id_fkey') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_linked_product_id_fkey
      FOREIGN KEY (linked_product_id) REFERENCES public.warehouse_items(id) ON DELETE SET NULL;
  END IF;
END$$;

-- Index untuk lookup by kategori / linked object di list chat.
CREATE INDEX IF NOT EXISTS conversations_category_idx
  ON public.conversations(category)
  WHERE category <> 'archived';
CREATE INDEX IF NOT EXISTS conversations_linked_customer_idx
  ON public.conversations(linked_customer_id) WHERE linked_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversations_linked_request_prep_idx
  ON public.conversations(linked_request_prep_id) WHERE linked_request_prep_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversations_linked_ecer_prep_idx
  ON public.conversations(linked_ecer_prep_id) WHERE linked_ecer_prep_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversations_linked_task_idx
  ON public.conversations(linked_task_id) WHERE linked_task_id IS NOT NULL;

-- Tidak menyentuh RLS: kolom baru mengikuti policy yang sudah ada di
-- conversations (member-based access). Kolom baru bersifat metadata.