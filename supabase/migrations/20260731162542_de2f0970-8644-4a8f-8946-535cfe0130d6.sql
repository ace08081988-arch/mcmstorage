CREATE TABLE public.public_catalog_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  shop_name text NOT NULL DEFAULT 'Toko',
  wa_number text NOT NULL DEFAULT '',
  tagline text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_catalog_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_catalog_settings TO authenticated;
GRANT ALL ON public.public_catalog_settings TO service_role;

ALTER TABLE public.public_catalog_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own public catalog settings"
ON public.public_catalog_settings FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);