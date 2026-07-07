# Penghapusan Cloudflare Turnstile

Turnstile sudah tidak dipakai di alur signup/login. Catatan migrasi:

## Env

- `VITE_TURNSTILE_SITE_KEY` dihapus dari `.env`.
- Secret runtime `TURNSTILE_SECRET_KEY` dihapus dari konfigurasi project.
- Tidak perlu didaftarkan ulang di environment baru.

## Database

Migrasi berurutan (`supabase/migrations/`):

1. `20260707122141_*` — `DROP TABLE public.turnstile_config`.
2. `20260707122930_*` — `DROP FUNCTION public.get_turnstile_site_key`,
   `public.turnstile_config_touch`.

Migrasi lama yang membuat tabel/fungsi tersebut tetap ada demi riwayat;
jangan diubah.

## Kode

Komponen, hook, route admin, util crypto, dan test terkait Turnstile sudah
dihapus. `secureSignUpImpl` di `src/lib/auth.functions.ts` sekarang langsung
ke rate-limit + `createUser`, tanpa verifikasi captcha.

## Pengaman signup pengganti

Rate limit per IP via RPC `check_and_record_signup_attempt` (12/jam) masih
aktif dan menjadi satu-satunya lapisan anti-abuse pada endpoint signup.