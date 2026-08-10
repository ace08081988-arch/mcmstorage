-- Slice C: auto-archive chat saat transaksi tertaut selesai (sold_at diisi
-- atau prep_task berpindah ke status 'done'/'completed'). Chat tetap
-- terlihat & searchable — hanya kategori berubah ke 'archived' dan
-- archived_at diisi supaya UI bisa memasang badge "Arsip".

CREATE OR REPLACE FUNCTION public._chat_auto_archive_from_request_prep()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sold_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.sold_at IS NULL) THEN
    UPDATE public.conversations
       SET archived_at = COALESCE(archived_at, now()),
           category = 'archived'
     WHERE linked_request_prep_id = NEW.id
       AND archived_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._chat_auto_archive_from_ecer_prep()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sold_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.sold_at IS NULL) THEN
    UPDATE public.conversations
       SET archived_at = COALESCE(archived_at, now()),
           category = 'archived'
     WHERE linked_ecer_prep_id = NEW.id
       AND archived_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._chat_auto_archive_from_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('done','completed') AND (TG_OP = 'INSERT' OR COALESCE(OLD.status,'') NOT IN ('done','completed')) THEN
    UPDATE public.conversations
       SET archived_at = COALESCE(archived_at, now()),
           category = 'archived'
     WHERE linked_task_id = NEW.id
       AND archived_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_auto_archive_request_prep ON public.request_preparations;
CREATE TRIGGER trg_chat_auto_archive_request_prep
AFTER INSERT OR UPDATE OF sold_at ON public.request_preparations
FOR EACH ROW EXECUTE FUNCTION public._chat_auto_archive_from_request_prep();

DROP TRIGGER IF EXISTS trg_chat_auto_archive_ecer_prep ON public.ecer_preparations;
CREATE TRIGGER trg_chat_auto_archive_ecer_prep
AFTER INSERT OR UPDATE OF sold_at ON public.ecer_preparations
FOR EACH ROW EXECUTE FUNCTION public._chat_auto_archive_from_ecer_prep();

DROP TRIGGER IF EXISTS trg_chat_auto_archive_task ON public.prep_tasks;
CREATE TRIGGER trg_chat_auto_archive_task
AFTER INSERT OR UPDATE OF status ON public.prep_tasks
FOR EACH ROW EXECUTE FUNCTION public._chat_auto_archive_from_task();

-- Backfill: kirim chat yang tautannya sudah "sold_at" atau task 'done'
-- ke arsip supaya konsisten dengan aturan baru.
UPDATE public.conversations c
   SET archived_at = COALESCE(c.archived_at, now()),
       category = 'archived'
  FROM public.request_preparations rp
 WHERE c.linked_request_prep_id = rp.id
   AND rp.sold_at IS NOT NULL
   AND c.archived_at IS NULL;

UPDATE public.conversations c
   SET archived_at = COALESCE(c.archived_at, now()),
       category = 'archived'
  FROM public.ecer_preparations ep
 WHERE c.linked_ecer_prep_id = ep.id
   AND ep.sold_at IS NOT NULL
   AND c.archived_at IS NULL;

UPDATE public.conversations c
   SET archived_at = COALESCE(c.archived_at, now()),
       category = 'archived'
  FROM public.prep_tasks t
 WHERE c.linked_task_id = t.id
   AND t.status IN ('done','completed')
   AND c.archived_at IS NULL;