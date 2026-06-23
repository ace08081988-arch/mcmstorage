
-- ============================================================
-- 1. SETTINGS TABLE (singleton)
-- ============================================================
CREATE TABLE public.app_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  bank_name text NOT NULL DEFAULT 'BCA',
  bank_account_number text NOT NULL DEFAULT '0000000000',
  bank_account_holder text NOT NULL DEFAULT 'BAROKAH RIZKI',
  whatsapp_admin text NOT NULL DEFAULT '',
  pro_price_monthly_idr integer NOT NULL DEFAULT 99000,
  pro_price_yearly_idr integer NOT NULL DEFAULT 990000,
  trial_days integer NOT NULL DEFAULT 14,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_settings TO authenticated, anon;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read app_settings"
  ON public.app_settings FOR SELECT
  USING (true);

CREATE POLICY "admins can update app_settings"
  ON public.app_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER app_settings_set_updated
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.app_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. SUBSCRIPTIONS TABLE (one row per owner)
-- ============================================================
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  status text NOT NULL DEFAULT 'none' CHECK (status IN ('none','trialing','active','grace','expired')),
  billing_cycle text CHECK (billing_cycle IN ('monthly','yearly','trial','promo')),
  period_start timestamptz,
  period_end timestamptz,
  trial_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_user_idx ON public.subscriptions (user_id);
CREATE INDEX subscriptions_period_end_idx ON public.subscriptions (period_end) WHERE status IN ('trialing','active','grace');

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "admins read all subscriptions"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER subscriptions_set_updated
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3. SUBSCRIPTION PAYMENTS (proof of transfer queue)
-- ============================================================
CREATE TABLE public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_idr integer NOT NULL CHECK (amount_idr > 0),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  sender_name text NOT NULL,
  sender_bank text,
  transfer_date date NOT NULL,
  proof_path text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_payments_user_idx ON public.subscription_payments (user_id, created_at DESC);
CREATE INDEX subscription_payments_status_idx ON public.subscription_payments (status, created_at DESC);

GRANT SELECT, INSERT ON public.subscription_payments TO authenticated;
GRANT ALL ON public.subscription_payments TO service_role;

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own payment"
  ON public.subscription_payments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending' AND reviewed_by IS NULL);

CREATE POLICY "users read own payments"
  ON public.subscription_payments FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "admins read all payments"
  ON public.subscription_payments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER subscription_payments_set_updated
  BEFORE UPDATE ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 4. CORE FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_active_pro(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _uid
      AND plan = 'pro'
      AND status IN ('trialing','active','grace')
      AND (period_end IS NULL OR period_end > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.start_pro_trial()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_days int;
  v_existing public.subscriptions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT trial_days INTO v_days FROM public.app_settings WHERE id = true;
  v_days := COALESCE(v_days, 14);

  SELECT * INTO v_existing FROM public.subscriptions WHERE user_id = v_uid;

  IF v_existing.id IS NOT NULL AND v_existing.trial_used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'trial_already_used');
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.subscriptions(user_id, plan, status, billing_cycle, period_start, period_end, trial_used_at)
    VALUES (v_uid, 'pro', 'trialing', 'trial', now(), now() + (v_days || ' days')::interval, now());
  ELSE
    UPDATE public.subscriptions
       SET plan = 'pro',
           status = 'trialing',
           billing_cycle = 'trial',
           period_start = now(),
           period_end = now() + (v_days || ' days')::interval,
           trial_used_at = now()
     WHERE user_id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'period_end', now() + (v_days || ' days')::interval);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.subscriptions
       SET status = 'expired',
           plan = 'free'
     WHERE status IN ('trialing','active','grace')
       AND period_end IS NOT NULL
       AND period_end <= now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_payment(_payment_id uuid, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT * INTO v_sub FROM public.subscriptions WHERE user_id = v_pay.user_id FOR UPDATE;

  IF v_sub.id IS NULL THEN
    v_base := now();
    v_new_end := v_base + (v_extend_days || ' days')::interval;
    INSERT INTO public.subscriptions(user_id, plan, status, billing_cycle, period_start, period_end)
    VALUES (v_pay.user_id, 'pro', 'active', v_pay.billing_cycle, v_base, v_new_end);
  ELSE
    v_base := GREATEST(now(), COALESCE(v_sub.period_end, now()));
    v_new_end := v_base + (v_extend_days || ' days')::interval;
    UPDATE public.subscriptions
       SET plan = 'pro',
           status = 'active',
           billing_cycle = v_pay.billing_cycle,
           period_start = COALESCE(v_sub.period_start, now()),
           period_end = v_new_end
     WHERE user_id = v_pay.user_id;
  END IF;

  UPDATE public.subscription_payments
     SET status = 'approved',
         reviewed_by = v_uid,
         reviewed_at = now(),
         admin_note = COALESCE(_note, admin_note)
   WHERE id = _payment_id;

  RETURN jsonb_build_object('ok', true, 'period_end', v_new_end);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_payment(_payment_id uuid, _note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.subscription_payments
     SET status = 'rejected',
         reviewed_by = v_uid,
         reviewed_at = now(),
         admin_note = _note
   WHERE id = _payment_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found_or_already_reviewed');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============================================================
-- 5. FREE-TIER CAPS via BEFORE INSERT triggers
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_free_warehouse_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF public.has_active_pro(NEW.user_id) THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM public.warehouse_items WHERE user_id = NEW.user_id;
  IF v_count >= 30 THEN
    RAISE EXCEPTION 'pro_required:warehouse_items' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER warehouse_items_free_cap
  BEFORE INSERT ON public.warehouse_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_free_warehouse_cap();

CREATE OR REPLACE FUNCTION public.enforce_free_sales_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF public.has_active_pro(NEW.user_id) THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count
    FROM public.sales
   WHERE user_id = NEW.user_id
     AND created_at >= now() - interval '30 days';
  IF v_count >= 50 THEN
    RAISE EXCEPTION 'pro_required:sales' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sales_free_cap
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_free_sales_cap();

CREATE OR REPLACE FUNCTION public.enforce_free_staff_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF public.has_active_pro(NEW.user_id) THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM public.staff_contacts WHERE user_id = NEW.user_id;
  IF v_count >= 1 THEN
    RAISE EXCEPTION 'pro_required:staff_contacts' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_contacts_free_cap
  BEFORE INSERT ON public.staff_contacts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_free_staff_cap();

CREATE OR REPLACE FUNCTION public.enforce_free_devices_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF public.has_active_pro(NEW.user_id) THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM public.user_devices WHERE user_id = NEW.user_id;
  IF v_count >= 1 THEN
    RAISE EXCEPTION 'pro_required:user_devices' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_devices_free_cap
  BEFORE INSERT ON public.user_devices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_free_devices_cap();

-- ============================================================
-- 6. BACKFILL: 30-day Pro grace for every existing user
-- ============================================================
INSERT INTO public.subscriptions (user_id, plan, status, billing_cycle, period_start, period_end)
SELECT u.id, 'pro', 'active', 'promo', now(), now() + interval '30 days'
  FROM auth.users u
 WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status, billing_cycle)
  VALUES (NEW.id, 'free', 'none', NULL)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created_subscription ON auth.users;
CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();

-- ============================================================
-- 7. HOURLY pg_cron to expire stale subscriptions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$ BEGIN
  PERFORM cron.unschedule('expire-subscriptions-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'expire-subscriptions-hourly',
  '7 * * * *',
  $cron$ SELECT public.expire_subscriptions(); $cron$
);
