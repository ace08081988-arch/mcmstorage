
-- 1. Tabel penghubung ---------------------------------------------------
CREATE TABLE public.prep_task_request_titles (
  task_id  uuid NOT NULL REFERENCES public.prep_tasks(id)     ON DELETE CASCADE,
  title_id uuid NOT NULL REFERENCES public.request_titles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, title_id)
);

CREATE INDEX idx_prep_task_request_titles_title
  ON public.prep_task_request_titles (title_id, task_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prep_task_request_titles TO authenticated;
GRANT ALL ON public.prep_task_request_titles TO service_role;

ALTER TABLE public.prep_task_request_titles ENABLE ROW LEVEL SECURITY;

-- Pemilik tugas (juga pasti pemilik paket) yang bisa kelola baris ini.
CREATE POLICY "task owner manages own task-title links"
  ON public.prep_task_request_titles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.prep_tasks t
      WHERE t.id = prep_task_request_titles.task_id
        AND t.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.prep_tasks t
      WHERE t.id = prep_task_request_titles.task_id
        AND t.owner_user_id = auth.uid()
    )
  );

-- 2. Backfill: satu link aktif terbaru per pemilik mewarisi paket lama --
INSERT INTO public.prep_task_request_titles(task_id, title_id)
SELECT latest_task.id, rt.id
FROM public.request_titles rt
JOIN LATERAL (
  SELECT t.id, t.owner_user_id
  FROM public.prep_tasks t
  WHERE t.owner_user_id = rt.user_id
    AND t.status = 'active'
    AND t.expires_at > now()
  ORDER BY t.created_at DESC
  LIMIT 1
) latest_task ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.request_preparations rp
  WHERE rp.title_id = rt.id
    AND rp.user_id = rt.user_id
    AND (rt.reprep_requested_at IS NULL OR rp.created_at > rt.reprep_requested_at)
)
ON CONFLICT DO NOTHING;

-- 3. RPC prep_create_task: tambah _title_ids -----------------------------
CREATE OR REPLACE FUNCTION public.prep_create_task(
  _title text,
  _note text,
  _pin text,
  _share_token text,
  _items jsonb,
  _scheduled_at timestamptz DEFAULT NULL,
  _max_submissions integer DEFAULT 1,
  _title_ids uuid[] DEFAULT ARRAY[]::uuid[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_task_id uuid;
  v_item jsonb;
  v_pos int := 0;
  v_max int;
  v_title_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF public.is_chat_only(v_uid) THEN
    RAISE EXCEPTION 'storage_account_required';
  END IF;

  IF length(coalesce(_pin, '')) < 4 THEN
    RAISE EXCEPTION 'pin_too_short';
  END IF;

  IF _share_token IS NULL OR length(_share_token) < 8 THEN
    RAISE EXCEPTION 'invalid_share_token';
  END IF;

  v_max := greatest(1, coalesce(_max_submissions, 1));

  INSERT INTO public.prep_tasks(owner_user_id, title, note, share_token, pin_hash, scheduled_at, max_submissions)
  VALUES (
    v_uid,
    coalesce(nullif(_title, ''), 'Tugas siapkan barang'),
    _note,
    _share_token,
    extensions.crypt(_pin, extensions.gen_salt('bf', 8)),
    _scheduled_at,
    v_max
  )
  RETURNING id INTO v_task_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb)) LOOP
    INSERT INTO public.prep_task_items(
      task_id, warehouse_item_id, name_snapshot, category_snapshot,
      qty_requested, unit_label, ref_photo_path, note, position
    ) VALUES (
      v_task_id,
      nullif(v_item->>'warehouse_item_id', '')::uuid,
      coalesce(v_item->>'name', 'Item'),
      v_item->>'category',
      coalesce((v_item->>'qty_requested')::numeric, 1),
      v_item->>'unit_label',
      v_item->>'ref_photo_path',
      v_item->>'note',
      v_pos
    );
    v_pos := v_pos + 1;
  END LOOP;

  -- Sertakan paket request yang dipilih pemilik. Validasi kepemilikan:
  -- hanya paket milik v_uid yang boleh ditautkan.
  IF _title_ids IS NOT NULL AND array_length(_title_ids, 1) IS NOT NULL THEN
    FOREACH v_title_id IN ARRAY _title_ids LOOP
      IF v_title_id IS NULL THEN CONTINUE; END IF;
      IF EXISTS (
        SELECT 1 FROM public.request_titles rt
        WHERE rt.id = v_title_id AND rt.user_id = v_uid
      ) THEN
        INSERT INTO public.prep_task_request_titles(task_id, title_id)
        VALUES (v_task_id, v_title_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_task_id;
END
$function$;

-- 4. RPC request_list_titles_via_task: scope ke tugas ini ---------------
CREATE OR REPLACE FUNCTION public.request_list_titles_via_task(_token text, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_task public.prep_tasks%ROWTYPE; v_rows jsonb; v_locked timestamptz;
BEGIN
  v_locked := public.prep_pin_locked_until(_token);
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited',
      'retry_after', extract(epoch from (v_locked - now()))::int);
  END IF;
  SELECT * INTO v_task FROM public.prep_tasks
    WHERE share_token = _token AND status = 'active' AND expires_at > now() LIMIT 1;
  IF v_task.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_task.pin_hash <> extensions.crypt(_pin, v_task.pin_hash) THEN
    PERFORM public.record_prep_pin_failure(_token);
    RETURN jsonb_build_object('ok', false, 'error', 'bad_pin');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'note', t.note,
    'submitted_count', (
      SELECT count(*) FROM public.request_preparations rp
      WHERE rp.title_id = t.id
        AND rp.user_id = v_task.owner_user_id
        AND (t.reprep_requested_at IS NULL OR rp.created_at > t.reprep_requested_at)
    ),
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', ti.id,
        'warehouse_item_id', ti.warehouse_item_id,
        'product_name', wi.name,
        'target_grams', ti.target_grams,
        'unit_label', ti.unit_label,
        'note', ti.note
      ) ORDER BY ti.position, ti.created_at), '[]'::jsonb)
      FROM public.request_title_items ti
      LEFT JOIN public.warehouse_items wi ON wi.id = ti.warehouse_item_id
      WHERE ti.title_id = t.id
    )
  ) ORDER BY t.position, t.created_at), '[]'::jsonb) INTO v_rows
  FROM public.request_titles t
  JOIN public.prep_task_request_titles ptrt
    ON ptrt.title_id = t.id AND ptrt.task_id = v_task.id
  WHERE t.user_id = v_task.owner_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.request_preparations rp
      WHERE rp.title_id = t.id
        AND rp.user_id = v_task.owner_user_id
        AND (t.reprep_requested_at IS NULL OR rp.created_at > t.reprep_requested_at)
    );

  RETURN jsonb_build_object(
    'ok', true,
    'owner_user_id', v_task.owner_user_id,
    'titles', v_rows
  );
END $function$;
