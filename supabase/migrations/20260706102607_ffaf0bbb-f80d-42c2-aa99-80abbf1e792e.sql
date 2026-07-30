-- Helper: normalisasi unit label. 'g','gr','gram','gm','grm' semua → 'g'.
-- Sisanya lowercase + strip whitespace.
CREATE OR REPLACE FUNCTION public.normalize_unit_label(_u text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _u IS NULL THEN NULL
    WHEN lower(regexp_replace(trim(_u), '[^a-zA-Z]', '', 'g'))
         IN ('g','gr','gram','grm','gm','grams') THEN 'g'
    ELSE lower(regexp_replace(trim(_u), '\s+', '', 'g'))
  END;
$$;

-- Trigger baru: pakai normalize_unit_label untuk match.
CREATE OR REPLACE FUNCTION public.prep_task_items_resolve_ecer_title()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_id uuid;
  v_names text;
  v_unit_norm text;
BEGIN
  IF NEW.ecer_title_id IS NOT NULL OR NEW.warehouse_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_unit_norm := public.normalize_unit_label(NEW.unit_label);

  SELECT COUNT(*), (array_agg(et.id ORDER BY et.position, et.id))[1]
    INTO v_count, v_id
  FROM public.ecer_titles et
  WHERE et.warehouse_item_id = NEW.warehouse_item_id
    AND et.target_grams = NEW.qty_requested
    AND (public.normalize_unit_label(et.unit_label) IS NOT DISTINCT FROM v_unit_norm);

  IF v_count = 1 THEN
    NEW.ecer_title_id := v_id;
  ELSIF v_count > 1 THEN
    SELECT string_agg(et.name, ', ' ORDER BY et.position, et.name)
      INTO v_names
    FROM public.ecer_titles et
    WHERE et.warehouse_item_id = NEW.warehouse_item_id
      AND et.target_grams = NEW.qty_requested
      AND (public.normalize_unit_label(et.unit_label) IS NOT DISTINCT FROM v_unit_norm);
    RAISE EXCEPTION 'Judul ecer ambigu untuk qty % %: pilih salah satu manual (%)',
      NEW.qty_requested, COALESCE(NEW.unit_label, '(tanpa unit)'), v_names
      USING ERRCODE = 'check_violation',
            HINT = 'Buka /tugas-baru, edit baris ini, pilih judul ecer spesifik lalu simpan ulang.';
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill ulang dengan toleransi unit.
WITH resolved AS (
  SELECT pti.id AS pti_id,
         (array_agg(et.id ORDER BY et.position, et.id))[1] AS et_id,
         COUNT(*) AS n
  FROM public.prep_task_items pti
  JOIN public.ecer_titles et
    ON et.warehouse_item_id = pti.warehouse_item_id
   AND et.target_grams = pti.qty_requested
   AND (public.normalize_unit_label(et.unit_label)
        IS NOT DISTINCT FROM public.normalize_unit_label(pti.unit_label))
  WHERE pti.ecer_title_id IS NULL
    AND pti.warehouse_item_id IS NOT NULL
  GROUP BY pti.id
)
UPDATE public.prep_task_items pti
SET ecer_title_id = r.et_id
FROM resolved r
WHERE pti.id = r.pti_id
  AND r.n = 1;