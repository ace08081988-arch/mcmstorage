
-- Auto-grant admin role to every new signup + backfill existing users.
-- Rationale: aplikasi single-tenant per akun. Setiap owner adalah admin
-- untuk datanya sendiri. Guard cross-owner tetap membatasi aksi ke data
-- milik caller, jadi role admin universal aman.

CREATE OR REPLACE FUNCTION public.grant_admin_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_grant_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_grant_admin
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.grant_admin_on_signup();

-- Backfill: semua user yang sudah ada tapi belum punya role admin.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role
FROM auth.users u
LEFT JOIN public.user_roles ur
  ON ur.user_id = u.id AND ur.role = 'admin'::public.app_role
WHERE ur.user_id IS NULL
ON CONFLICT (user_id, role) DO NOTHING;
