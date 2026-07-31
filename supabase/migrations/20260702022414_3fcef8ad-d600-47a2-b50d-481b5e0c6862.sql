-- Add ecer_title_id link on prep_task_items so worker submissions map back to the exact title/variant
ALTER TABLE public.prep_task_items
  ADD COLUMN IF NOT EXISTS ecer_title_id uuid REFERENCES public.ecer_titles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prep_task_items_ecer_title ON public.prep_task_items(ecer_title_id);

-- Update prep_create_task to also persist ecer_title_id from the payload
CREATE OR REPLACE FUNCTION public.prep_create_task(_title text, _note text, _pin text, _share_token text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_task_id uuid; v_item jsonb; v_pos int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF length(coalesce(_pin,'')) < 4 THEN RAISE EXCEPTION 'pin_too_short'; END IF;
  INSERT INTO public.prep_tasks(owner_user_id, title, note, share_token, pin_hash)
  VALUES (v_uid, coalesce(nullif(_title,''),'Tugas siapkan barang'), _note, _share_token,
    extensions.crypt(_pin, extensions.gen_salt('bf', 8)))
  RETURNING id INTO v_task_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    INSERT INTO public.prep_task_items(task_id, warehouse_item_id, name_snapshot, category_snapshot, qty_requested, unit_label, ref_photo_path, note, position, ecer_title_id)
    VALUES (v_task_id, nullif(v_item->>'warehouse_item_id','')::uuid,
      coalesce(v_item->>'name', 'Item'), v_item->>'category',
      coalesce((v_item->>'qty_requested')::numeric, 1),
      v_item->>'unit_label', v_item->>'ref_photo_path', v_item->>'note', v_pos,
      nullif(v_item->>'ecer_title_id','')::uuid);
    v_pos := v_pos + 1;
  END LOOP;
  RETURN v_task_id;
END $function$;