-- 1) Table that records PIN-verified upload grants per share token.
CREATE TABLE IF NOT EXISTS public.prep_upload_grants (
  share_token text PRIMARY KEY,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

GRANT SELECT ON public.prep_upload_grants TO anon, authenticated;
GRANT ALL    ON public.prep_upload_grants TO service_role;

ALTER TABLE public.prep_upload_grants ENABLE ROW LEVEL SECURITY;

-- Token is already public (part of the share URL); only the existence/expiry matters.
DROP POLICY IF EXISTS "read upload grants" ON public.prep_upload_grants;
CREATE POLICY "read upload grants"
  ON public.prep_upload_grants
  FOR SELECT TO anon, authenticated
  USING (true);
-- No insert/update/delete policies → only SECURITY DEFINER functions can write.

-- 2) prep_get_task: after PIN check, also issue/refresh a 15-minute upload grant.
CREATE OR REPLACE FUNCTION public.prep_get_task(_token text, _pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_items jsonb;
BEGIN
  SELECT * INTO v_task FROM public.prep_tasks
    WHERE share_token = _token AND status = 'active' AND expires_at > now() LIMIT 1;
  IF v_task.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_task.pin_hash <> extensions.crypt(_pin, v_task.pin_hash) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_pin');
  END IF;

  -- PIN-verified: grant a short-lived upload window for this share token.
  INSERT INTO public.prep_upload_grants(share_token, expires_at)
  VALUES (v_task.share_token, now() + interval '15 minutes')
  ON CONFLICT (share_token) DO UPDATE
    SET expires_at = EXCLUDED.expires_at,
        issued_at = now();

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'name', i.name_snapshot, 'category', i.category_snapshot,
    'qty_requested', i.qty_requested, 'qty_prepared', i.qty_prepared,
    'unit_label', i.unit_label, 'ref_photo_path', i.ref_photo_path, 'note', i.note,
    'submissions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'photo_path', s.photo_path, 'location_url', s.location_url,
        'note', s.note, 'submitted_at', s.submitted_at
      ) ORDER BY s.submitted_at DESC), '[]'::jsonb)
      FROM public.prep_submissions s WHERE s.task_item_id = i.id
    )
  ) ORDER BY i.position), '[]'::jsonb) INTO v_items
  FROM public.prep_task_items i WHERE i.task_id = v_task.id;

  RETURN jsonb_build_object('ok', true, 'task', jsonb_build_object(
    'id', v_task.id, 'title', v_task.title, 'note', v_task.note,
    'status', v_task.status, 'expires_at', v_task.expires_at
  ), 'items', v_items);
END $function$;

-- 3) Tighten the storage INSERT policy to require both an active task AND a PIN-verified grant.
DROP POLICY IF EXISTS "prep-photos guarded insert" ON storage.objects;
CREATE POLICY "prep-photos guarded insert"
  ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'prep-photos'
    AND EXISTS (
      SELECT 1
        FROM public.prep_tasks t
        JOIN public.prep_upload_grants g ON g.share_token = t.share_token
       WHERE t.share_token = (storage.foldername(storage.objects.name))[1]
         AND t.status = 'active'
         AND t.expires_at > now()
         AND g.expires_at > now()
    )
  );