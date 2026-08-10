CREATE OR REPLACE FUNCTION public.repair_missing_request_task_title_links(
  _owner_user_id uuid DEFAULT NULL,
  _task_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH candidate_tasks AS (
    SELECT
      t.id AS task_id,
      t.owner_user_id,
      lower(trim(regexp_replace(coalesce(t.title, ''), '^Request:\s*', '', 'i'))) AS request_name
    FROM public.prep_tasks t
    WHERE coalesce(t.title, '') ~* '^Request:\s*'
      AND (_owner_user_id IS NULL OR t.owner_user_id = _owner_user_id)
      AND (_task_id IS NULL OR t.id = _task_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.prep_task_request_titles ptrt
        WHERE ptrt.task_id = t.id
      )
  ), matched_titles AS (
    SELECT DISTINCT ON (ct.task_id)
      ct.task_id,
      rt.id AS title_id
    FROM candidate_tasks ct
    JOIN public.request_titles rt
      ON rt.user_id = ct.owner_user_id
     AND lower(trim(rt.name)) = ct.request_name
    ORDER BY ct.task_id, rt.created_at DESC, rt.id DESC
  ), inserted_rows AS (
    INSERT INTO public.prep_task_request_titles(task_id, title_id)
    SELECT mt.task_id, mt.title_id
    FROM matched_titles mt
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_inserted
  FROM inserted_rows;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_repair_request_task_title_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_TABLE_NAME = 'prep_tasks' THEN
    IF coalesce(NEW.title, '') ~* '^Request:\s*' THEN
      PERFORM public.repair_missing_request_task_title_links(NEW.owner_user_id, NEW.id);
    END IF;
  ELSIF TG_TABLE_NAME = 'request_titles' THEN
    PERFORM public.repair_missing_request_task_title_links(NEW.user_id, NULL);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_repair_request_task_title_link_on_tasks ON public.prep_tasks;
CREATE TRIGGER trg_auto_repair_request_task_title_link_on_tasks
AFTER INSERT OR UPDATE OF title, owner_user_id ON public.prep_tasks
FOR EACH ROW
EXECUTE FUNCTION public.auto_repair_request_task_title_link();

DROP TRIGGER IF EXISTS trg_auto_repair_request_task_title_link_on_request_titles ON public.request_titles;
CREATE TRIGGER trg_auto_repair_request_task_title_link_on_request_titles
AFTER INSERT OR UPDATE OF name, user_id ON public.request_titles
FOR EACH ROW
EXECUTE FUNCTION public.auto_repair_request_task_title_link();

GRANT EXECUTE ON FUNCTION public.repair_missing_request_task_title_links(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_missing_request_task_title_links(uuid, uuid) TO service_role;