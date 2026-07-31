-- 1) Backfill: tugas aktif tetap terbuka untuk banyak unggahan
UPDATE public.prep_tasks
   SET max_submissions = 999
 WHERE status = 'active' AND coalesce(max_submissions, 1) < 999;

-- 2) Default kolom untuk tugas baru
ALTER TABLE public.prep_tasks
  ALTER COLUMN max_submissions SET DEFAULT 999;