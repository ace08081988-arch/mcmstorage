CREATE TABLE public.warehouse_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_categories_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 64)
);

CREATE UNIQUE INDEX warehouse_categories_user_lower_name_uniq
  ON public.warehouse_categories (user_id, lower(btrim(name)));

CREATE INDEX warehouse_categories_user_position_idx
  ON public.warehouse_categories (user_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_categories TO authenticated;
GRANT ALL ON public.warehouse_categories TO service_role;

ALTER TABLE public.warehouse_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own warehouse categories"
  ON public.warehouse_categories
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.warehouse_categories_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER warehouse_categories_touch_updated_at
  BEFORE UPDATE ON public.warehouse_categories
  FOR EACH ROW EXECUTE FUNCTION public.warehouse_categories_touch_updated_at();

-- Backfill: gabungkan 3 sumber, dedupe case-insensitive per user
WITH src AS (
  SELECT user_id, btrim(category) AS name
    FROM public.warehouse_items
   WHERE category IS NOT NULL AND btrim(category) <> ''
  UNION ALL
  SELECT user_id, btrim(category) AS name
    FROM public.warehouse_category_variants
   WHERE category IS NOT NULL AND btrim(category) <> ''
  UNION ALL
  SELECT us.user_id, btrim(elem.value) AS name
    FROM public.user_storage us
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(us.categories) = 'array' THEN us.categories
        ELSE '[]'::jsonb
      END
    ) AS elem(value)
   WHERE us.categories IS NOT NULL
),
dedup AS (
  SELECT user_id, name,
         row_number() OVER (
           PARTITION BY user_id, lower(name)
           ORDER BY length(name) DESC, name
         ) AS rn
    FROM src
   WHERE name IS NOT NULL AND btrim(name) <> ''
),
ranked AS (
  SELECT user_id, name,
         (row_number() OVER (PARTITION BY user_id ORDER BY name) - 1)::int AS position
    FROM dedup
   WHERE rn = 1
)
INSERT INTO public.warehouse_categories (user_id, name, position)
SELECT r.user_id, r.name, r.position
  FROM ranked r
 WHERE NOT EXISTS (
   SELECT 1 FROM public.warehouse_categories wc
    WHERE wc.user_id = r.user_id
      AND lower(btrim(wc.name)) = lower(r.name)
 );
