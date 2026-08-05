-- 1) Normalisasi telepon yang lebih tahan variasi format.
CREATE OR REPLACE FUNCTION public.normalize_phone(_p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  d text;
BEGIN
  IF _p IS NULL OR length(btrim(_p)) = 0 THEN
    RETURN NULL;
  END IF;

  -- Buang semua karakter selain digit; awalan '+' dan '00' sama-sama
  -- berarti "kode negara menyusul".
  d := regexp_replace(_p, '[^0-9]', '', 'g');
  IF d = '' THEN
    RETURN NULL;
  END IF;

  IF left(d, 2) = '00' THEN
    d := substr(d, 3);
  ELSIF left(d, 1) = '0' THEN
    -- Nomor lokal Indonesia: 0812... -> 62812...
    d := '62' || substr(d, 2);
  ELSIF left(d, 1) = '8' THEN
    -- Ditulis tanpa awalan sama sekali: 812... -> 62812...
    d := '62' || d;
  END IF;

  -- Kode negara terulang (62620812... / 620812...) dirapikan.
  WHILE left(d, 4) = '6262' LOOP
    d := substr(d, 3);
  END LOOP;
  IF left(d, 3) = '620' THEN
    d := '62' || substr(d, 4);
  END IF;

  IF d = '' THEN
    RETURN NULL;
  END IF;
  RETURN d;
END;
$function$;

-- 2) Normalisasi email: lowercase, buang spasi, samakan alias Gmail.
CREATE OR REPLACE FUNCTION public.normalize_email(_e text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  e text;
  local_part text;
  domain_part text;
BEGIN
  IF _e IS NULL THEN RETURN NULL; END IF;
  e := lower(regexp_replace(btrim(_e), '\s', '', 'g'));
  IF e = '' THEN RETURN NULL; END IF;
  IF position('@' in e) = 0 THEN RETURN e; END IF;

  local_part := split_part(e, '@', 1);
  domain_part := split_part(e, '@', 2);

  -- Label "+tag" adalah alias ke kotak surat yang sama.
  local_part := split_part(local_part, '+', 1);
  -- Gmail mengabaikan titik pada bagian lokal.
  IF domain_part IN ('gmail.com', 'googlemail.com') THEN
    local_part := replace(local_part, '.', '');
    domain_part := 'gmail.com';
  END IF;

  IF local_part = '' THEN RETURN NULL; END IF;
  RETURN local_part || '@' || domain_part;
END;
$function$;

-- 3) Hitung ulang kolom turunan dengan aturan baru.
DROP INDEX IF EXISTS public.address_book_owner_phone_uniq;
DROP INDEX IF EXISTS public.address_book_owner_email_uniq;
DROP INDEX IF EXISTS public.address_book_owner_name_uniq;
DROP INDEX IF EXISTS public.address_book_owner_phone_idx;
DROP INDEX IF EXISTS public.address_book_owner_email_idx;

ALTER TABLE public.address_book DROP COLUMN IF EXISTS phone_norm;
ALTER TABLE public.address_book DROP COLUMN IF EXISTS email_norm;
ALTER TABLE public.address_book
  ADD COLUMN phone_norm text GENERATED ALWAYS AS (public.normalize_phone(phone)) STORED,
  ADD COLUMN email_norm text GENERATED ALWAYS AS (public.normalize_email(email)) STORED;

-- 4) Bersihkan duplikat yang muncul setelah normalisasi ulang.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, phone_norm
           ORDER BY (linked_user_id IS NULL), created_at, id
         ) AS rn
  FROM public.address_book
  WHERE phone_norm IS NOT NULL
)
DELETE FROM public.address_book a USING ranked r
WHERE a.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, email_norm
           ORDER BY (linked_user_id IS NULL), created_at, id
         ) AS rn
  FROM public.address_book
  WHERE email_norm IS NOT NULL AND phone_norm IS NULL
)
DELETE FROM public.address_book a USING ranked r
WHERE a.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, lower(btrim(name))
           ORDER BY (linked_user_id IS NULL), created_at, id
         ) AS rn
  FROM public.address_book
  WHERE phone_norm IS NULL AND email_norm IS NULL
)
DELETE FROM public.address_book a USING ranked r
WHERE a.id = r.id AND r.rn > 1;

-- 5) Pasang kembali aturan anti-duplikat + index pencarian.
CREATE INDEX address_book_owner_phone_idx ON public.address_book (user_id, phone_norm);
CREATE INDEX address_book_owner_email_idx ON public.address_book (user_id, email_norm);
CREATE UNIQUE INDEX address_book_owner_phone_uniq
  ON public.address_book (user_id, phone_norm) WHERE phone_norm IS NOT NULL;
CREATE UNIQUE INDEX address_book_owner_email_uniq
  ON public.address_book (user_id, email_norm) WHERE email_norm IS NOT NULL AND phone_norm IS NULL;
CREATE UNIQUE INDEX address_book_owner_name_uniq
  ON public.address_book (user_id, lower(btrim(name))) WHERE phone_norm IS NULL AND email_norm IS NULL;