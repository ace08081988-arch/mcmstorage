ALTER TABLE public.warehouse_categories REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.warehouse_categories;