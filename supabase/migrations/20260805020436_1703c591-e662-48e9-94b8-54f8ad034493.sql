CREATE TABLE IF NOT EXISTS public.web_vital_samples (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  page TEXT NOT NULL CHECK (page IN ('katalog_list','katalog_detail')),
  slug TEXT,
  metric TEXT NOT NULL CHECK (metric IN ('LCP','CLS','INP','TTFB','FCP')),
  value DOUBLE PRECISION NOT NULL CHECK (value >= 0 AND value < 600000),
  rating TEXT NOT NULL CHECK (rating IN ('good','needs-improvement','poor')),
  nav_type TEXT,
  device TEXT NOT NULL DEFAULT 'unknown' CHECK (device IN ('mobile','desktop','unknown')),
  release_tag TEXT
);

CREATE INDEX IF NOT EXISTS web_vital_samples_created_idx ON public.web_vital_samples (created_at DESC);
CREATE INDEX IF NOT EXISTS web_vital_samples_page_metric_idx ON public.web_vital_samples (page, metric, created_at DESC);

GRANT ALL ON public.web_vital_samples TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.web_vital_samples_id_seq TO service_role;

ALTER TABLE public.web_vital_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read web vital samples"
  ON public.web_vital_samples FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));