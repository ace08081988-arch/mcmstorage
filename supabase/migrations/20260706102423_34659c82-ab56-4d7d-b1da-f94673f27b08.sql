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
BEGIN
  IF NEW.ecer_title_id IS NOT NULL OR NEW.warehouse_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*), (array_agg(et.id ORDER BY et.position, et.id))[1]
    INTO v_count, v_id
  FROM public.ecer_titles et
  WHERE et.warehouse_item_id = NEW.warehouse_item_id
    AND et.target_grams = NEW.qty_requested
    AND (et.unit_label IS NOT DISTINCT FROM NEW.unit_label);

  IF v_count = 1 THEN
    NEW.ecer_title_id := v_id;
  ELSIF v_count > 1 THEN
    SELECT string_agg(et.name, ', ' ORDER BY et.position, et.name)
      INTO v_names
    FROM public.ecer_titles et
    WHERE et.warehouse_item_id = NEW.warehouse_item_id
      AND et.target_grams = NEW.qty_requested
      AND (et.unit_label IS NOT DISTINCT FROM NEW.unit_label);
    RAISE EXCEPTION 'Judul ecer ambigu untuk qty % %: pilih salah satu manual (%)',
      NEW.qty_requested, COALESCE(NEW.unit_label, '(tanpa unit)'), v_names
      USING ERRCODE = 'check_violation',
            HINT = 'Buka /tugas-baru, edit baris ini, pilih judul ecer spesifik lalu simpan ulang.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prep_task_items_resolve_ecer_title
  ON public.prep_task_items;

CREATE TRIGGER trg_prep_task_items_resolve_ecer_title
BEFORE INSERT OR UPDATE OF warehouse_item_id, qty_requested, unit_label, ecer_title_id
ON public.prep_task_items
FOR EACH ROW
EXECUTE FUNCTION public.prep_task_items_resolve_ecer_title();

-- Backfill idempoten (hanya single-match, pilih deterministik via position).
WITH resolved AS (
  SELECT pti.id AS pti_id,
         (array_agg(et.id ORDER BY et.position, et.id))[1] AS et_id,
         COUNT(*) AS n
  FROM public.prep_task_items pti
  JOIN public.ecer_titles et
    ON et.warehouse_item_id = pti.warehouse_item_id
   AND et.target_grams = pti.qty_requested
   AND (et.unit_label IS NOT DISTINCT FROM pti.unit_label)
  WHERE pti.ecer_title_id IS NULL
    AND pti.warehouse_item_id IS NOT NULL
  GROUP BY pti.id
)
UPDATE public.prep_task_items pti
SET ecer_title_id = r.et_id
FROM resolved r
WHERE pti.id = r.pti_id
  AND r.n = 1;

CREATE OR REPLACE VIEW public.prep_submissions_unrouted AS
SELECT
  ps.id,
  ps.task_id,
  ps.task_item_id,
  ps.photo_path,
  ps.photo_paths,
  ps.location_url,
  ps.gps_lat,
  ps.gps_lng,
  ps.note,
  ps.qty_reported,
  ps.submitted_at,
  pti.warehouse_item_id,
  pti.name_snapshot,
  pti.qty_requested,
  pti.unit_label,
  wi.name AS warehouse_item_name,
  pt.owner_user_id
FROM public.prep_submissions ps
JOIN public.prep_task_items pti ON pti.id = ps.task_item_id
JOIN public.prep_tasks pt ON pt.id = ps.task_id
LEFT JOIN public.warehouse_items wi ON wi.id = pti.warehouse_item_id
WHERE pti.ecer_title_id IS NULL;

GRANT SELECT ON public.prep_submissions_unrouted TO authenticated;
GRANT SELECT ON public.prep_submissions_unrouted TO service_role;

COMMENT ON VIEW public.prep_submissions_unrouted IS
  'Kiriman prep_submissions yang task_item-nya belum terlink ke ecer_title. Muncul di /request section "Kiriman tanpa folder".';
COMMENT ON FUNCTION public.prep_task_items_resolve_ecer_title() IS
  'Auto-isi ecer_title_id via match eksak (warehouse_item_id, qty_requested, unit_label). Ambigu → RAISE. Nol match → biarkan NULL.';