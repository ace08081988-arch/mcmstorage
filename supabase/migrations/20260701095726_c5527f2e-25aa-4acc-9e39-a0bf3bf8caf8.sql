
DO $$ BEGIN
  CREATE TYPE public.friend_request_status AS ENUM ('pending','accepted','rejected','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.friend_request_status NOT NULL DEFAULT 'pending',
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_requests_no_self CHECK (from_user <> to_user)
);

CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pair_uidx
  ON public.friend_requests (from_user, to_user);
CREATE INDEX IF NOT EXISTS friend_requests_to_status_idx
  ON public.friend_requests (to_user, status);
CREATE INDEX IF NOT EXISTS friend_requests_from_status_idx
  ON public.friend_requests (from_user, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.friend_requests TO authenticated;
GRANT ALL ON public.friend_requests TO service_role;

ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fr_select_self" ON public.friend_requests;
CREATE POLICY "fr_select_self" ON public.friend_requests
  FOR SELECT TO authenticated
  USING (from_user = auth.uid() OR to_user = auth.uid());

DROP POLICY IF EXISTS "fr_insert_from_self" ON public.friend_requests;
CREATE POLICY "fr_insert_from_self" ON public.friend_requests
  FOR INSERT TO authenticated
  WITH CHECK (from_user = auth.uid());

DROP POLICY IF EXISTS "fr_update_participant" ON public.friend_requests;
CREATE POLICY "fr_update_participant" ON public.friend_requests
  FOR UPDATE TO authenticated
  USING (from_user = auth.uid() OR to_user = auth.uid())
  WITH CHECK (from_user = auth.uid() OR to_user = auth.uid());

DROP POLICY IF EXISTS "fr_delete_from_self" ON public.friend_requests;
CREATE POLICY "fr_delete_from_self" ON public.friend_requests
  FOR DELETE TO authenticated
  USING (from_user = auth.uid());

CREATE OR REPLACE FUNCTION public.tg_friend_requests_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS tg_friend_requests_touch ON public.friend_requests;
CREATE TRIGGER tg_friend_requests_touch
  BEFORE UPDATE ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_friend_requests_touch();

CREATE OR REPLACE FUNCTION public.are_friends(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND _a <> _b AND EXISTS (
    SELECT 1 FROM public.friend_requests fr
     WHERE fr.status = 'accepted'
       AND ((fr.from_user = _a AND fr.to_user = _b)
         OR (fr.from_user = _b AND fr.to_user = _a))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_chat(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND _a <> _b AND (
    public.are_friends(_a, _b)
    OR EXISTS (SELECT 1 FROM public.customers c WHERE (c.user_id=_a AND c.account_user_id=_b) OR (c.user_id=_b AND c.account_user_id=_a))
    OR EXISTS (SELECT 1 FROM public.suppliers s WHERE (s.user_id=_a AND s.account_user_id=_b) OR (s.user_id=_b AND s.account_user_id=_a))
  )
$$;

CREATE OR REPLACE FUNCTION public.send_friend_request(_code text)
RETURNS TABLE(
  request_id uuid,
  to_user uuid,
  display_name text,
  avatar_url text,
  status public.friend_request_status,
  was_existing boolean,
  already_friends boolean,
  incoming_reverse_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  target record;
  existing_row record;
  reverse_pending uuid;
  final_id uuid;
  final_status public.friend_request_status;
  was_ex boolean := false;
  is_friend boolean := false;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;

  SELECT p.id, p.display_name, p.avatar_url
    INTO target
    FROM public.profiles p
   WHERE upper(p.invite_code) = upper(coalesce(_code, ''))
     AND p.id <> me
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_code_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF public.are_friends(me, target.id) THEN
    SELECT fr.id, fr.status INTO existing_row
      FROM public.friend_requests fr
     WHERE ((fr.from_user = me AND fr.to_user = target.id)
         OR (fr.from_user = target.id AND fr.to_user = me))
       AND fr.status = 'accepted'
     ORDER BY fr.responded_at DESC NULLS LAST
     LIMIT 1;
    final_id := existing_row.id;
    final_status := 'accepted'::public.friend_request_status;
    was_ex := true;
    is_friend := true;
  ELSE
    SELECT fr.id INTO reverse_pending
      FROM public.friend_requests fr
     WHERE fr.from_user = target.id AND fr.to_user = me AND fr.status = 'pending'
     LIMIT 1;

    SELECT fr.id, fr.status INTO existing_row
      FROM public.friend_requests fr
     WHERE fr.from_user = me AND fr.to_user = target.id
     LIMIT 1;

    IF existing_row.id IS NOT NULL THEN
      was_ex := true;
      final_id := existing_row.id;
      IF existing_row.status IN ('rejected'::public.friend_request_status, 'cancelled'::public.friend_request_status) THEN
        UPDATE public.friend_requests
           SET status = 'pending'::public.friend_request_status, responded_at = NULL
         WHERE id = existing_row.id
         RETURNING status INTO final_status;
      ELSE
        final_status := existing_row.status;
      END IF;
    ELSE
      INSERT INTO public.friend_requests (from_user, to_user, status)
      VALUES (me, target.id, 'pending'::public.friend_request_status)
      RETURNING id, status INTO final_id, final_status;
    END IF;
  END IF;

  RETURN QUERY SELECT final_id, target.id, target.display_name, target.avatar_url,
                       final_status, was_ex, is_friend, reverse_pending;
END; $$;

CREATE OR REPLACE FUNCTION public.respond_friend_request(_request_id uuid, _accept boolean)
RETURNS TABLE(request_id uuid, status public.friend_request_status)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  row record;
  new_status public.friend_request_status;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;

  SELECT * INTO row FROM public.friend_requests WHERE id = _request_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF row.to_user <> me THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF row.status <> 'pending'::public.friend_request_status THEN
    RETURN QUERY SELECT row.id, row.status;
    RETURN;
  END IF;

  new_status := CASE WHEN _accept THEN 'accepted'::public.friend_request_status ELSE 'rejected'::public.friend_request_status END;

  UPDATE public.friend_requests
     SET status = new_status, responded_at = now()
   WHERE id = _request_id;

  IF _accept THEN
    INSERT INTO public.address_book (user_id, linked_user_id, name, source)
    VALUES
      (row.from_user, row.to_user, COALESCE((SELECT display_name FROM public.profiles WHERE id = row.to_user), 'Kontak'), 'invite'),
      (row.to_user, row.from_user, COALESCE((SELECT display_name FROM public.profiles WHERE id = row.from_user), 'Kontak'), 'invite')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY SELECT _request_id, new_status;
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_friend_request(_request_id uuid)
RETURNS TABLE(request_id uuid, status public.friend_request_status)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); row record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO row FROM public.friend_requests WHERE id = _request_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF row.from_user <> me THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF row.status <> 'pending'::public.friend_request_status THEN
    RETURN QUERY SELECT row.id, row.status;
    RETURN;
  END IF;

  UPDATE public.friend_requests
     SET status = 'cancelled'::public.friend_request_status, responded_at = now()
   WHERE id = _request_id;

  RETURN QUERY SELECT _request_id, 'cancelled'::public.friend_request_status;
END; $$;

CREATE OR REPLACE FUNCTION public.list_friend_requests(_direction text DEFAULT 'all', _only_pending boolean DEFAULT true)
RETURNS TABLE(
  id uuid,
  from_user uuid,
  to_user uuid,
  status public.friend_request_status,
  created_at timestamptz,
  responded_at timestamptz,
  direction text,
  peer_id uuid,
  peer_display_name text,
  peer_avatar_url text,
  peer_invite_code text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT auth.uid() AS uid)
  SELECT fr.id, fr.from_user, fr.to_user, fr.status, fr.created_at, fr.responded_at,
         CASE WHEN fr.from_user = (SELECT uid FROM me) THEN 'outgoing' ELSE 'incoming' END AS direction,
         CASE WHEN fr.from_user = (SELECT uid FROM me) THEN fr.to_user ELSE fr.from_user END AS peer_id,
         p.display_name AS peer_display_name,
         p.avatar_url   AS peer_avatar_url,
         p.invite_code  AS peer_invite_code
    FROM public.friend_requests fr
    JOIN public.profiles p
      ON p.id = CASE WHEN fr.from_user = (SELECT uid FROM me) THEN fr.to_user ELSE fr.from_user END
   WHERE ((SELECT uid FROM me) IN (fr.from_user, fr.to_user))
     AND ( _direction = 'all'
        OR (_direction = 'incoming' AND fr.to_user = (SELECT uid FROM me))
        OR (_direction = 'outgoing' AND fr.from_user = (SELECT uid FROM me)) )
     AND ( NOT _only_pending OR fr.status = 'pending'::public.friend_request_status )
   ORDER BY fr.created_at DESC;
$$;

-- Seed: pasangan address_book existing → dianggap sudah berteman.
INSERT INTO public.friend_requests (from_user, to_user, status, responded_at, created_at)
SELECT DISTINCT ab.user_id, ab.linked_user_id, 'accepted'::public.friend_request_status, now(), now()
  FROM public.address_book ab
 WHERE ab.linked_user_id IS NOT NULL
   AND ab.user_id <> ab.linked_user_id
ON CONFLICT (from_user, to_user) DO NOTHING;
