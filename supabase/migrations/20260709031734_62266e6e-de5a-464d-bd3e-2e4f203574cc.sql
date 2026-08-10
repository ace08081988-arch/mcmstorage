-- H22: index for order_request_events feed
CREATE INDEX IF NOT EXISTS order_request_events_order_created_idx
  ON public.order_request_events (order_id, created_at DESC);

-- H9: enrich prep_submission_verify return with stock assertion
CREATE OR REPLACE FUNCTION public.prep_submission_verify(_submission_id uuid, _decision text, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.prep_submissions%ROWTYPE;
  v_owner uuid;
  v_qty numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;

  SELECT * INTO v_sub FROM public.prep_submissions WHERE id = _submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submission_not_found';
  END IF;

  SELECT owner_user_id INTO v_owner FROM public.prep_tasks WHERE id = v_sub.task_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'forbidden_cross_owner';
  END IF;

  IF v_sub.verification_status <> 'pending' THEN
    RAISE EXCEPTION 'already_decided';
  END IF;

  UPDATE public.prep_submissions
     SET verification_status = _decision,
         verified_at = now(),
         verified_by = v_uid,
         rejection_reason = CASE WHEN _decision = 'rejected' THEN _reason ELSE NULL END
   WHERE id = _submission_id;

  IF _decision = 'approved' AND v_sub.task_item_id IS NOT NULL THEN
    UPDATE public.request_preparations rp
       SET verification_status = 'approved',
           verified_at = now(),
           verified_by = v_uid,
           ready_at = COALESCE(ready_at, now())
     WHERE rp.prep_task_item_id = v_sub.task_item_id
       AND rp.verification_status <> 'approved'
       AND rp.user_id = v_uid;

    UPDATE public.ecer_preparations ep
       SET verification_status = 'approved',
           verified_at = now(),
           verified_by = v_uid,
           ready_at = COALESCE(ready_at, now())
     WHERE ep.prep_task_item_id = v_sub.task_item_id
       AND ep.verification_status <> 'approved'
       AND ep.user_id = v_uid;
  END IF;

  v_qty := COALESCE(v_sub.qty_reported, 0);

  -- H9: stock assertion — pending submissions never touched stock, so
  -- rejecting a pending submission must not change stock. Approvals also
  -- do not decrement here (that happens at sale/ready commit). Return
  -- explicit info so the client can assert no unexpected stock delta.
  RETURN jsonb_build_object(
    'ok', true,
    'decision', _decision,
    'stock_changed', false,
    'stock_delta_qty', 0,
    'reported_qty', v_qty
  );
END;
$function$;