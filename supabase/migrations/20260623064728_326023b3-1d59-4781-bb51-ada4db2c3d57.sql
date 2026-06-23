CREATE TABLE IF NOT EXISTS public.security_scan_hook_secrets (
  hook_name TEXT PRIMARY KEY,
  hook_secret TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.security_scan_hook_secrets TO service_role;
ALTER TABLE public.security_scan_hook_secrets ENABLE ROW LEVEL SECURITY;

INSERT INTO public.security_scan_hook_secrets (hook_name)
VALUES ('security-scan-daily')
ON CONFLICT (hook_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_security_scan_hook_secret_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_security_scan_hook_secrets_updated_at ON public.security_scan_hook_secrets;
CREATE TRIGGER update_security_scan_hook_secrets_updated_at
  BEFORE UPDATE ON public.security_scan_hook_secrets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_security_scan_hook_secret_updated_at();

SELECT cron.unschedule('security-scan-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'security-scan-daily');

SELECT cron.schedule(
  'security-scan-daily',
  '0 23 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--b29d53bc-658a-4d86-8c6c-32fdd495b32b.lovable.app/api/public/hooks/security-scan-daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', (
        SELECT hook_secret
        FROM public.security_scan_hook_secrets
        WHERE hook_name = 'security-scan-daily'
      )
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);