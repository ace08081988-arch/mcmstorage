REVOKE ALL ON public.email_queue_alerts FROM authenticated, anon;
GRANT ALL ON public.email_queue_alerts TO service_role;