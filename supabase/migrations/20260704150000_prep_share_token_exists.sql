-- Admin-only helper to verify apakah share_token untuk tugas pegawai sudah dipakai.
-- SECURITY DEFINER agar bisa lolos RLS prep_tasks (owner-scoped) tanpa membocorkan
-- data lain: hanya mengembalikan boolean.
CREATE OR REPLACE FUNCTION public.prep_share_token_exists(_token text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _token IS NULL OR length(btrim(_token)) < 8 THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.prep_tasks WHERE share_token = _token);
END;
$$;

REVOKE ALL ON FUNCTION public.prep_share_token_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prep_share_token_exists(text) TO authenticated;
