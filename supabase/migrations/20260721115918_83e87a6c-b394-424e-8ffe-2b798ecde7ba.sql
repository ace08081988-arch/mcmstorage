
CREATE TABLE IF NOT EXISTS public.query_metrics (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  query_name TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  row_count INTEGER,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.query_metrics TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.query_metrics_id_seq TO authenticated;
GRANT ALL ON public.query_metrics TO service_role;
GRANT ALL ON SEQUENCE public.query_metrics_id_seq TO service_role;

ALTER TABLE public.query_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_query_metrics_select" ON public.query_metrics
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "own_query_metrics_insert" ON public.query_metrics
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_query_metrics_user_query_created
  ON public.query_metrics (user_id, query_name, created_at DESC);

-- Auto-purge: keep last 14 days only (client-side best-effort; hard cap here)
CREATE OR REPLACE FUNCTION public.query_metrics_prune() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.query_metrics WHERE created_at < now() - interval '14 days';
$$;

CREATE OR REPLACE VIEW public.query_metrics_daily_v1
WITH (security_invoker = true) AS
SELECT
  user_id,
  query_name,
  date_trunc('day', created_at) AS day,
  COUNT(*)::int AS samples,
  ROUND(AVG(duration_ms))::int AS avg_ms,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms,
  MAX(duration_ms) AS max_ms,
  ROUND(AVG(row_count))::int AS avg_rows
FROM public.query_metrics
GROUP BY user_id, query_name, date_trunc('day', created_at);

GRANT SELECT ON public.query_metrics_daily_v1 TO authenticated;
