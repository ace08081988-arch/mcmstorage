
-- Storage policies for payment-proofs bucket
CREATE POLICY "users upload own payment proofs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "users read own payment proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "admins read all payment proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND public.has_role(auth.uid(), 'admin')
  );

-- Lock down sensitive new functions from anon
REVOKE EXECUTE ON FUNCTION public.start_pro_trial() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_approve_payment(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reject_payment(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.expire_subscriptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_pro_trial() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_subscriptions() TO service_role;
