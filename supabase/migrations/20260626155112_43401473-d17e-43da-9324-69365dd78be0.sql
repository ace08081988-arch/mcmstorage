CREATE OR REPLACE FUNCTION public.admin_list_users(_query text DEFAULT NULL, _limit int DEFAULT 50)
RETURNS TABLE (
  user_id    uuid,
  email      text,
  created_at timestamptz,
  is_admin   boolean,
  plan       text,
  status     text,
  period_end timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id                                              AS user_id,
    u.email::text                                     AS email,
    u.created_at                                      AS created_at,
    EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = u.id AND r.role = 'admin'
    )                                                 AS is_admin,
    COALESCE(s.plan, 'free')::text                    AS plan,
    COALESCE(s.status, 'none')::text                  AS status,
    s.period_end                                      AS period_end
  FROM auth.users u
  LEFT JOIN public.subscriptions s ON s.user_id = u.id
  WHERE _query IS NULL
     OR _query = ''
     OR u.email ILIKE ('%' || _query || '%')
  ORDER BY u.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 50), 200));
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_list_users(text, int) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.admin_list_users(text, int) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_set_admin_role(_target uuid, _grant boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _target IS NULL THEN
    RAISE EXCEPTION 'target_required' USING ERRCODE = '22023';
  END IF;

  -- Prevent an admin from demoting themself (avoids locking everyone
  -- out if there is only one admin).
  IF NOT _grant AND _target = v_caller THEN
    RAISE EXCEPTION 'cannot_demote_self' USING ERRCODE = '22023';
  END IF;

  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = _target AND role = 'admin';
  END IF;

  RETURN TRUE;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_admin_role(uuid, boolean) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.admin_set_admin_role(uuid, boolean) TO authenticated;