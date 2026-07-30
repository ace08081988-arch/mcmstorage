INSERT INTO public.prep_task_request_titles(task_id, title_id)
SELECT t.id, rt.id
FROM public.prep_tasks t
JOIN public.request_titles rt
  ON rt.user_id = t.owner_user_id
 AND lower(trim(rt.name)) = lower(trim(regexp_replace(t.title, '^Request:\s*', '', 'i')))
WHERE t.title ~* '^Request:\s*'
  AND t.status = 'active'
  AND t.expires_at > now()
  AND NOT EXISTS (
    SELECT 1
    FROM public.prep_task_request_titles ptrt
    WHERE ptrt.task_id = t.id
  )
ON CONFLICT DO NOTHING;