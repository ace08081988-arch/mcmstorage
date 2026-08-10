CREATE TABLE IF NOT EXISTS public.doc_sequences (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prefix text NOT NULL,
  day date NOT NULL,
  last_seq integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prefix, day)
);

GRANT ALL ON public.doc_sequences TO service_role;
ALTER TABLE public.doc_sequences ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_doc_number(_prefix text, _day date DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p text := upper(regexp_replace(coalesce(_prefix, 'DOC'), '[^A-Za-z0-9]', '', 'g'));
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p = '' THEN p := 'DOC'; END IF;

  INSERT INTO public.doc_sequences (prefix, day, last_seq)
  VALUES (p, _day, 1)
  ON CONFLICT (prefix, day)
  DO UPDATE SET last_seq = public.doc_sequences.last_seq + 1, updated_at = now()
  RETURNING last_seq INTO n;

  RETURN p || '-' || to_char(_day, 'YYYYMMDD') || '-' || lpad(n::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_doc_number(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_doc_number(text, date) TO authenticated;