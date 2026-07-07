ALTER TABLE public.signup_attempts
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS failure_details text;

CREATE INDEX IF NOT EXISTS signup_attempts_failure_code_idx
  ON public.signup_attempts (failure_code)
  WHERE failure_code IS NOT NULL;

COMMENT ON COLUMN public.signup_attempts.failure_code IS
  'Kode kegagalan yang dilaporkan server (captcha_failed, captcha_missing, rate_limited, email_exists, weak_password, server_error). NULL untuk percobaan yang sukses.';
COMMENT ON COLUMN public.signup_attempts.failure_details IS
  'Detail bebas — untuk captcha_failed, berisi daftar error-codes dari Cloudflare Turnstile.';