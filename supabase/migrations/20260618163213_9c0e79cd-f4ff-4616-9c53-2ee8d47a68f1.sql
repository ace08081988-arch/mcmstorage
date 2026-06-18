-- Tabel device terpercaya per user
CREATE TABLE public.user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_hash text NOT NULL,
  label text,
  last_ip text,
  last_user_agent text,
  trusted_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_hash)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_devices TO authenticated;
GRANT ALL ON public.user_devices TO service_role;

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own devices"
  ON public.user_devices FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_user_devices_updated_at
  BEFORE UPDATE ON public.user_devices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabel tantangan OTP device
CREATE TABLE public.device_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_hash text NOT NULL,
  code_hash text NOT NULL,
  attempts smallint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  last_ip text,
  last_user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_otp_challenges TO authenticated;
GRANT ALL ON public.device_otp_challenges TO service_role;

ALTER TABLE public.device_otp_challenges ENABLE ROW LEVEL SECURITY;

-- User hanya boleh melihat challenge miliknya (untuk debugging); semua mutasi via server fn dgn service role
CREATE POLICY "Users read own otp challenges"
  ON public.device_otp_challenges FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX idx_device_otp_challenges_user_active
  ON public.device_otp_challenges (user_id, device_hash, expires_at);
