ALTER TABLE public.device_otp_challenges ADD COLUMN IF NOT EXISTS otp_message_id text;
CREATE INDEX IF NOT EXISTS idx_device_otp_challenges_msg ON public.device_otp_challenges(otp_message_id);

REVOKE EXECUTE ON FUNCTION public.prep_pin_locked_until(text) FROM PUBLIC, anon, authenticated;