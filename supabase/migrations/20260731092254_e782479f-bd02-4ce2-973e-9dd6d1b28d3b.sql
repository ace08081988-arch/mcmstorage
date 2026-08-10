ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paddle_subscription_id text,
  ADD COLUMN IF NOT EXISTS paddle_customer_id text,
  ADD COLUMN IF NOT EXISTS price_id text,
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_paddle_sub_id_key
  ON public.subscriptions(paddle_subscription_id)
  WHERE paddle_subscription_id IS NOT NULL;

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;