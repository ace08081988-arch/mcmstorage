
-- 1) Config table (single-row)
CREATE TABLE IF NOT EXISTS public.shipment_hook_config (
  id smallint PRIMARY KEY DEFAULT 1,
  secret text NOT NULL,
  endpoint_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_hook_config_singleton CHECK (id = 1)
);

GRANT ALL ON public.shipment_hook_config TO service_role;
-- Tidak grant ke anon/authenticated: hanya service_role & SECURITY DEFINER

ALTER TABLE public.shipment_hook_config ENABLE ROW LEVEL SECURITY;

-- Policy hanya service_role
CREATE POLICY "service role manages shipment_hook_config"
ON public.shipment_hook_config
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Seed dengan secret acak + endpoint stable published URL
INSERT INTO public.shipment_hook_config (id, secret, endpoint_url)
VALUES (
  1,
  encode(gen_random_bytes(32), 'hex'),
  'https://mcmstorage.lovable.app/api/public/hooks/shipment-status-change'
)
ON CONFLICT (id) DO NOTHING;

-- 2) Pastikan pg_net tersedia
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 3) Fungsi trigger untuk ready_packages
CREATE OR REPLACE FUNCTION public.trg_ready_packages_status_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cfg record;
  cust record;
  status_key text;
  payload jsonb;
BEGIN
  IF NEW.status IS NULL OR NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Map status internal -> statusKey template
  IF NEW.status = 'sent' THEN
    status_key := 'dikirim';
  ELSE
    RETURN NEW; -- status lain tidak memicu email
  END IF;

  SELECT * INTO cfg FROM public.shipment_hook_config WHERE id = 1;
  IF cfg IS NULL THEN RETURN NEW; END IF;

  SELECT name, contact INTO cust FROM public.customers WHERE id = NEW.customer_id;

  payload := jsonb_build_object(
    'source', 'ready_packages',
    'row_id', NEW.id,
    'status_key', status_key,
    'customer_id', NEW.customer_id,
    'customer_name', COALESCE(NEW.sent_to_name, cust.name),
    'customer_phone', COALESCE(NEW.sent_to_phone, cust.contact),
    'item_name', NULL,
    'qty', NEW.qty_base,
    'note', NEW.note
  );

  PERFORM net.http_post(
    url := cfg.endpoint_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', cfg.secret
    ),
    body := payload,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

-- 4) Fungsi trigger untuk order_requests
CREATE OR REPLACE FUNCTION public.trg_order_requests_status_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cfg record;
  cust record;
  status_key text;
  payload jsonb;
BEGIN
  IF NEW.status IS NULL OR NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'siap' THEN
    status_key := 'disiapkan';
  ELSIF NEW.status = 'selesai' THEN
    status_key := 'selesai';
  ELSE
    RETURN NEW;
  END IF;

  SELECT * INTO cfg FROM public.shipment_hook_config WHERE id = 1;
  IF cfg IS NULL THEN RETURN NEW; END IF;

  SELECT name, contact INTO cust FROM public.customers WHERE id = NEW.customer_id;

  payload := jsonb_build_object(
    'source', 'order_requests',
    'row_id', NEW.id,
    'status_key', status_key,
    'customer_id', NEW.customer_id,
    'customer_name', cust.name,
    'customer_phone', cust.contact,
    'item_name', NEW.item_name,
    'qty', NEW.qty,
    'note', NEW.note
  );

  PERFORM net.http_post(
    url := cfg.endpoint_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', cfg.secret
    ),
    body := payload,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

-- 5) Pasang trigger
DROP TRIGGER IF EXISTS ready_packages_status_email ON public.ready_packages;
CREATE TRIGGER ready_packages_status_email
AFTER UPDATE OF status ON public.ready_packages
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION public.trg_ready_packages_status_email();

DROP TRIGGER IF EXISTS order_requests_status_email ON public.order_requests;
CREATE TRIGGER order_requests_status_email
AFTER UPDATE OF status ON public.order_requests
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION public.trg_order_requests_status_email();
