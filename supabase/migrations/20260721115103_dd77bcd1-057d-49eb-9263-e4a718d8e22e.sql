-- Partial index untuk hot-path "prep aktif per user".
-- Ukurannya proporsional terhadap jumlah prep AKTIF (bukan total riwayat),
-- sehingga tetap kecil dan cepat ketika `sales`/prep-history tumbuh besar.
--
-- Catatan: FOR UPDATE lock di send_ecer_preps_to_customer memakai
-- `WHERE id = ANY(_prep_ids)` → tetap dilayani pkey (bukan index ini).
-- Index ini menargetkan query list "WHERE user_id=? AND sold_at IS NULL
-- ORDER BY created_at DESC" yang dipakai ReadyEcerSection dan halaman /ecer.
CREATE INDEX IF NOT EXISTS idx_ecer_prep_active_per_user
  ON public.ecer_preparations (user_id, created_at DESC)
  WHERE sold_at IS NULL;