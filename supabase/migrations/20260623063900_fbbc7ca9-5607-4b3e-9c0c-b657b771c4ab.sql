
CREATE TABLE public.security_ack_rate_limit (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  called_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.security_ack_rate_limit TO authenticated;
GRANT ALL ON public.security_ack_rate_limit TO service_role;
ALTER TABLE public.security_ack_rate_limit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users view own ack rate limit"
  ON public.security_ack_rate_limit FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
CREATE INDEX security_ack_rate_limit_user_time_idx
  ON public.security_ack_rate_limit (user_id, called_at DESC);

CREATE OR REPLACE FUNCTION public.check_acknowledge_rate_limit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_window_start timestamptz := now() - interval '60 seconds';
  v_count int;
  v_oldest timestamptz;
  v_limit int := 10;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Bersihkan catatan lama agar tabel tidak membengkak (best-effort).
  DELETE FROM public.security_ack_rate_limit
    WHERE user_id = v_uid AND called_at < now() - interval '10 minutes';

  SELECT count(*), min(called_at)
    INTO v_count, v_oldest
    FROM public.security_ack_rate_limit
   WHERE user_id = v_uid AND called_at >= v_window_start;

  IF v_count >= v_limit THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'rate_limited',
      'limit', v_limit,
      'retry_after_seconds',
        greatest(1, ceil(extract(epoch from (v_oldest + interval '60 seconds' - now()))))::int
    );
  END IF;

  INSERT INTO public.security_ack_rate_limit(user_id) VALUES (v_uid);
  RETURN jsonb_build_object('ok', true, 'remaining', v_limit - v_count - 1);
END;
$$;

REVOKE ALL ON FUNCTION public.check_acknowledge_rate_limit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_acknowledge_rate_limit() TO authenticated;
