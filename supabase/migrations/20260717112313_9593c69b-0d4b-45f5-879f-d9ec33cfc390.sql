CREATE OR REPLACE FUNCTION public.notify_prep_task_status_via_hook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  cfg record;
  prefs jsonb;
  wa_on boolean;
  kind_on boolean;
  payload jsonb;
  v_kind text;
BEGIN
  -- Hanya kirim saat status benar-benar berubah ke done/cancelled.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('done', 'cancelled') THEN RETURN NEW; END IF;

  SELECT forward_url, wa_target, enabled INTO cfg
    FROM public.prep_submit_wa_hook WHERE id = true;
  IF NOT FOUND OR cfg.forward_url IS NULL OR cfg.forward_url = '' OR cfg.enabled = false THEN
    RETURN NEW;
  END IF;

  -- Hormati preferensi channel WA × jenis "tugas" milik owner task.
  SELECT unp.prefs INTO prefs FROM public.user_notif_prefs unp
    WHERE unp.user_id = NEW.owner_user_id;
  IF prefs IS NOT NULL THEN
    kind_on := COALESCE((prefs #>> '{enabledKinds,tugas}')::boolean, true);
    wa_on := COALESCE((prefs #>> '{channels,tugas,wa}')::boolean, false);
    IF NOT kind_on OR NOT wa_on THEN RETURN NEW; END IF;
  END IF;

  v_kind := CASE WHEN NEW.status = 'done' THEN 'prep_task_success' ELSE 'prep_task_failed' END;

  payload := jsonb_build_object(
    'kind', v_kind,
    'wa_target', cfg.wa_target,
    'task_id', NEW.id,
    'title', NEW.title,
    'status', NEW.status,
    'prev_status', OLD.status,
    'completion_note', NEW.completion_note,
    'completed_at', COALESCE(NEW.completed_at, now()),
    'owner_user_id', NEW.owner_user_id
  );

  PERFORM net.http_post(
    url := cfg.forward_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := payload,
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_prep_task_status ON public.prep_tasks;
CREATE TRIGGER trg_notify_prep_task_status
  AFTER UPDATE OF status ON public.prep_tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_prep_task_status_via_hook();