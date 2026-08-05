ALTER TABLE public.web_vital_alert_config
  ADD COLUMN IF NOT EXISTS email_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS telegram_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telegram_chat_id text,
  ADD COLUMN IF NOT EXISTS slack_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS slack_channel text;

ALTER TABLE public.web_vital_alerts
  ADD COLUMN IF NOT EXISTS telegram_status text,
  ADD COLUMN IF NOT EXISTS slack_status text;