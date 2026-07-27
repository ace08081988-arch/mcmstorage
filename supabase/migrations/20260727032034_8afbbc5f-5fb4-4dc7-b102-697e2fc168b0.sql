CREATE OR REPLACE FUNCTION public.party_balance_events_v1(p_limit integer DEFAULT 300, p_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH ev AS (
    -- Catatan manual / turunan (debts)
    SELECT
      lower(regexp_replace(btrim(d.party_name), '\s+', ' ', 'g')) AS key,
      d.party_name AS name,
      d.kind AS kind,
      d.amount AS delta,
      'debts'::text AS source_table,
      d.source AS source,
      d.created_at AS at,
      d.note AS note,
      d.id AS ref_id
    FROM public.debts d
    WHERE d.user_id = auth.uid() AND btrim(d.party_name) <> ''

    UNION ALL
    -- Pembayaran atas catatan manual
    SELECT
      lower(regexp_replace(btrim(d.party_name), '\s+', ' ', 'g')),
      d.party_name,
      d.kind,
      -dp.amount,
      'debt_payments',
      'payment',
      dp.created_at,
      dp.note,
      dp.id
    FROM public.debt_payments dp
    JOIN public.debts d ON d.id = dp.debt_id
    WHERE dp.user_id = auth.uid() AND btrim(d.party_name) <> ''

    UNION ALL
    -- Penjualan hutang (piutang naik)
    SELECT
      lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')),
      c.name,
      'piutang',
      s.total_revenue,
      'sales',
      'sale',
      s.created_at,
      s.note,
      s.id
    FROM public.sales s
    JOIN public.customers c ON c.id = s.customer_id
    WHERE s.user_id = auth.uid() AND s.payment_method = 'hutang'

    UNION ALL
    -- Pembayaran pelanggan (piutang turun)
    SELECT
      lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')),
      c.name,
      'piutang',
      -cp.amount,
      'customer_payments',
      'payment',
      cp.created_at,
      cp.note,
      cp.id
    FROM public.customer_payments cp
    JOIN public.customers c ON c.id = cp.customer_id
    WHERE cp.user_id = auth.uid()

    UNION ALL
    -- Pembelian hutang (hutang naik)
    SELECT
      lower(regexp_replace(btrim(su.name), '\s+', ' ', 'g')),
      su.name,
      'hutang',
      pu.total_cost,
      'purchases',
      'purchase',
      pu.created_at,
      NULL,
      pu.id
    FROM public.purchases pu
    JOIN public.suppliers su ON su.id = pu.supplier_id
    WHERE pu.user_id = auth.uid() AND pu.payment_method = 'hutang'

    UNION ALL
    -- Pembayaran ke supplier (hutang turun)
    SELECT
      lower(regexp_replace(btrim(su.name), '\s+', ' ', 'g')),
      su.name,
      'hutang',
      -sp.amount,
      'supplier_payments',
      'payment',
      sp.created_at,
      sp.note,
      sp.id
    FROM public.supplier_payments sp
    JOIN public.suppliers su ON su.id = sp.supplier_id
    WHERE sp.user_id = auth.uid()
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'key', key,
    'name', name,
    'kind', kind,
    'delta', delta,
    'source_table', source_table,
    'source', source,
    'at', at,
    'note', note,
    'ref_id', ref_id
  ) ORDER BY at DESC), '[]'::jsonb)
  FROM (
    SELECT * FROM ev
    WHERE key IS NOT NULL AND key <> ''
      AND (p_key IS NULL OR key = lower(regexp_replace(btrim(p_key), '\s+', ' ', 'g')))
    ORDER BY at DESC
    LIMIT GREATEST(COALESCE(p_limit, 300), 1)
  ) t;
$function$;

REVOKE ALL ON FUNCTION public.party_balance_events_v1(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.party_balance_events_v1(integer, text) TO authenticated;