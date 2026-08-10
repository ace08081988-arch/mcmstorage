-- 1) Tambah kolom user_agent (nullable — legacy row tetap valid)
ALTER TABLE public.signup_attempts
  ADD COLUMN IF NOT EXISTS user_agent text;

-- 2) Perbarui fungsi rate-limit agar mencatat user agent bila disediakan.
-- Tanda tangan diperluas dengan p_user_agent default NULL supaya pemanggil
-- lama (tanpa argumen tersebut) tetap berfungsi. Perlu drop dulu karena
-- menambah parameter default mengubah signature yang dipakai GRANT.
DROP FUNCTION IF EXISTS public.check_and_record_signup_attempt(text, text, integer, interval);

CREATE OR REPLACE FUNCTION public.check_and_record_signup_attempt(
  p_ip text,
  p_email text,
  p_limit integer DEFAULT 12,
  p_window interval DEFAULT '01:00:00'::interval,
  p_user_agent text DEFAULT NULL
)
RETURNS TABLE(allowed boolean, attempts_in_window integer, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT;
  v_oldest TIMESTAMPTZ;
  v_ua text;
BEGIN
  -- Batasi panjang user agent agar tidak dipakai untuk membanjiri storage.
  v_ua := NULLIF(btrim(COALESCE(p_user_agent, '')), '');
  IF v_ua IS NOT NULL AND length(v_ua) > 512 THEN
    v_ua := left(v_ua, 512);
  END IF;

  SELECT COUNT(*), MIN(created_at)
    INTO v_count, v_oldest
  FROM public.signup_attempts
  WHERE ip = p_ip
    AND created_at > now() - p_window;

  IF v_count >= p_limit THEN
    RETURN QUERY SELECT
      false,
      v_count,
      GREATEST(1, EXTRACT(EPOCH FROM (v_oldest + p_window - now()))::INT);
    RETURN;
  END IF;

  INSERT INTO public.signup_attempts (ip, email, user_agent)
  VALUES (p_ip, p_email, v_ua);

  RETURN QUERY SELECT true, v_count + 1, 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_and_record_signup_attempt(text, text, integer, interval, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_record_signup_attempt(text, text, integer, interval, text) TO service_role;