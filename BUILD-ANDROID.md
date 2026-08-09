# Build APK Android (Capacitor)

Ace Storage dibungkus dengan Capacitor sehingga bisa di-install sebagai APK
Android. Web app tetap berjalan seperti biasa — APK hanya menambahkan
akses ke izin perangkat (Notifikasi, Kamera, Lokasi, Galeri) saat pertama
kali dibuka.

## Prasyarat (di komputer kamu)

- Node 20+ dan Bun (untuk build web).
- **Android Studio** terbaru + Android SDK (Lovable tidak bisa build APK
  dari sini).
- JDK 17.

## Langkah build

```bash
# 1. install dependency
bun install

# 2. tambahkan platform android (cukup sekali)
bunx cap add android

# 3. build web
bun run build

# 4. sinkronkan ke project android
bunx cap sync android

# 5. buka di Android Studio
bunx cap open android
```

Di Android Studio: pilih **Build → Build Bundle(s)/APK(s) → Build APK(s)**.
File `.apk` akan muncul di `android/app/build/outputs/apk/`.

## Setelah update kode web

Setiap kali kode web diubah dan ingin masuk ke APK:

```bash
bun run build && bunx cap sync android
```

lalu rebuild APK di Android Studio.

## Kebijakan izin (per fitur, bukan saat startup)

Aplikasi **tidak** meminta izin apa pun saat pertama dibuka
(`src/lib/permission-bootstrap.ts` sengaja no-op). Izin diminta tepat saat
fiturnya dipakai, dengan alasan yang jelas dan jalan pintas ke Setelan bila
ditolak permanen:

| Izin | Kapan diminta | Kode |
|---|---|---|
| Kamera + galeri | Tombol ambil/pilih foto | `@capacitor/camera` (`src/lib/chat-attachments.ts`, portal pegawai) |
| Lokasi (coarse + fine) | Tombol GPS pada bukti penyiapan | `src/lib/get-location.ts` |
| Notifikasi (Android 13+) | Tombol "Aktifkan notifikasi" | `src/lib/native-push.ts` |
| Kontak | Saat impor buku alamat | `@capacitor-community/contacts` |
| Bluetooth (Android 12+) | Saat panggilan memakai headset | runtime-guarded |

Izin yang **tidak** dideklarasikan karena tidak dipakai:
`ACCESS_BACKGROUND_LOCATION`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO`,
`SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE`, `WRITE_EXTERNAL_STORAGE`.

## Privasi & backup

- `android:allowBackup="false"` — sesi Supabase, PIN AppLock, dan storage
  WebView tidak boleh ikut ke cloud backup.
- `@xml/data_extraction_rules` + `@xml/backup_rules` mengecualikan
  `CapacitorStorage.xml`, database WebView, dan folder `app_webview`
  (berlaku juga untuk device-to-device transfer Android 12+).
- `@xml/network_security_config` + `usesCleartextTraffic="false"` melarang
  HTTP polos dan mixed content.

## Deep link

Scheme kustom `biz.mcmstorage.app://…` dipertahankan. HTTPS App Links
terverifikasi untuk `mcmstorage.app` (`/t/`, `/undang`) — pemasangan
`assetlinks.json` dan fingerprint dijelaskan di
[docs/ANDROID_APP_LINKS.md](docs/ANDROID_APP_LINKS.md).

## Versi aplikasi (satu SSOT)

`android/version.properties` adalah satu-satunya sumber versi;
`android/app/build.gradle` hanya membacanya.

```bash
bun run version:check      # baca saja — aman untuk dry-run/CI/retry
bun run version:bump       # naikkan versionCode/versionName (eksplisit)
bun run version:bump:dry   # simulasi
```

Build/release **tidak pernah** menaikkan versi otomatis. Untuk naik versi
sekaligus build: `bun run aab:build:release:bump`.

## Build dari CLI

```bash
bun run apk:build:debug      # assembleDebug — TIDAK butuh keystore release
bun run apk:build:release    # assembleRelease — butuh keystore
bun run aab:build:release    # bundleRelease untuk Play Console
```

## Signing release

Kredensial tidak pernah masuk repo. Dua sumber, prioritas env var:

```bash
# a) CI / shell
export KEYSTORE_FILE=/path/ke/ace-release.keystore
export KEYSTORE_ALIAS=mcm
export KEYSTORE_STORE_PASS='…'
export KEYSTORE_KEY_PASS='…'

# b) lokal (ditulis oleh wizard, di-gitignore)
bun run aab:setup-keystore   # → android/keystore.properties
bun run aab:validate-keystore
```

Kalau keystore tidak tersedia, `assembleDebug` tetap jalan normal dan Gradle
mencetak peringatan bahwa artefak release akan unsigned.

## R8 / ProGuard

Release memakai `minifyEnabled true` + `shrinkResources true` dengan aturan
Capacitor/plugin/WebView di `android/app/proguard-rules.pro`.
`scripts/preflight-release.mjs --post` mengarsipkan `mapping.txt` ke
`dist/mapping/` untuk deobfuscation stacktrace Play Console.

## Push notification

Push baru aktif setelah `android/app/google-services.json` (Firebase)
tersedia. Selama file itu belum ada, Gradle melewati plugin google-services
dan aplikasi harus menampilkan status **belum dikonfigurasi** — jangan
mengklaim push berfungsi.

## Catatan

- `appId`: `biz.mcmstorage.app` (varian chat: `biz.mcmstorage.chat`).
- Nama aplikasi: `Ace Storage` / `Ace Chat`.
