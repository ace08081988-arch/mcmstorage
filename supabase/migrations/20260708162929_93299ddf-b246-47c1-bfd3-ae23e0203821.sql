
-- prep_submissions verification
ALTER TABLE public.prep_submissions
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.prep_submissions
  DROP CONSTRAINT IF EXISTS prep_submissions_verification_status_chk;
ALTER TABLE public.prep_submissions
  ADD CONSTRAINT prep_submissions_verification_status_chk
  CHECK (verification_status IN ('pending','approved','rejected'));

CREATE INDEX IF NOT EXISTS idx_prep_submissions_verification_status
  ON public.prep_submissions(verification_status);

-- request_preparations verification (default approved for legacy rows)
ALTER TABLE public.request_preparations
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.request_preparations
  DROP CONSTRAINT IF EXISTS request_preparations_verification_status_chk;
ALTER TABLE public.request_preparations
  ADD CONSTRAINT request_preparations_verification_status_chk
  CHECK (verification_status IN ('pending','approved','rejected'));

CREATE INDEX IF NOT EXISTS idx_request_preparations_verification_status
  ON public.request_preparations(verification_status);

-- ecer_preparations verification (default approved for legacy rows)
ALTER TABLE public.ecer_preparations
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.ecer_preparations
  DROP CONSTRAINT IF EXISTS ecer_preparations_verification_status_chk;
ALTER TABLE public.ecer_preparations
  ADD CONSTRAINT ecer_preparations_verification_status_chk
  CHECK (verification_status IN ('pending','approved','rejected'));

CREATE INDEX IF NOT EXISTS idx_ecer_preparations_verification_status
  ON public.ecer_preparations(verification_status);

-- Admin RPC to approve/reject an employee submission.
-- Approve: mark submission approved + cascade to request_preparations / ecer_preparations
--          rows linked via prep_task_item_id (verification_status='approved', ready_at=now()).
-- Reject:  mark submission rejected with reason; do NOT touch preparations.
CREATE OR REPLACE FUNCTION public.prep_submission_verify(
  _submission_id uuid,
  _decision text,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.prep_submissions%ROWTYPE;
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

  UPDATE public.prep_submissions
     SET verification_status = _decision,
         verified_at = now(),
         verified_by = v_uid,
         rejection_reason = CASE WHEN _decision = 'rejected' THEN _reason ELSE NULL END
   WHERE id = _submission_id;

  IF _decision = 'approved' AND v_sub.task_item_id IS NOT NULL THEN
    UPDATE public.request_preparations
       SET verification_status = 'approved',
           verified_at = now(),
           verified_by = v_uid,
           ready_at = COALESCE(ready_at, now())
     WHERE prep_task_item_id = v_sub.task_item_id
       AND verification_status <> 'approved';

    UPDATE public.ecer_preparations
       SET verification_status = 'approved',
           verified_at = now(),
           verified_by = v_uid,
           ready_at = COALESCE(ready_at, now())
     WHERE prep_task_item_id = v_sub.task_item_id
       AND verification_status <> 'approved';
  END IF;

  RETURN jsonb_build_object('ok', true, 'decision', _decision);
END;
$$;

GRANT EXECUTE ON FUNCTION public.prep_submission_verify(uuid, text, text) TO authenticated;
