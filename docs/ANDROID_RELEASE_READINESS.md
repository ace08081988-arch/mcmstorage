# Sprint 4 — Android/APK Release Readiness (laporan)

Tanggal: 9 Agustus 2026 · Merek: **Ace Storage** / **Ace Chat**
`applicationId`: `biz.mcmstorage.app` (chat: `biz.mcmstorage.chat`) — tidak diubah.
Tidak ada keystore dibuat/diganti, tidak ada secret ditulis ke repo/log,
tidak ada upload Play Store, tidak ada deploy web.

## 1. Manifest & privasi

| Item | Status |
|---|---|
| `ACCESS_COARSE_LOCATION` + `ACCESS_FINE_LOCATION` | ditambahkan (core flow bukti penyiapan) |
| `READ_MEDIA_IMAGES` (13+), `READ_MEDIA_VISUAL_USER_SELECTED` (14+), `READ_EXTERNAL_STORAGE` `maxSdkVersion=32` | ditambahkan |
| `WRITE_EXTERNAL_STORAGE` | di-`tools:node="remove"` (tidak dipakai, cegah merge dari library) |
| `CAMERA`, `RECORD_AUDIO`, `POST_NOTIFICATIONS`, `BLUETOOTH_CONNECT`, `MODIFY_AUDIO_SETTINGS` | dipertahankan, semua runtime-guarded |
| `ACCESS_BACKGROUND_LOCATION`, `READ_MEDIA_VIDEO/AUDIO`, `SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE` | sengaja TIDAK diminta |
| `android:allowBackup` | `true` → **`false`** |
| `@xml/data_extraction_rules` (12+) & `@xml/backup_rules` | baru — mengecualikan `CapacitorStorage.xml` (sesi Supabase + AppLock), database & folder WebView, dan external storage; berlaku untuk cloud backup dan device-transfer |
| `@xml/network_security_config` + `usesCleartextTraffic="false"` | baru — cleartext & mixed content dilarang di semua build |
| Deep link scheme kustom | dipertahankan |
| App Links HTTPS terverifikasi | `mcmstorage.app` + `www` pada `/t/` dan `/undang`, `autoVerify="true"` |

`assetlinks.json` **belum terpasang** — itu langkah owner di hosting.
Prosedur + cara mengambil fingerprint: `docs/ANDROID_APP_LINKS.md`.

## 2. Signed release

- `android/app/build.gradle`: membaca `android/keystore.properties` **dan**
  env var (`KEYSTORE_FILE`, `KEYSTORE_ALIAS`, `KEYSTORE_STORE_PASS`,
  `KEYSTORE_KEY_PASS`); env var menang untuk CI. Tidak ada secret di repo;
  `.gitignore` menambah `android/keystore.properties`, `*.keystore`, `*.jks`,
  `google-services.json`.
- `signingConfigs.release` + `buildTypes.release { signingConfig … }` aktif
  hanya bila kredensial lengkap dan file keystore ada. Kalau tidak, Gradle
  mencetak peringatan dan **debug build tetap jalan tanpa keystore**.
- Release: `minifyEnabled true` + `shrinkResources true` +
  `proguard-android-optimize.txt`. `proguard-rules.pro` diisi aturan
  Capacitor bridge/plugin, Cordova, `@JavascriptInterface`, Firebase/GMS,
  enum/Parcelable, dan `SourceFile,LineNumberTable` agar `mapping.txt`
  berguna. Arsip mapping tetap ditangani `preflight-release.mjs --post`.
- **Versi = satu SSOT**: `android/version.properties`. `build.gradle` hanya
  membacanya. Auto-bump saat build **dihapus** — `build-aab.mjs` hanya
  membaca versi kecuali diberi `--bump`, jadi dry-run/retry tidak pernah
  menaikkan versionCode berkali-kali.

## 3. Script & dokumentasi

Alias baru (checklist lama kini valid):

| Script | Fungsi |
|---|---|
| `version:check` / `version:check:json` | baca versi (read-only) |
| `version:bump` / `version:bump:dry` | naikkan versi secara eksplisit |
| `apk:build:debug` / `apk:build:release` | assembleDebug / assembleRelease |
| `aab:build:release` / `aab:build:release:bump` | bundleRelease tanpa / dengan bump |

`scripts/read-app-version.mjs` menjadi pembaca versi bersama untuk
`bump-version.mjs`, `preflight-release.mjs`, `upload-play.mjs`, dan workflow.
`build-apk.mjs`, `build-aab.mjs`, `preflight-release.mjs`,
`validate-keystore.mjs`, `setup-keystore.mjs`, `aab-to-apk.mjs`, dan
`print-fingerprints.mjs` kini konsisten: path `android/keystore.properties`
dengan field `storeFile`/`storePassword`/`keyAlias`/`keyPassword`, plus env
var yang sama. `preflight-release.mjs` menerima kredensial dari env (CI)
tanpa mewajibkan file properties.

Workflow:
- **Android Debug APK (QA)** (baru): `assembleDebug` tanpa keystore/secret,
  menghasilkan artifact `dist/qa/ace-<varian>-debug-<versionName>-<code>.apk`
  + `SHA256SUMS.txt`, retensi 14 hari.
- **Build & Release AAB**: fail-fast bila secret keystore/Play belum ada,
  versi dibaca dari SSOT (tidak pernah bump), artifact AAB + mapping +
  `SHA256SUMS.txt` retensi 30 hari, keystore dihapus dari runner di akhir.

## 4. Native behavior

- `src/lib/permission-bootstrap.ts`: permintaan 4 izin sekaligus saat
  startup **dihapus** (kini no-op + helper `checkNativePermission()` yang
  hanya membaca status). Izin diminta saat fitur dipakai: kamera/galeri via
  Capacitor Camera, lokasi via `get-location.ts` (punya pesan denied /
  permanently-denied + arahan Setelan), notifikasi via `native-push.ts`.
- Push: tanpa `android/app/google-services.json`, plugin google-services
  tidak diterapkan. UI harus tetap menampilkan status *belum dikonfigurasi*;
  klaim "push aktif" tidak dibuat di dokumen mana pun.

## 5. Release gates — hasil aktual

| Gate | Hasil |
|---|---|
| `bunx tsgo --noEmit` | ✅ bersih |
| ESLint (file yang diubah) | ✅ bersih |
| Validasi XML manifest + res/xml | ✅ semua parse |
| Validasi YAML kedua workflow | ✅ parse |
| `node scripts/read-app-version.mjs` | ✅ `versionCode=1`, `versionName=1.0.0` |
| `node scripts/preflight-release.mjs` | ✅ signing wired, R8, shrinkResources, proguard, SSOT versi — ❌ hanya 1 error yang memang diharapkan: kredensial keystore belum tersedia |
| `./gradlew :app:assembleDebug` | ⛔ **tidak dijalankan** — sandbox tidak punya JDK/Android SDK/`adb`. Dijalankan oleh workflow *Android Debug APK (QA)*. |
| `assembleRelease` / `bundleRelease` signed | ⛔ blocker: keystore + password belum tersedia (owner) |
| Smoke test perangkat nyata | ⛔ tidak ada perangkat di lingkungan ini |

### Belum terverifikasi (butuh perangkat/CI nyata)

- Install & launch APK debug di Android 10 / 12 / 13 / 14 / 16.
- App-lock setelah kamera/galeri/file picker kembali ke app.
- Geolocation akurat, denied, permanently denied.
- Photo picker Android 13+ dan akses parsial Android 14+.
- Upload besar / offline / retry, izin push, WebView file upload–share–download.
- WA deep link, Maps eksternal, tombol back, rotasi, safe-area.
- App Links `verified` (butuh `assetlinks.json` tayang lebih dulu).
- Ukuran + SHA-256 APK/AAB final (dihasilkan workflow saat build nyata).

### Blocker yang harus diselesaikan owner

1. Keystore rilis + `KEYSTORE_*` sebagai GitHub Secrets (tidak dibuat di sini).
2. `PLAY_SERVICE_ACCOUNT_JSON_B64` bila ingin upload otomatis (tetap manual sekarang).
3. `assetlinks.json` di `mcmstorage.app` dan `www.mcmstorage.app`.
4. `google-services.json` bila push FCM ingin diaktifkan.
5. Perangkat uji fisik untuk matriks Android 10–16.
