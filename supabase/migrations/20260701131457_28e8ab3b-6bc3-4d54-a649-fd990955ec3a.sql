CREATE OR REPLACE FUNCTION public.tg_friend_requests_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  is_definer boolean;
  ctx text;
BEGIN
  NEW.updated_at := now();
  is_definer := current_user <> 'authenticated';

  -- Konteks yang dilampirkan ke setiap RAISE untuk debugging CI.
  ctx := format(
    'req_id=%s actor=%s role=%s from_user=%s to_user=%s old_status=%s new_status=%s',
    COALESCE(OLD.id::text,'?'),
    COALESCE(me::text,'<null>'),
    current_user,
    COALESCE(OLD.from_user::text,'?'),
    COALESCE(OLD.to_user::text,'?'),
    COALESCE(OLD.status::text,'?'),
    COALESCE(NEW.status::text,'?')
  );

  -- Invariant 1: participants tidak boleh berubah.
  IF NEW.from_user IS DISTINCT FROM OLD.from_user
     OR NEW.to_user IS DISTINCT FROM OLD.to_user THEN
    RAISE EXCEPTION
      'friend_requests guard: participants are immutable (attempted from_user %→%, to_user %→%)',
      OLD.from_user, NEW.from_user, OLD.to_user, NEW.to_user
      USING
        ERRCODE = 'check_violation',
        DETAIL  = ctx,
        HINT    = 'from_user and to_user cannot be changed after INSERT. Cancel and create a new request instead.';
  END IF;

  IF NOT is_definer THEN
    IF me IS NULL THEN
      RAISE EXCEPTION 'friend_requests guard: unauthenticated UPDATE denied'
        USING
          ERRCODE = 'insufficient_privilege',
          DETAIL  = ctx,
          HINT    = 'Client must be signed in (auth.uid() must be set) to update friend_requests.';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IN ('accepted','rejected') THEN
        IF me <> OLD.to_user THEN
          RAISE EXCEPTION
            'friend_requests guard: only the recipient may set status=% (actor % is not to_user %)',
            NEW.status, me, OLD.to_user
            USING
              ERRCODE = 'insufficient_privilege',
              DETAIL  = ctx,
              HINT    = 'auth.uid() must equal to_user. Use respond_friend_request RPC instead of raw UPDATE.';
        END IF;
        IF OLD.status <> 'pending' THEN
          RAISE EXCEPTION
            'friend_requests guard: cannot transition status from % to % (only pending→% is allowed)',
            OLD.status, NEW.status, NEW.status
            USING
              ERRCODE = 'check_violation',
              DETAIL  = ctx,
              HINT    = 'Status transitions are one-way from pending. This request is already resolved.';
        END IF;

      ELSIF NEW.status = 'cancelled' THEN
        IF me <> OLD.from_user THEN
          RAISE EXCEPTION
            'friend_requests guard: only the sender may cancel (actor % is not from_user %)',
            me, OLD.from_user
            USING
              ERRCODE = 'insufficient_privilege',
              DETAIL  = ctx,
              HINT    = 'auth.uid() must equal from_user. Use cancel_friend_request RPC instead of raw UPDATE.';
        END IF;
        IF OLD.status <> 'pending' THEN
          RAISE EXCEPTION
            'friend_requests guard: can only cancel pending requests (current status=%)',
            OLD.status
            USING
              ERRCODE = 'check_violation',
              DETAIL  = ctx,
              HINT    = 'A non-pending request cannot be cancelled. It has already been resolved.';
        END IF;

      ELSE
        RAISE EXCEPTION
          'friend_requests guard: invalid status transition to % (allowed: accepted, rejected, cancelled)',
          NEW.status
          USING
            ERRCODE = 'check_violation',
            DETAIL  = ctx,
            HINT    = 'Only recipient can set accepted/rejected; only sender can set cancelled.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;