DO $$
BEGIN
  BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_requests'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.order_request_events'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.prep_pin_alerts'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
END $$;