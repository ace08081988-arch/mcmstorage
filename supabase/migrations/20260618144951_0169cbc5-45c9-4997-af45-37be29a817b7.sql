
CREATE TABLE public.order_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE CASCADE,
  qty numeric NOT NULL CHECK (qty > 0),
  qty_mode text NOT NULL CHECK (qty_mode IN ('base','package')),
  price_per_unit numeric,
  note text,
  status text NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu','siap','selesai')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_requests TO authenticated;
GRANT ALL ON public.order_requests TO service_role;

ALTER TABLE public.order_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manage own order_requests" ON public.order_requests
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_order_requests_updated_at
  BEFORE UPDATE ON public.order_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
