-- Sprint 2A: security & integrity guardrails

-- C1 + H7: prep_submission_verify — enforce owner scope + guard re-verify
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

  -- C1: owner scope
  SELECT owner_user_id INTO v_owner FROM public.prep_tasks WHERE id = v_sub.task_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'forbidden_cross_owner';
  END IF;

  -- H7: guard re-verify
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

  RETURN jsonb_build_object('ok', true, 'decision', _decision);
END;
$function$;

-- H8: cegah double-submit
CREATE UNIQUE INDEX IF NOT EXISTS prep_submissions_active_per_task_item_uidx
  ON public.prep_submissions (task_item_id)
  WHERE verification_status IN ('pending','approved');

-- C2: RPC auto-link chat
CREATE OR REPLACE FUNCTION public.chat_link_business(
  _conv uuid,
  _kind text,
  _id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _kind NOT IN ('request_prep','ecer_prep','task','customer','product') THEN
    RAISE EXCEPTION 'invalid_kind';
  END IF;

  IF NOT public.is_conversation_member(_conv, v_uid) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  IF _kind = 'request_prep' THEN
    SELECT user_id INTO v_owner FROM public.request_preparations WHERE id = _id;
    IF v_owner IS NULL OR v_owner <> v_uid THEN RAISE EXCEPTION 'forbidden_target'; END IF;
    UPDATE public.conversations SET linked_request_prep_id = _id WHERE id = _conv;
  ELSIF _kind = 'ecer_prep' THEN
    SELECT user_id INTO v_owner FROM public.ecer_preparations WHERE id = _id;
    IF v_owner IS NULL OR v_owner <> v_uid THEN RAISE EXCEPTION 'forbidden_target'; END IF;
    UPDATE public.conversations SET linked_ecer_prep_id = _id WHERE id = _conv;
  ELSIF _kind = 'task' THEN
    SELECT owner_user_id INTO v_owner FROM public.prep_tasks WHERE id = _id;
    IF v_owner IS NULL OR v_owner <> v_uid THEN RAISE EXCEPTION 'forbidden_target'; END IF;
    UPDATE public.conversations SET linked_task_id = _id WHERE id = _conv;
  ELSIF _kind = 'customer' THEN
    SELECT user_id INTO v_owner FROM public.customers WHERE id = _id;
    IF v_owner IS NULL OR v_owner <> v_uid THEN RAISE EXCEPTION 'forbidden_target'; END IF;
    UPDATE public.conversations SET linked_customer_id = _id WHERE id = _conv;
  ELSIF _kind = 'product' THEN
    SELECT user_id INTO v_owner FROM public.warehouse_items WHERE id = _id;
    IF v_owner IS NULL OR v_owner <> v_uid THEN RAISE EXCEPTION 'forbidden_target'; END IF;
    UPDATE public.conversations SET linked_product_id = _id WHERE id = _conv;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.chat_link_business(uuid, text, uuid) TO authenticated;