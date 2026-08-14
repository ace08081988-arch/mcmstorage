# Build Android App Bundle (AAB) untuk Google Play Store

Google Play Store **hanya menerima format `.aab`** (Android App Bundle),
bukan `.apk`. AAB lebih aman untuk distribusi karena Play Store
meng-generate APK per-device (lebih kecil, signing dikelola Play App
Signing) dan mendukung integrity checks.

Panduan ini fokus ke build `.aab` lewat CLI (`./gradlew bundleRelease`),
bukan lewat Android Studio, supaya bisa masuk CI / auto-release nanti.

## Prasyarat (sekali saja)

Sama dengan build APK — lihat [`docs/BUILD_APK.md`](./BUILD_APK.md)
bagian "Prasyarat":

1. Android Studio + SDK Platform 36 + Build-Tools 36 + Command-line Tools.
2. JDK **21**.
3. Env var `ANDROID_HOME` dan `JAVA_HOME` di shell profile.
4. Folder `android/` sudah di-generate (`bunx cap add android`).

## Signing key (WAJIB untuk release AAB)

AAB unsigned **akan ditolak** Play Console. Setup sekali:

### 1. Generate keystore (simpan di luar repo!)

```bash
keytool -genkey -v \
  -keystore ~/keys/mcm-release.keystore \
  -alias mcm \
  -keyalg RSA -keysize 2048 -validity 10000
```

Simpan **password store, password key, alias, dan file .keystore**. Kalau
hilang, Anda tidak bisa update aplikasi di Play Store dengan identitas
yang sama — harus daftar app baru.

> **Backup keystore ke minimal 2 tempat** (mis. password manager + external
> drive terenkripsi). Ini adalah aset paling kritis dari distribusi Play Store.

### 2. Buat `android/keystore.properties`

File ini **JANGAN di-commit** — sudah masuk `.gitignore` default Capacitor
kalau folder `android/` di-regenerate, tapi cek sekali:

```properties
storeFile=/Users/anda/keys/mcm-release.keystore
storePassword=PASSWORD_KEYSTORE
keyAlias=mcm
keyPassword=PASSWORD_KEY
```

### Alternatif: password lewat environment variable (recommended untuk CI / komputer bersama)

Password bisa ditaruh di env var supaya tidak tersimpan di disk:

```bash
export KEYSTORE_FILE=~/keys/mcm-release.keystore   # opsional
export KEYSTORE_ALIAS=mcm                          # opsional
export KEYSTORE_STORE_PASS='…'
export KEYSTORE_KEY_PASS='…'
```

Prioritas resolusi (per-field, dari yang paling menang):
`CLI flag → env var → android/keystore.properties`.

Gunakan `bun run aab:setup-keystore -- --env-only` untuk generate keystore
baru **tanpa** menulis password ke `keystore.properties` (file itu hanya
akan berisi `storeFile` + `keyAlias`; password Anda simpan di shell profile
atau CI secret store).

### 3. Wire ke `android/app/build.gradle`

Tambahkan di **atas** `android { ... }`:

```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

Di dalam `android { ... }`:

```gradle
signingConfigs {
    release {
        if (keystorePropertiesFile.exists()) {
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
}
```

> Kalau `bunx cap sync android` menimpa `build.gradle`, ulangi step ini
> ATAU pisahkan config ke file `signing.gradle` yang di-apply — Capacitor
> tidak menyentuh file custom.

## Build harian (1 perintah)

### MCM Storage release
```bash
bun run aab:build
```

### Debug bundle (untuk internal testing tanpa signing)
```bash
bun run aab:build:debug
```

### Flag manual
```bash
node scripts/build-aab.mjs --skip-typecheck
```

| Flag              | Fungsi                                                      |
| ----------------- | ----------------------------------------------------------- |
| `--debug`         | `bundleDebug` — tidak butuh keystore, TIDAK bisa upload ke Play |
| `--skip-typecheck`| Lewati tsc (hanya kalau baru saja dicek manual)              |

## Output

```
android/app/build/outputs/bundle/release/app-release.aab
android/app/build/outputs/bundle/debug/app-debug.aab
```

## Upload ke Google Play Console

1. Buka [Play Console](https://play.google.com/console) → app Anda.
2. **Release → Testing → Internal testing** (mulai dari sini dulu, bukan Production).
3. **Create new release → Upload** → drag file `.aab`.
4. Isi release notes (Bahasa Indonesia + English kalau bisa).
5. **Save → Review release → Rollout to Internal testing**.
6. Tambahkan email tester (Google account) di tab "Testers".
7. Setelah stabil (biasanya 1–3 hari), promote ke **Closed testing** →
   **Open testing** → **Production**.

## Play App Signing (rekomendasi Google)

Saat pertama kali upload AAB, Play Console menawarkan **Play App Signing**:
Google memegang key final, Anda hanya pegang "upload key". Ini lebih aman
karena:

- Kalau upload key Anda bocor, Anda tinggal minta Google reset upload key.
- Kalau key final bocor, tanpa Play App Signing, aplikasi Anda tamat.

**Terima tawaran ini** — hampir semua app baru wajib pakainya sejak 2021.

## Troubleshooting

| Gejala                                                        | Solusi                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `Task :app:bundleRelease FAILED` + `keystore file … not found`| Cek `storeFile` di `keystore.properties` — pakai path absolut.     |
| `Failed to read key … from store`                             | Password store/key salah, atau alias tidak match.                  |
| Play Console: "APK unsigned"                                  | Anda upload debug AAB. Pakai `bun run aab:build` (bukan `:debug`). |
| Play Console: "Version code already used"                     | Naikkan `versionCode` di `android/app/build.gradle`.               |
| `Unsupported class file major version 65`                     | Pakai JDK 17 (bukan 21+).                                          |
| AAB besar (>150MB) ditolak                                    | Aktifkan `minifyEnabled true` + Proguard, atau split assets.       |
| Build sukses tapi splash kosong di Play test                  | `dist/` belum ter-sync — jalankan `bun run aab:build` ulang.       |

## Alur "aman & cepat"

```text
┌──────────────┐    ┌────────────────┐    ┌──────────────────┐
│ aab:build    │──▶ │ AAB signed     │──▶ │ Play Console     │
│ (5–10 menit) │    │ di outputs/    │    │ Internal testing │
└──────────────┘    └────────────────┘    └──────────────────┘
       │                                          │
       └── typecheck + vite + cap sync            └── promote ke
           + gradlew bundleRelease                   Production
```

Total: **1 perintah shell + upload manual di Play Console**.
Untuk automasi penuh (fastlane / Gradle Play Publisher), lihat
`docs/BUILD_APK.md` sebagai baseline dan tambahkan plugin
`com.github.triplet.play` di `android/app/build.gradle` — belum di-scope
di skrip ini agar tetap eksplisit di tangan Anda.