-- Revoke EXECUTE from PUBLIC, anon, authenticated on internal SECURITY DEFINER functions.
-- Keep has_role accessible (used inside RLS policies; its own body already restricts to caller's own uid or service_role).

REVOKE EXECUTE ON FUNCTION public.email_queue_health() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.email_queue_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;

-- Trigger functions (apply_sale, apply_purchase, log_order_status_change) run as triggers
-- regardless of caller EXECUTE rights, so revoke direct invocation too.
REVOKE EXECUTE ON FUNCTION public.apply_sale() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_purchase() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_order_status_change() FROM PUBLIC, anon, authenticated;