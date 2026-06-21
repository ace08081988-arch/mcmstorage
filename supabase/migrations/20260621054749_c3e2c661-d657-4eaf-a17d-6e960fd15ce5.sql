
-- 1) Revoke EXECUTE from anon/authenticated/PUBLIC on internal trigger-only SECURITY DEFINER functions.
REVOKE EXECUTE ON FUNCTION public.apply_request_preparation_item() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_profile() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_profile_from_auth() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_ready_package() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_ecer_preparation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_sale() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_purchase() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_order_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_conversation_on_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_ensure_order_conv() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_customer_account_linked() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_prep_pin_failure(text) FROM PUBLIC, anon, authenticated;

-- 2) Lock down prep_upload_grants: server-only table. Add explicit deny-all policies
--    so the linter sees policies exist and clients cannot read/write directly.
CREATE POLICY "deny all select" ON public.prep_upload_grants FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "deny all write" ON public.prep_upload_grants FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- 3) Remove prep_task_items and prep_submissions from the Realtime publication.
--    Realtime broadcasts here could leak other owners' rows because realtime.messages
--    cannot be tightened from user space. Clients can refetch via RLS-protected reads.
ALTER PUBLICATION supabase_realtime DROP TABLE public.prep_task_items;
ALTER PUBLICATION supabase_realtime DROP TABLE public.prep_submissions;
