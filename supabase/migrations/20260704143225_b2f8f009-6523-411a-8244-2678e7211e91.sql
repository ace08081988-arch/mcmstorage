-- Reads: admin-only audit access. Writes remain server-side only
-- (via SECURITY DEFINER function check_and_record_signup_attempt),
-- so no INSERT/UPDATE/DELETE policies are defined — fail-closed by design.
DROP POLICY IF EXISTS "Admins can read signup attempts" ON public.signup_attempts;
CREATE POLICY "Admins can read signup attempts"
ON public.signup_attempts
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));