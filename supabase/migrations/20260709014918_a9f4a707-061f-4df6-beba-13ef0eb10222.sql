-- 1) Config table
CREATE TABLE IF NOT EXISTS public.friend_notify_hook_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  hook_url text,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.friend_notify_hook_config TO authenticated;
GRANT ALL ON public.friend_notify_hook_config TO service_role;

ALTER TABLE public.friend_notify_hook_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read friend notify hook config" ON public.friend_notify_hook_config;
CREATE POLICY "admins read friend notify hook config"
  ON public.friend_notify_hook_config FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins manage friend notify hook config" ON public.friend_notify_hook_config;
CREATE POLICY "admins manage friend notify hook config"
  ON public.friend_notify_hook_config FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.friend_notify_hook_config (id, enabled) VALUES (true, false)
  ON CONFLICT (id) DO NOTHING;

-- 2) Trigger function untuk friend_requests
CREATE OR REPLACE FUNCTION public.notify_friend_request_via_hook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cfg record;
  hook_secret text;
  event_kind text;
  payload jsonb;
BEGIN
  SELECT hook_url, enabled INTO cfg
    FROM public.friend_notify_hook_config
    WHERE id = true;
  IF NOT FOUND OR cfg.hook_url IS NULL OR cfg.enabled = false THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text = 'pending' THEN
      event_kind := 'friend_request_new';
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status::text = NEW.status::text THEN
      RETURN NEW;
    END IF;
    IF NEW.status::text = 'accepted' THEN
      event_kind := 'friend_request_accepted';
    ELSIF NEW.status::text = 'rejected' THEN
      event_kind := 'friend_request_rejected';
    ELSIF NEW.status::text = 'pending' AND OLD.status::text IN ('rejected','cancelled') THEN
      event_kind := 'friend_request_new';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO hook_secret
      FROM vault.decrypted_secrets
      WHERE name = 'BUSINESS_NOTIFY_HOOK_SECRET'
      LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    hook_secret := NULL;
  END;

  payload := jsonb_build_object(
    'kind', event_kind,
    'request_id', NEW.id,
    'from_user', NEW.from_user,
    'to_user', NEW.to_user,
    'status', NEW.status::text
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_friend_request_via_hook ON public.friend_requests;
CREATE TRIGGER trg_notify_friend_request_via_hook
  AFTER INSERT OR UPDATE OF status ON public.friend_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_friend_request_via_hook();

REVOKE ALL ON FUNCTION public.notify_friend_request_via_hook() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_friend_request_via_hook() TO service_role;