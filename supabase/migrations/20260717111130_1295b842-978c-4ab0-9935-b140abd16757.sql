-- 1) Tabel singleton konfigurasi WA hook
CREATE TABLE IF NOT EXISTS public.prep_submit_wa_hook (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  forward_url text,
  wa_target text,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.prep_submit_wa_hook TO authenticated;
GRANT ALL ON public.prep_submit_wa_hook TO service_role;

ALTER TABLE public.prep_submit_wa_hook ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin manage prep_submit_wa_hook" ON public.prep_submit_wa_hook;
CREATE POLICY "admin manage prep_submit_wa_hook"
  ON public.prep_submit_wa_hook FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.prep_submit_wa_hook (id, enabled)
  VALUES (true, false)
  ON CONFLICT (id) DO NOTHING;

-- 2) Trigger function: kirim notifikasi sukses submit
CREATE OR REPLACE FUNCTION public.notify_prep_submit_via_hook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  cfg record;
  payload jsonb;
  v_task record;
  v_title text;
  v_item_name text;
  v_photo_count int;
  v_kind text;
BEGIN
  SELECT forward_url, wa_target, enabled INTO cfg
    FROM public.prep_submit_wa_hook WHERE id = true;
  IF NOT FOUND OR cfg.forward_url IS NULL OR cfg.forward_url = '' OR cfg.enabled = false THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'prep_submissions' THEN
    v_kind := 'prep_submit_success_ecer';
    SELECT pt.title, pt.share_token, pt.owner_user_id, pti.name_snapshot AS item_name
      INTO v_task
      FROM public.prep_task_items pti
      JOIN public.prep_tasks pt ON pt.id = pti.task_id
      WHERE pti.id = NEW.task_item_id;
    v_title := v_task.title;
    v_item_name := v_task.item_name;
    v_photo_count := COALESCE(array_length(NEW.photo_paths, 1), CASE WHEN NEW.photo_path IS NOT NULL THEN 1 ELSE 0 END);
  ELSIF TG_TABLE_NAME = 'request_preparations' THEN
    v_kind := 'prep_submit_success_paket';
    SELECT rt.name AS title_name INTO v_task
      FROM public.request_titles rt WHERE rt.id = NEW.title_id;
    v_title := v_task.title_name;
    v_item_name := NULL;
    v_photo_count := COALESCE(array_length(NEW.photo_paths, 1), CASE WHEN NEW.photo_path IS NOT NULL THEN 1 ELSE 0 END);
  ELSE
    RETURN NEW;
  END IF;

  payload := jsonb_build_object(
    'kind', v_kind,
    'wa_target', cfg.wa_target,
    'title', v_title,
    'item_name', v_item_name,
    'photo_count', v_photo_count,
    'submission_id', NEW.id,
    'submitted_at', COALESCE(NEW.created_at, now())
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

DROP TRIGGER IF EXISTS trg_notify_prep_submit_success_ecer ON public.prep_submissions;
CREATE TRIGGER trg_notify_prep_submit_success_ecer
  AFTER INSERT ON public.prep_submissions
  FOR EACH ROW EXECUTE FUNCTION public.notify_prep_submit_via_hook();

DROP TRIGGER IF EXISTS trg_notify_prep_submit_success_paket ON public.request_preparations;
CREATE TRIGGER trg_notify_prep_submit_success_paket
  AFTER INSERT ON public.request_preparations
  FOR EACH ROW EXECUTE FUNCTION public.notify_prep_submit_via_hook();

-- 3) Helper untuk verifikasi token+PIN dari sisi server pada endpoint laporan gagal
CREATE OR REPLACE FUNCTION public.prep_task_resolve(_token text, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_task public.prep_tasks%ROWTYPE;
BEGIN
  SELECT * INTO v_task FROM public.prep_tasks
    WHERE share_token = _token AND status = 'active' AND expires_at > now()
    LIMIT 1;
  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_task.pin_hash <> extensions.crypt(_pin, v_task.pin_hash) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_pin');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'task_id', v_task.id,
    'owner_user_id', v_task.owner_user_id,
    'title', v_task.title
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prep_task_resolve(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prep_task_resolve(text, text) TO service_role;