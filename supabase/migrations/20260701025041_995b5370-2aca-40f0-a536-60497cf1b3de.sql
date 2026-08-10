ALTER TABLE public.scroll_guard_config REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.scroll_guard_config;