CREATE OR REPLACE FUNCTION public.party_balance_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH
  manual AS (
    SELECT
      lower(regexp_replace(btrim(d.party_name), '\s+', ' ', 'g')) AS key,
      max(d.party_name) AS name,
      COALESCE(SUM(CASE WHEN d.kind = 'hutang'
        THEN GREATEST(d.amount - COALESCE(p.paid, 0), 0) ELSE 0 END), 0) AS hutang,
      COALESCE(SUM(CASE WHEN d.kind = 'piutang'
        THEN GREATEST(d.amount - COALESCE(p.paid, 0), 0) ELSE 0 END), 0) AS piutang
    FROM public.debts d
    LEFT JOIN (
      SELECT debt_id, SUM(amount) AS paid
      FROM public.debt_payments
      WHERE user_id = auth.uid()
      GROUP BY debt_id
    ) p ON p.debt_id = d.id
    WHERE d.user_id = auth.uid()
      AND btrim(d.party_name) <> ''
    GROUP BY 1
  ),
  sales_side AS (
    SELECT
      lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) AS key,
      max(c.name) AS name,
      0::numeric AS hutang,
      GREATEST(
        COALESCE(SUM(s.total_revenue), 0)
        - COALESCE(max(cp.paid), 0), 0) AS piutang
    FROM public.sales s
    JOIN public.customers c ON c.id = s.customer_id
    LEFT JOIN (
      SELECT customer_id, SUM(amount) AS paid
      FROM public.customer_payments
      WHERE user_id = auth.uid()
      GROUP BY customer_id
    ) cp ON cp.customer_id = s.customer_id
    WHERE s.user_id = auth.uid()
      AND s.payment_method = 'hutang'
    GROUP BY 1
  ),
  purchase_side AS (
    SELECT
      lower(regexp_replace(btrim(su.name), '\s+', ' ', 'g')) AS key,
      max(su.name) AS name,
      GREATEST(
        COALESCE(SUM(pu.total_cost), 0)
        - COALESCE(max(sp.paid), 0), 0) AS hutang,
      0::numeric AS piutang
    FROM public.purchases pu
    JOIN public.suppliers su ON su.id = pu.supplier_id
    LEFT JOIN (
      SELECT supplier_id, SUM(amount) AS paid
      FROM public.supplier_payments
      WHERE user_id = auth.uid()
      GROUP BY supplier_id
    ) sp ON sp.supplier_id = pu.supplier_id
    WHERE pu.user_id = auth.uid()
      AND pu.payment_method = 'hutang'
    GROUP BY 1
  ),
  merged AS (
    SELECT * FROM manual
    UNION ALL SELECT * FROM sales_side
    UNION ALL SELECT * FROM purchase_side
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'key', key,
    'name', name,
    'hutang', hutang,
    'piutang', piutang
  )), '[]'::jsonb)
  FROM (
    SELECT key, max(name) AS name, SUM(hutang) AS hutang, SUM(piutang) AS piutang
    FROM merged
    WHERE key IS NOT NULL AND key <> ''
    GROUP BY key
  ) agg;
$function$;

REVOKE ALL ON FUNCTION public.party_balance_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.party_balance_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.party_balance_v1() TO service_role;