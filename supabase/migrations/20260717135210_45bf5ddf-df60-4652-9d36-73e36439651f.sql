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

  -- Paket Request yang eksplisit dipilih pemilik untuk link ini.
  -- Validasi kepemilikan: tidak bisa menautkan paket akun lain.
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

  -- Safety net khusus alur Request: kalau UI/preview lama belum mengirim
  -- _title_ids, jangan biarkan kolom Paket Request kosong. Tautkan hanya
  -- ke paket dengan nama yang PERSIS sama dengan judul `Request: ...`.
  -- Ini bukan fallback global, jadi tidak akan menarik paket lain seperti
  -- KEMBUNG/kyl ke link Request: bagas/PETROK.
  IF NOT EXISTS (
      SELECT 1
      FROM public.prep_task_request_titles ptrt
      WHERE ptrt.task_id = v_task_id
    )
    AND coalesce(_title, '') ~* '^Request:\s*'
  THEN
    INSERT INTO public.prep_task_request_titles(task_id, title_id)
    SELECT v_task_id, rt.id
    FROM public.request_titles rt
    WHERE rt.user_id = v_uid
      AND lower(trim(rt.name)) = lower(trim(regexp_replace(coalesce(_title, ''), '^Request:\s*', '', 'i')))
    ORDER BY rt.created_at DESC
    LIMIT 1
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_task_id;
END
$function$;

REVOKE ALL ON FUNCTION public.prep_create_task(text, text, text, text, jsonb, timestamp with time zone, integer, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.prep_create_task(text, text, text, text, jsonb, timestamp with time zone, integer, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prep_create_task(text, text, text, text, jsonb, timestamp with time zone, integer, uuid[]) TO service_role;