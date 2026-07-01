
-- Defense-in-depth: trigger memvalidasi setiap UPDATE ke friend_requests.
-- Meski RLS policy sudah membatasi, trigger ini mengunci invariants
-- bahkan untuk jalur SECURITY DEFINER agar tidak bisa "self-accept".

CREATE OR REPLACE FUNCTION public.tg_friend_requests_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  is_definer boolean;
BEGIN
  -- Selalu refresh updated_at (menggantikan tg_friend_requests_touch)
  NEW.updated_at := now();

  -- Deteksi apakah dieksekusi via SECURITY DEFINER RPC tepercaya.
  -- RPC (send/respond/cancel_friend_request) berjalan sebagai owner,
  -- sehingga current_user != 'authenticated'. Kalau dari klien biasa,
  -- current_user = 'authenticated' dan auth.uid() != NULL.
  is_definer := current_user <> 'authenticated';

  -- Invariant 1: participants tidak boleh berubah
  IF NEW.from_user IS DISTINCT FROM OLD.from_user
     OR NEW.to_user IS DISTINCT FROM OLD.to_user THEN
    RAISE EXCEPTION 'friend_requests: participants are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Untuk jalur klien langsung (bukan RPC definer), tegakkan aturan aktor.
  IF NOT is_definer THEN
    IF me IS NULL THEN
      RAISE EXCEPTION 'friend_requests: unauthenticated update denied'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      -- Hanya recipient boleh accept/reject
      IF NEW.status IN ('accepted','rejected') THEN
        IF me <> OLD.to_user THEN
          RAISE EXCEPTION 'friend_requests: only recipient (to_user) may set status=%', NEW.status
            USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF OLD.status <> 'pending' THEN
          RAISE EXCEPTION 'friend_requests: cannot transition from % to %', OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
        END IF;

      -- Hanya sender boleh cancel
      ELSIF NEW.status = 'cancelled' THEN
        IF me <> OLD.from_user THEN
          RAISE EXCEPTION 'friend_requests: only sender (from_user) may cancel'
            USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF OLD.status <> 'pending' THEN
          RAISE EXCEPTION 'friend_requests: can only cancel pending requests'
            USING ERRCODE = 'check_violation';
        END IF;

      ELSE
        RAISE EXCEPTION 'friend_requests: invalid status transition to %', NEW.status
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Ganti trigger lama dengan versi yang menegakkan invariants
DROP TRIGGER IF EXISTS tg_friend_requests_touch ON public.friend_requests;
DROP TRIGGER IF EXISTS tg_friend_requests_guard ON public.friend_requests;

CREATE TRIGGER tg_friend_requests_guard
BEFORE UPDATE ON public.friend_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_friend_requests_guard();
