
CREATE TABLE public.warehouse_item_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  warehouse_item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE CASCADE,
  label text NOT NULL,
  weight_per_unit numeric NOT NULL DEFAULT 1,
  unit_label text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX warehouse_item_variants_item_idx ON public.warehouse_item_variants(warehouse_item_id);
CREATE INDEX warehouse_item_variants_user_idx ON public.warehouse_item_variants(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_item_variants TO authenticated;
GRANT ALL ON public.warehouse_item_variants TO service_role;

ALTER TABLE public.warehouse_item_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner manage variants" ON public.warehouse_item_variants
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_warehouse_item_variants_updated_at
  BEFORE UPDATE ON public.warehouse_item_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
