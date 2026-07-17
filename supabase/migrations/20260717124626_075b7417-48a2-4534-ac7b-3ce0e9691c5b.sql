
CREATE TABLE public.prep_task_wa_hook_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid,
  owner_user_id uuid NOT NULL,
  title text,
  prev_status text,
  new_status text,
  kind text NOT NULL,
  wa_target text,
  send_status text NOT NULL,
  error text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.prep_task_wa_hook_log TO authenticated;
GRANT ALL ON public.prep_task_wa_hook_log TO service_role;

ALTER TABLE public.prep_task_wa_hook_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their task wa hook log"
  ON public.prep_task_wa_hook_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_user_id);

CREATE INDEX prep_task_wa_hook_log_owner_created_idx
  ON public.prep_task_wa_hook_log (owner_user_id, created_at DESC);

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
  v_req_id bigint;
  v_err text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('done', 'cancelled') THEN RETURN NEW; END IF;

  SELECT forward_url, wa_target, enabled INTO cfg
    FROM public.prep_submit_wa_hook WHERE id = true;
  IF NOT FOUND OR cfg.forward_url IS NULL OR cfg.forward_url = '' OR cfg.enabled = false THEN
    RETURN NEW;
  END IF;

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

  BEGIN
    SELECT net.http_post(
      url := cfg.forward_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := payload,
      timeout_milliseconds := 5000
    ) INTO v_req_id;

    INSERT INTO public.prep_task_wa_hook_log
      (task_id, owner_user_id, title, prev_status, new_status, kind, wa_target, send_status, payload)
    VALUES
      (NEW.id, NEW.owner_user_id, NEW.title, OLD.status, NEW.status, v_kind, cfg.wa_target, 'sent', payload);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    INSERT INTO public.prep_task_wa_hook_log
      (task_id, owner_user_id, title, prev_status, new_status, kind, wa_target, send_status, error, payload)
    VALUES
      (NEW.id, NEW.owner_user_id, NEW.title, OLD.status, NEW.status, v_kind, cfg.wa_target, 'failed', v_err, payload);
  END;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
