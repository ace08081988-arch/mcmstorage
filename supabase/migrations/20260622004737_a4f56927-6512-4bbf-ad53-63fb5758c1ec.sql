
CREATE OR REPLACE FUNCTION public.prep_reset_pin(_task_id uuid, _pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_uid uuid := auth.uid(); v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _pin IS NULL OR length(_pin) < 4 OR length(_pin) > 8 OR _pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'pin_invalid';
  END IF;
  SELECT owner_user_id INTO v_owner FROM public.prep_tasks WHERE id = _task_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.prep_tasks
    SET pin_hash = extensions.crypt(_pin, extensions.gen_salt('bf', 8))
    WHERE id = _task_id;
  RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION public.prep_reset_pin(uuid, text) TO authenticated;
