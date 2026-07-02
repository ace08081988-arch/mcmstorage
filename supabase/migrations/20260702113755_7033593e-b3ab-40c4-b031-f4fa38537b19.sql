DROP POLICY IF EXISTS "authenticated can read app_settings" ON public.app_settings;

CREATE POLICY "admins can read app_settings"
ON public.app_settings FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));