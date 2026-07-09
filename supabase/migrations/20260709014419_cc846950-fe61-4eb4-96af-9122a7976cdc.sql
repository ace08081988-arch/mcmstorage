-- 1) Config table (single row) untuk hook notifikasi prep task
CREATE TABLE IF NOT EXISTS public.prep_task_notify_hook_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  hook_url text,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.prep_task_notify_hook_config TO authenticated;
GRANT ALL ON public.prep_task_notify_hook_config TO service_role;

ALTER TABLE public.prep_task_notify_hook_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read prep task notify hook config" ON public.prep_task_notify_hook_config;
CREATE POLICY "admins read prep task notify hook config"
  ON public.prep_task_notify_hook_config FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins manage prep task notify hook config" ON public.prep_task_notify_hook_config;
CREATE POLICY "admins manage prep task notify hook config"
  ON public.prep_task_notify_hook_config FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.prep_task_notify_hook_config (id, enabled) VALUES (true, false)
  ON CONFLICT (id) DO NOTHING;

-- 2) Trigger function untuk prep_tasks INSERT
CREATE OR REPLACE FUNCTION public.notify_prep_task_via_hook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cfg record;
  hook_secret text;
  item_count int;
  first_item text;
  payload jsonb;
BEGIN
  SELECT hook_url, enabled INTO cfg
    FROM public.prep_task_notify_hook_config
    WHERE id = true;
  IF NOT FOUND OR cfg.hook_url IS NULL OR cfg.enabled = false THEN
    RETURN NEW;
  END IF;

  -- Hanya kirim jika ada pegawai yg ditugaskan
  IF NEW.employee_id IS NULL THEN
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

  SELECT COUNT(*)::int, MIN(name_snapshot)
    INTO item_count, first_item
    FROM public.prep_task_items
    WHERE task_id = NEW.id;

  payload := jsonb_build_object(
    'kind', 'prep_task_assigned',
    'task_id', NEW.id,
    'owner_user_id', NEW.owner_user_id,
    'employee_id', NEW.employee_id,
    'title', NEW.title,
    'note', NEW.note,
    'status', NEW.status,
    'scheduled_at', NEW.scheduled_at,
    'item_count', COALESCE(item_count, 0),
    'first_item_name', first_item,
    'actor_user_id', NEW.owner_user_id
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

DROP TRIGGER IF EXISTS trg_notify_prep_task_via_hook ON public.prep_tasks;
CREATE TRIGGER trg_notify_prep_task_via_hook
  AFTER INSERT ON public.prep_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_prep_task_via_hook();

REVOKE ALL ON FUNCTION public.notify_prep_task_via_hook() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_prep_task_via_hook() TO service_role;