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
  v_caller uuid := auth.uid();
BEGIN
  -- Authorization: kalau ada JWT caller (bukan trigger internal / service_role),
  -- caller hanya boleh memperbaiki datanya sendiri. Trigger SECURITY DEFINER
  -- internal memanggil fungsi ini tanpa JWT (auth.uid() IS NULL) — itu tetap
  -- diizinkan karena berjalan dalam konteks server-trusted.
  IF v_caller IS NOT NULL THEN
    IF _owner_user_id IS NULL THEN
      _owner_user_id := v_caller;
    ELSIF _owner_user_id <> v_caller THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF _task_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prep_tasks t
      WHERE t.id = _task_id AND t.owner_user_id = v_caller
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

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