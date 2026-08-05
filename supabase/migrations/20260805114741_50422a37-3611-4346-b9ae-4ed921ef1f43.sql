-- Dedupe existing duplicates (keep the oldest, prefer linked accounts)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, phone_norm
           ORDER BY (linked_user_id IS NOT NULL) DESC, created_at ASC, id ASC
         ) AS rn
  FROM public.address_book
  WHERE phone_norm IS NOT NULL
)
DELETE FROM public.address_book a USING ranked r WHERE a.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, email_norm
           ORDER BY (linked_user_id IS NOT NULL) DESC, created_at ASC, id ASC
         ) AS rn
  FROM public.address_book
  WHERE email_norm IS NOT NULL AND phone_norm IS NULL
)
DELETE FROM public.address_book a USING ranked r WHERE a.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, lower(btrim(name))
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.address_book
  WHERE phone_norm IS NULL AND email_norm IS NULL
)
DELETE FROM public.address_book a USING ranked r WHERE a.id = r.id AND r.rn > 1;

-- Prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS address_book_owner_phone_uniq
  ON public.address_book (user_id, phone_norm)
  WHERE phone_norm IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS address_book_owner_email_uniq
  ON public.address_book (user_id, email_norm)
  WHERE email_norm IS NOT NULL AND phone_norm IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS address_book_owner_name_uniq
  ON public.address_book (user_id, lower(btrim(name)))
  WHERE phone_norm IS NULL AND email_norm IS NULL;