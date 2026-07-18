CREATE OR REPLACE FUNCTION public.hutang_summary_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH
    purchase_hutang AS (
      SELECT COALESCE(SUM(total_cost), 0)::numeric AS v
      FROM public.purchases
      WHERE user_id = auth.uid()
        AND payment_method = 'hutang'
    ),
    purchase_paid AS (
      SELECT COALESCE(SUM(amount), 0)::numeric AS v
      FROM public.supplier_payments
      WHERE user_id = auth.uid()
    ),
    hutang_manual AS (
      SELECT COALESCE(SUM(amount), 0)::numeric AS v
      FROM public.debts
      WHERE user_id = auth.uid()
        AND kind = 'hutang'
    ),
    hutang_manual_paid AS (
      SELECT COALESCE(SUM(dp.amount), 0)::numeric AS v
      FROM public.debt_payments dp
      JOIN public.debts d ON d.id = dp.debt_id
      WHERE dp.user_id = auth.uid()
        AND d.kind = 'hutang'
    )
  SELECT jsonb_build_object(
    'purchase_hutang_gross', (SELECT v FROM purchase_hutang),
    'purchase_hutang_paid',  (SELECT v FROM purchase_paid),
    'manual_gross',          (SELECT v FROM hutang_manual),
    'manual_paid',           (SELECT v FROM hutang_manual_paid),
    'total_outstanding',
      GREATEST((SELECT v FROM purchase_hutang) - (SELECT v FROM purchase_paid), 0)
      + GREATEST((SELECT v FROM hutang_manual) - (SELECT v FROM hutang_manual_paid), 0)
  );
$$;

GRANT EXECUTE ON FUNCTION public.hutang_summary_v1() TO authenticated;