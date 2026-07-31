
CREATE OR REPLACE FUNCTION public.prevent_debt_overpayment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debt_amount numeric(14,2);
  v_paid_total  numeric(14,2);
  v_debt_id     uuid;
BEGIN
  v_debt_id := COALESCE(NEW.debt_id, OLD.debt_id);
  SELECT amount INTO v_debt_amount FROM public.debts WHERE id = v_debt_id;
  IF v_debt_amount IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
    FROM public.debt_payments WHERE debt_id = v_debt_id;
  IF v_paid_total > v_debt_amount THEN
    RAISE EXCEPTION 'Total pembayaran (%) melebihi jumlah utang (%). Sisa tidak boleh negatif.',
      v_paid_total, v_debt_amount USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_debt_overpayment ON public.debt_payments;
CREATE CONSTRAINT TRIGGER trg_prevent_debt_overpayment
  AFTER INSERT OR UPDATE ON public.debt_payments
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION public.prevent_debt_overpayment();

CREATE OR REPLACE FUNCTION public.prevent_debt_amount_below_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid_total numeric(14,2);
BEGIN
  IF NEW.amount = OLD.amount THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
    FROM public.debt_payments WHERE debt_id = NEW.id;
  IF NEW.amount < v_paid_total THEN
    RAISE EXCEPTION 'Jumlah utang (%) tidak boleh lebih kecil dari total yang sudah dibayar (%).',
      NEW.amount, v_paid_total USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_debt_amount_below_paid ON public.debts;
CREATE TRIGGER trg_prevent_debt_amount_below_paid
  BEFORE UPDATE OF amount ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_debt_amount_below_paid();

ALTER TABLE public.customer_payments
  DROP CONSTRAINT IF EXISTS customer_payments_customer_id_fkey;
ALTER TABLE public.customer_payments
  ADD CONSTRAINT customer_payments_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

ALTER TABLE public.request_title_items
  DROP CONSTRAINT IF EXISTS request_title_items_warehouse_item_id_fkey;
ALTER TABLE public.request_title_items
  ADD CONSTRAINT request_title_items_warehouse_item_id_fkey
  FOREIGN KEY (warehouse_item_id) REFERENCES public.warehouse_items(id) ON DELETE RESTRICT;

ALTER TABLE public.request_preparation_items
  DROP CONSTRAINT IF EXISTS request_preparation_items_warehouse_item_id_fkey;
ALTER TABLE public.request_preparation_items
  ADD CONSTRAINT request_preparation_items_warehouse_item_id_fkey
  FOREIGN KEY (warehouse_item_id) REFERENCES public.warehouse_items(id) ON DELETE RESTRICT;

UPDATE public.user_devices
SET device_hash = 'v2:' || encode(
  digest('v2wrap:' || user_id::text || ':' || device_hash, 'sha256'),
  'hex'
)
WHERE device_hash IS NOT NULL AND device_hash NOT LIKE 'v2:%';

UPDATE public.device_otp_challenges
SET device_hash = 'v2:' || encode(
  digest('v2wrap:' || user_id::text || ':' || device_hash, 'sha256'),
  'hex'
)
WHERE device_hash IS NOT NULL
  AND device_hash NOT LIKE 'v2:%'
  AND consumed_at IS NULL;
