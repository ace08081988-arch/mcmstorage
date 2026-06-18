## Tujuan

1. Aplikasi bisa di-install sebagai APK Android. Saat pertama dibuka, otomatis minta izin **Notifikasi, Kamera, Lokasi, dan Penyimpanan/Galeri** sekaligus.
2. Setiap kali user login dari **device baru** (kombinasi sidik jari browser + IP + user agent), kirim **kode OTP 6 digit** ke email akun. Login baru aktif setelah OTP benar.

---

## Bagian 1 — APK Android + izin otomatis

Saya akan menambahkan **Capacitor** sebagai pembungkus native (web app yang sama, dibungkus jadi APK). Tidak perlu menulis ulang fitur.

- Tambah dependency: `@capacitor/core`, `@capacitor/android`, `@capacitor/camera`, `@capacitor/geolocation`, `@capacitor/push-notifications`, `@capacitor/filesystem`, `@capacitor/preferences`.
- Konfigurasi `capacitor.config.ts` dengan `appId: biz.mcmstorage.app`, `webDir: dist`, dan plugin permissions di `AndroidManifest.xml`.
- Komponen `PermissionBootstrap.tsx` (dipanggil dari root) yang **hanya jalan di native**:
  - Cek flag `permissions_requested_v1` di Capacitor Preferences. Jika belum ada, minta keempat izin berurutan lalu set flag.
  - Aman di web: kalau bukan Capacitor, komponen tidak melakukan apa-apa.
- Tambah halaman `/onboarding-permissions` opsional yang menjelaskan kenapa tiap izin diminta sebelum dialog OS muncul (best practice supaya user tidak menolak).
- Build APK: instruksi `npx cap add android`, `npm run build`, `npx cap sync`, `npx cap open android` → build APK di Android Studio. Lovable preview tidak bisa build APK; user perlu Android Studio di komputernya. Saya kasih README singkat.

User akan tetap bisa pakai versi web seperti biasa; APK adalah tambahan.

---

## Bagian 2 — OTP setiap device baru

### Definisi device
Hash SHA-256 dari `userAgent + acceptLanguage + screen + timezone + IP` (IP didapat server). Disimpan sebagai `device_hash`.

### Tabel baru (Lovable Cloud)
- `user_devices` — `id`, `user_id`, `device_hash`, `label`, `last_ip`, `last_user_agent`, `trusted_at`, `last_seen_at`. Trusted = sudah pernah OTP-konfirm.
- `device_otp_challenges` — `id`, `user_id`, `device_hash`, `code_hash` (bcrypt), `expires_at` (10 menit), `consumed_at`, `attempts`. Cap 5 percobaan.

Keduanya RLS ketat per `auth.uid()`, plus GRANT yang sesuai.

### Server function (Lovable Cloud)
- `requestDeviceOtp({ deviceHash })` — `requireSupabaseAuth`. Kalau device sudah trusted → return `{ trusted: true }`. Kalau belum: generate 6 digit, simpan hash, kirim email lewat Lovable Email Infra ke `auth.users.email`, return `{ trusted: false, challengeId }`.
- `verifyDeviceOtp({ challengeId, code })` — cek expiry, attempts, dan hash. Kalau cocok → insert/update `user_devices` (trusted_at = now), tandai challenge consumed, return `{ ok: true }`.

### Alur UI
- Setelah `supabase.auth.signInWithPassword` / Google sukses, tampilkan halaman `DeviceCheck`:
  1. Hitung device hash di klien.
  2. Panggil `requestDeviceOtp`. Kalau `trusted` → lanjut ke `/`.
  3. Kalau tidak → tampilkan form 6 digit + tombol "Kirim ulang" (cooldown 60 detik). Verifikasi via `verifyDeviceOtp`.
- Gate routing: pathless layout `_authenticated` ditambah cek context "device sudah trusted di sesi ini" (state in-memory + flag di Preferences/localStorage `device_trusted_<userId>_<hash>`). Kalau belum → redirect ke `/device-verify`.

### Email infra
- Karena belum ada Email Domain di project, saya akan **minta kamu setup domain email Lovable** dulu (sekali). Setelah itu saya scaffold template "OTP Verifikasi Device".

---

## Hal yang perlu kamu lakukan sendiri

- Setup **Email Domain** di Cloud → Emails (sekali klik). Tanpa ini OTP tidak terkirim.
- Untuk membuat APK final: install Android Studio di komputer kamu, ikuti README yang akan saya buat. Saya tidak bisa build APK dari sini.
- Setelah APK ter-install dan login pertama: device pertama otomatis di-trust (atau tetap minta OTP — kamu pilih nanti).

---

## Batasan jujur

- "IP" tidak stabil di mobile (ganti dari Wi-Fi ke 4G bisa trigger OTP lagi). Kamu sudah pilih opsi ini sambil tahu trade-off-nya — bisa diperlonggar nanti dengan hanya pakai browser + UA tanpa IP.
- Notifikasi Push baru aktif penuh kalau kamu juga setup Firebase Cloud Messaging nanti; izin notifikasi tetap diminta sekarang supaya siap.
- Capacitor mempertahankan satu code base; tidak perlu maintain dua app.

Setujui plan ini supaya saya mulai eksekusi (Bagian 1 + Bagian 2 sekaligus), atau bilang bagian mana yang mau dikerjakan dulu.