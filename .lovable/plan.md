## Tujuan

Satu sumber data kontak (nama, email, nomor HP/WhatsApp) yang **selalu mengikuti akun login**, lalu dipakai otomatis di form Pelanggan, Pemasok, dan halaman Link Pegawai.

## Apa yang akan saya buat

### 1. Database

**Tabel baru `public.profiles`** (1 baris per `auth.users.id`)
- field domain: `display_name`, `email`, `phone`
- FK ke `auth.users(id)` `ON DELETE CASCADE`
- RLS: pengguna hanya bisa baca/ubah profil miliknya sendiri
- GRANT `authenticated` + `service_role`

**Trigger sinkronisasi otomatis (kunci dari "selalu mengikuti akun"):**
- `on_auth_user_created` — saat akun didaftarkan, langsung insert baris `profiles` dengan email + phone + nama dari metadata `auth.users`
- `on_auth_user_updated` — saat email/phone di `auth.users` berubah, profil ikut diperbarui
- `on_profile_updated` — saat user mengubah profil dari aplikasi, simpan saja (tidak menulis balik ke `auth.users` agar tidak konflik dengan flow verifikasi email Supabase)

**Backfill** baris profil untuk semua user yang sudah ada saat ini (dijalankan sekali dalam migrasi).

### 2. UI

**Halaman/Dialog "Profil akun"** baru, dapat dibuka dari sidebar atau dari dialog 🎨 Tampilan:
- Tampilkan email akun (read-only — diatur via Supabase Auth)
- Input nama tampilan + nomor WhatsApp (editable)
- Tombol Simpan menulis ke `profiles`

**Pelanggan (`/hutang-piutang` & form Customer):**
- Tombol kecil "Pakai kontak akun saya" di samping field nama/HP → mengisi otomatis dari `profiles` saat ini. *(Catatan: customer adalah pihak lain, jadi "selalu mengikuti akun" tidak diterapkan per baris — hanya tombol prefill agar tidak salah data.)*

**Pemasok (form Supplier):** sama seperti di atas.

**Link Pegawai:** menampilkan badge "Dikirim oleh: {nama dari profil}" pada teks/preview pesan WhatsApp, mengikuti profil terbaru secara otomatis.

### 3. Helper kode

- `src/lib/profile.ts` — `getMyProfile()`, `updateMyProfile()`, hook `useMyProfile()` (TanStack Query) dengan cache yang di-invalidate saat `onAuthStateChange` USER_UPDATED.

## Catatan & keputusan teknis

- **Pelanggan & Pemasok** adalah entitas pihak ketiga. Mengupdate massal kontak mereka tiap kali email akun berubah berbahaya (menimpa data nyata pelanggan). Jadi pada keduanya saya hanya menyediakan **prefill** dari profil — bukan sinkronisasi otomatis per baris. Mohon dikonfirmasi di tahap implementasi jika ternyata maksud Anda berbeda (mis. ada field "kontak toko" pada masing-masing record yang memang harus = akun).
- **Profil pengguna & Link Pegawai** benar-benar mengikuti akun via trigger DB.
- Trigger DB pakai `SECURITY DEFINER` + `SET search_path = public`.
- Email tetap dikelola Supabase Auth; profil hanya mencerminkan nilai terbarunya.

## Yang TIDAK saya ubah

- Skema `auth.*` (tidak boleh disentuh).
- Tabel `customers` / `suppliers` skemanya tidak ditambah kolom baru — hanya UI prefill.
- Trigger stok & RPC pegawai yang sudah ada.

Setelah Anda setujui rencananya, saya kerjakan migrasi DB dulu (perlu persetujuan terpisah), lalu lanjut kodenya.