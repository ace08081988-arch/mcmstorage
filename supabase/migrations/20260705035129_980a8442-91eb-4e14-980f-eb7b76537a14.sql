-- Bootstrap: seed pemilik akun sebagai admin sehingga RPC yang dilindungi
-- has_role('admin') (mis. prep_create_task) tidak lagi menolak dengan
-- 'forbidden'. Idempotent — hanya menyisipkan jika user ada dan role
-- belum tersemat.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role
FROM auth.users u
WHERE u.email = 'ace08081988@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;