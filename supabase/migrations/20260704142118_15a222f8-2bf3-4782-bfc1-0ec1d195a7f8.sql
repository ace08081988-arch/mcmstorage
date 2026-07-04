-- 1) Kolom jadwal opsional
ALTER TABLE public.prep_tasks
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

-- 2) RPC diperbarui: sisipkan _scheduled_at (opsional, default NULL)
DROP FUNCTION IF EXISTS public.prep_create_task(text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.prep_create_task(
  _title text,
  _note text,
  _pin text,
  _share_token text,
  _items jsonb,
  _scheduled_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_task_id uuid;
  v_item jsonb;
  v_pos int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF length(coalesce(_pin,'')) < 4 THEN RAISE EXCEPTION 'pin_too_short'; END IF;
  IF _share_token IS NULL OR length(_share_token) < 8 THEN
    RAISE EXCEPTION 'invalid_share_token';
  END IF;

  INSERT INTO public.prep_tasks(owner_user_id, title, note, share_token, pin_hash, scheduled_at)
  VALUES (
    v_uid,
    coalesce(nullif(_title,''),'Tugas siapkan barang'),
    _note,
    _share_token,
    extensions.crypt(_pin, extensions.gen_salt('bf', 8)),
    _scheduled_at
  )
  RETURNING id INTO v_task_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    INSERT INTO public.prep_task_items(
      task_id, warehouse_item_id, name_snapshot, category_snapshot,
      qty_requested, unit_label, ref_photo_path, note, position
    )
    VALUES (
      v_task_id,
      nullif(v_item->>'warehouse_item_id','')::uuid,
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

  RETURN v_task_id;
END $function$;

REVOKE ALL ON FUNCTION public.prep_create_task(text, text, text, text, jsonb, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.prep_create_task(text, text, text, text, jsonb, timestamptz) TO authenticated;