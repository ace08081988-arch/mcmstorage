CREATE TABLE public.warehouse_category_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text NOT NULL,
  label text NOT NULL,
  weight_per_unit numeric NOT NULL DEFAULT 1,
  unit_label text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX warehouse_category_variants_user_cat_idx ON public.warehouse_category_variants(user_id, category);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_category_variants TO authenticated;
GRANT ALL ON public.warehouse_category_variants TO service_role;

ALTER TABLE public.warehouse_category_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner manage category variants" ON public.warehouse_category_variants
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_warehouse_category_variants_updated_at
  BEFORE UPDATE ON public.warehouse_category_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Restrictive blocks for sensitive monitoring tables (security finding fixes)
CREATE POLICY "block authenticated access to email_monitor_config"
  ON public.email_monitor_config AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "block authenticated writes to email_queue_alerts"
  ON public.email_queue_alerts AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);