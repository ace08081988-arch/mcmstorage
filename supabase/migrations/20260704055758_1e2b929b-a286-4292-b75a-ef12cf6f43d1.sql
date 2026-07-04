
CREATE TABLE public.signup_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  email TEXT,
  succeeded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_signup_attempts_ip_time ON public.signup_attempts (ip, created_at DESC);

GRANT ALL ON public.signup_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.signup_attempts_id_seq TO service_role;

ALTER TABLE public.signup_attempts ENABLE ROW LEVEL SECURITY;

-- Tidak ada policy untuk anon/authenticated: hanya service_role (server function) yang mengaksesnya.

CREATE OR REPLACE FUNCTION public.check_and_record_signup_attempt(
  p_ip TEXT,
  p_email TEXT,
  p_limit INT DEFAULT 12,
  p_window INTERVAL DEFAULT INTERVAL '1 hour'
)
RETURNS TABLE(allowed BOOLEAN, attempts_in_window INT, retry_after_seconds INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_oldest TIMESTAMPTZ;
BEGIN
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

  INSERT INTO public.signup_attempts (ip, email) VALUES (p_ip, p_email);

  RETURN QUERY SELECT true, v_count + 1, 0;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_record_signup_attempt(TEXT, TEXT, INT, INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_record_signup_attempt(TEXT, TEXT, INT, INTERVAL) TO service_role;

-- Housekeeping: hapus catatan lama otomatis via query cron nanti bila perlu; untuk sekarang biarkan (kolomnya kecil).
