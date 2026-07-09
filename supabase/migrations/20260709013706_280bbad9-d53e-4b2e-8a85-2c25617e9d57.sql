-- 1) Config table (single row, admin managed)
CREATE TABLE IF NOT EXISTS public.business_notify_hook_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  hook_url text,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.business_notify_hook_config TO authenticated;
GRANT ALL ON public.business_notify_hook_config TO service_role;

ALTER TABLE public.business_notify_hook_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read business notify hook config" ON public.business_notify_hook_config;
CREATE POLICY "admins read business notify hook config"
  ON public.business_notify_hook_config FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins manage business notify hook config" ON public.business_notify_hook_config;
CREATE POLICY "admins manage business notify hook config"
  ON public.business_notify_hook_config FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.business_notify_hook_config (id, enabled) VALUES (true, false)
  ON CONFLICT (id) DO NOTHING;

-- 2) Trigger function: fire webhook on order_request_events INSERT
CREATE OR REPLACE FUNCTION public.notify_order_event_via_hook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cfg record;
  hook_secret text;
  ord record;
  cust record;
  payload jsonb;
BEGIN
  SELECT hook_url, enabled INTO cfg
    FROM public.business_notify_hook_config
    WHERE id = true;
  IF NOT FOUND OR cfg.hook_url IS NULL OR cfg.enabled = false THEN
    RETURN NEW;
  END IF;

  -- Secret dibaca dari vault kalau ada; else dilewat (webhook akan reject).
  BEGIN
    SELECT decrypted_secret INTO hook_secret
      FROM vault.decrypted_secrets
      WHERE name = 'BUSINESS_NOTIFY_HOOK_SECRET'
      LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    hook_secret := NULL;
  END;

  SELECT o.id, o.user_id, o.customer_id, o.item_name, o.qty, o.qty_mode
    INTO ord
    FROM public.order_requests o
    WHERE o.id = NEW.order_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT c.name, c.account_user_id
    INTO cust
    FROM public.customers c
    WHERE c.id = ord.customer_id;

  payload := jsonb_build_object(
    'kind', 'order_event',
    'event_id', NEW.id,
    'order_id', ord.id,
    'owner_user_id', ord.user_id,
    'customer_account_user_id', cust.account_user_id,
    'customer_name', cust.name,
    'item_name', ord.item_name,
    'qty', ord.qty,
    'qty_mode', ord.qty_mode,
    'from_status', NEW.from_status,
    'to_status', NEW.to_status,
    'note', NEW.note,
    'actor_user_id', NEW.user_id
  );

  PERFORM net.http_post(
    url := cfg.hook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', COALESCE(hook_secret, '')
    ),
    body := payload,
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Jangan pernah blokir insert kalau webhook gagal.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_order_event_via_hook ON public.order_request_events;
CREATE TRIGGER trg_notify_order_event_via_hook
  AFTER INSERT ON public.order_request_events
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_order_event_via_hook();

REVOKE ALL ON FUNCTION public.notify_order_event_via_hook() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_order_event_via_hook() TO service_role;