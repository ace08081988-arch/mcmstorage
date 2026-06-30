
-- normalize phone helper (digits only, drop leading 0 for ID, keep + intl)
CREATE OR REPLACE FUNCTION public.normalize_phone(_p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _p IS NULL OR length(btrim(_p)) = 0 THEN NULL
    WHEN left(regexp_replace(_p, '[^0-9+]', '', 'g'), 1) = '+'
      THEN regexp_replace(_p, '[^0-9]', '', 'g')
    WHEN left(regexp_replace(_p, '[^0-9]', '', 'g'), 1) = '0'
      THEN '62' || substr(regexp_replace(_p, '[^0-9]', '', 'g'), 2)
    ELSE regexp_replace(_p, '[^0-9]', '', 'g')
  END
$$;

CREATE TABLE public.address_book (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  phone_norm text GENERATED ALWAYS AS (public.normalize_phone(phone)) STORED,
  email text,
  email_norm text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  source text NOT NULL DEFAULT 'manual',
  device_contact_id text,
  linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT address_book_source_chk CHECK (source IN ('device','manual','app'))
);

CREATE UNIQUE INDEX address_book_owner_device_uniq
  ON public.address_book(user_id, device_contact_id)
  WHERE device_contact_id IS NOT NULL;
CREATE INDEX address_book_owner_phone_idx ON public.address_book(user_id, phone_norm);
CREATE INDEX address_book_owner_email_idx ON public.address_book(user_id, email_norm);
CREATE INDEX address_book_owner_name_idx ON public.address_book(user_id, lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.address_book TO authenticated;
GRANT ALL ON public.address_book TO service_role;

ALTER TABLE public.address_book ENABLE ROW LEVEL SECURITY;

CREATE POLICY "address_book owner read" ON public.address_book
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "address_book owner insert" ON public.address_book
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "address_book owner update" ON public.address_book
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "address_book owner delete" ON public.address_book
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER address_book_set_updated_at
  BEFORE UPDATE ON public.address_book
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Match a batch of phones/emails to registered profiles.
-- SECURITY DEFINER so it can read profiles.phone/email, but it only returns
-- the matched user_id + display_name + masked indicator (no raw phone/email back).
CREATE OR REPLACE FUNCTION public.match_address_book_profiles(
  _phones text[] DEFAULT NULL,
  _emails text[] DEFAULT NULL
)
RETURNS TABLE (
  match_key text,
  match_kind text,
  user_id uuid,
  display_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.normalize_phone(p) AS match_key,
         'phone'::text AS match_kind,
         pr.id AS user_id,
         pr.display_name
    FROM unnest(coalesce(_phones, ARRAY[]::text[])) AS p
    JOIN public.profiles pr ON public.normalize_phone(pr.phone) = public.normalize_phone(p)
   WHERE auth.uid() IS NOT NULL AND public.normalize_phone(p) IS NOT NULL
  UNION
  SELECT lower(btrim(e)) AS match_key,
         'email'::text AS match_kind,
         pr.id AS user_id,
         pr.display_name
    FROM unnest(coalesce(_emails, ARRAY[]::text[])) AS e
    JOIN public.profiles pr ON lower(btrim(pr.email)) = lower(btrim(e))
   WHERE auth.uid() IS NOT NULL AND length(btrim(e)) > 0;
$$;

REVOKE ALL ON FUNCTION public.match_address_book_profiles(text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_address_book_profiles(text[], text[]) TO authenticated;
