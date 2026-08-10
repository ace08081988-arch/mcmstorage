-- 1) Sumber langganan + isolasi lingkungan -------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'paddle';

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_source_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_source_check
  CHECK (source = ANY (ARRAY['paddle','manual','promo']));

-- Baris lama yang belum pernah lewat penyedia pembayaran adalah baris nyata.
UPDATE public.subscriptions
   SET environment = 'live',
       source = CASE WHEN paddle_subscription_id IS NULL THEN 'manual' ELSE source END
 WHERE paddle_subscription_id IS NULL;

ALTER TABLE public.subscriptions ALTER COLUMN environment SET DEFAULT 'live';

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_env_key
  ON public.subscriptions (user_id, environment);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_paddle_sub_key
  ON public.subscriptions (paddle_subscription_id)
  WHERE paddle_subscription_id IS NOT NULL;

-- 2) Baris default saat pendaftaran -------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status, billing_cycle, environment, source)
  VALUES (NEW.id, 'free', 'none', NULL, 'live', 'manual')
  ON CONFLICT (user_id, environment) DO NOTHING;
  RETURN NEW;
END $function$;

-- 3) Cek akses Pro sadar lingkungan -------------------------------------
DROP FUNCTION IF EXISTS public.has_active_pro(uuid);

CREATE OR REPLACE FUNCTION public.has_active_pro(_uid uuid, _env text DEFAULT 'live')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _uid
      AND plan = 'pro'
      AND status IN ('trialing','active','grace')
      AND (period_end IS NULL OR period_end > now())
      -- Langganan kartu hanya berlaku di lingkungannya sendiri.
      -- Transfer manual / promo berlaku di kedua lingkungan.
      AND (source <> 'paddle' OR environment = COALESCE(_env, 'live'))
  );
$function$;

-- 4) Kedaluwarsa dengan jeda konfirmasi ---------------------------------
CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.subscriptions
       SET status = 'expired',
           plan = 'free',
           updated_at = now()
     WHERE status IN ('trialing','active','grace')
       AND period_end IS NOT NULL
       AND period_end <= now() - CASE
             WHEN source = 'paddle' THEN interval '2 days'  -- jeda webhook telat
             ELSE interval '0 days'
           END
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;

  -- Langganan yang dijeda tanpa tanggal akhir tidak boleh Pro selamanya.
  UPDATE public.subscriptions
     SET status = 'expired', plan = 'free', updated_at = now()
   WHERE status = 'grace'
     AND period_end IS NULL
     AND updated_at <= now() - interval '30 days';

  RETURN v_count;
END;
$function$;

-- 5) Persetujuan transfer manual ----------------------------------------
CREATE OR REPLACE FUNCTION public.admin_approve_payment(_payment_id uuid, _note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pay public.subscription_payments%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_extend_days int;
  v_base timestamptz;
  v_new_end timestamptz;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_pay FROM public.subscription_payments WHERE id = _payment_id FOR UPDATE;
  IF v_pay.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_pay.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_reviewed', 'status', v_pay.status);
  END IF;

  v_extend_days := CASE v_pay.billing_cycle WHEN 'monthly' THEN 30 WHEN 'yearly' THEN 365 ELSE 30 END;

  SELECT * INTO v_sub FROM public.subscriptions
   WHERE user_id = v_pay.user_id AND environment = 'live' FOR UPDATE;

  IF v_sub.id IS NULL THEN
    v_base := now();
    v_new_end := v_base + (v_extend_days || ' days')::interval;
    INSERT INTO public.subscriptions(user_id, plan, status, billing_cycle, period_start, period_end, environment, source)
    VALUES (v_pay.user_id, 'pro', 'active', v_pay.billing_cycle, v_base, v_new_end, 'live', 'manual');
  ELSE
    v_base := GREATEST(now(), COALESCE(v_sub.period_end, now()));
    v_new_end := v_base + (v_extend_days || ' days')::interval;
    UPDATE public.subscriptions
       SET plan = 'pro',
           status = 'active',
           billing_cycle = v_pay.billing_cycle,
           source = 'manual',
           period_start = COALESCE(v_sub.period_start, now()),
           period_end = v_new_end,
           updated_at = now()
     WHERE id = v_sub.id;
  END IF;

  UPDATE public.subscription_payments
     SET status = 'approved',
         reviewed_by = v_uid,
         reviewed_at = now(),
         admin_note = COALESCE(_note, admin_note),
         updated_at = now()
   WHERE id = _payment_id;

  RETURN jsonb_build_object('ok', true, 'period_end', v_new_end);
END;
$function$;

-- 6) Riwayat pembayaran --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  environment text NOT NULL DEFAULT 'live',
  paddle_transaction_id text,
  paddle_subscription_id text,
  price_id text,
  amount text,
  currency_code text,
  invoice_url text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscription_events_txn_kind_key
  ON public.subscription_events (paddle_transaction_id, kind)
  WHERE paddle_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscription_events_user_idx
  ON public.subscription_events (user_id, occurred_at DESC);

GRANT SELECT ON public.subscription_events TO authenticated;
GRANT ALL ON public.subscription_events TO service_role;

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own subscription events"
  ON public.subscription_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "admins read all subscription events"
  ON public.subscription_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));