
CREATE TABLE public.turnstile_config (
  id smallint PRIMARY KEY DEFAULT 1,
  site_key text NOT NULL DEFAULT '',
  secret_key text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT turnstile_config_singleton CHECK (id = 1)
);

GRANT SELECT, INSERT, UPDATE ON public.turnstile_config TO authenticated;
GRANT ALL ON public.turnstile_config TO service_role;

ALTER TABLE public.turnstile_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read turnstile config"
ON public.turnstile_config FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert turnstile config"
ON public.turnstile_config FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update turnstile config"
ON public.turnstile_config FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.turnstile_config (id, site_key, secret_key) VALUES (1, '', '')
ON CONFLICT (id) DO NOTHING;

-- Fungsi publik untuk membaca hanya site_key (aman untuk anon).
CREATE OR REPLACE FUNCTION public.get_turnstile_site_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT site_key FROM public.turnstile_config WHERE id = 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_turnstile_site_key() TO anon, authenticated;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.turnstile_config_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER turnstile_config_touch_updated_at
BEFORE UPDATE ON public.turnstile_config
FOR EACH ROW EXECUTE FUNCTION public.turnstile_config_touch();
