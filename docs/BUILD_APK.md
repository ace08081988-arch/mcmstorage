# Build APK Ace Storage / Ace Chat

Panduan cepat generate APK dari Android Studio dengan langkah minim error.
Script `scripts/build-apk.mjs` men-cover semua pre-flight (typecheck, cek
env, cek folder `android/`) sehingga Anda tidak kehabisan waktu di Gradle
karena error yang sebetulnya bisa ketahuan lebih awal.

## Prasyarat (sekali saja)

1. Install Android Studio (Hedgehog / Iguana / lebih baru).
2. Buka **Settings → Languages & Frameworks → Android SDK**, install:
   - Android SDK Platform 34
   - Android SDK Build-Tools 34.0.0
   - Android SDK Command-line Tools
3. Set env var di shell profile Anda:
   ```bash
   export ANDROID_HOME="$HOME/Android/Sdk"          # Linux
   # export ANDROID_HOME="$HOME/Library/Android/sdk" # macOS
   export JAVA_HOME="$(/usr/libexec/java_home -v 17)" # macOS
   export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
   ```
4. Generate folder `android/` **satu kali**:
   ```bash
   bun run build && bunx cap add android
   ```

## Build harian (2 perintah)

### Varian Ace Storage (full)
```bash
bun run apk:build         # typecheck → vite build → cap sync android
bun run apk:open          # buka Android Studio
```

### Varian Ace Chat
```bash
bun run apk:build:chat
bun run apk:open
```

### Sekali jalan langsung buka Studio
```bash
node scripts/build-apk.mjs --variant full --open
```

## Di dalam Android Studio

Tunggu **Gradle sync** selesai (indikator di bawah), lalu:

| Tujuan | Menu |
| --- | --- |
| APK **debug** untuk uji sendiri di HP | Build → Build Bundle(s) / APK(s) → **Build APK(s)** |
| APK **rilis** (signed) untuk distribusi | Build → **Generate Signed Bundle / APK** → APK → pilih keystore → **release** |
| Install langsung ke HP yang terhubung | Run ▶ (pastikan device dipilih di dropdown atas) |

Output file APK:
```
android/app/build/outputs/apk/debug/app-debug.apk
android/app/build/outputs/apk/release/app-release.apk
```

## Signing key (sekali saja untuk rilis)

```bash
keytool -genkey -v -keystore mcm-release.keystore \
  -alias mcm -keyalg RSA -keysize 2048 -validity 10000
```

Simpan `mcm-release.keystore` DI LUAR repo (mis. `~/keys/`). Di Android
Studio saat **Generate Signed APK**, pilih file ini + isi alias & password.
Centang **"Remember passwords"** supaya tidak input ulang.

## Troubleshooting umum

| Gejala | Penyebab | Solusi |
| --- | --- | --- |
| `Folder android/ belum ada` di skrip | Belum pernah `cap add android` | `bunx cap add android` lalu ulangi |
| Typecheck merah sebelum build | Ada error TS di kode | Lihat output; perbaiki dulu, baru rebuild |
| Gradle sync gagal `SDK location not found` | `ANDROID_HOME` kosong | Set env var di prasyarat, restart Android Studio |
| `Unsupported class file major version 65` | JDK terlalu baru (JDK 21+) | Pakai JDK 17 (`JAVA_HOME` → JDK 17) |
| Build APK sukses tapi splash kosong di HP | `dist/` belum ke-sync ke android | Jalankan `bun run apk:build` **ulang** sebelum Build APK |
| APK terpasang tapi versi lama | Cache Gradle | Di Studio: Build → **Clean Project** → Build APK lagi |
| WA share tidak jalan | `allowMixedContent: false` blokir http | Pastikan tautan wa.me pakai `https://` (sudah default) |

## Flag skrip

| Flag | Fungsi |
| --- | --- |
| `--variant full` \| `--variant chat` | Pilih varian (default: `full`) |
| `--open` | Sekaligus buka Android Studio setelah sync |
| `--skip-typecheck` | Lewati typecheck (hanya kalau baru saja dicek manual) |

## Alur "aman & cepat" yang direkomendasikan

```text
┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│ apk:build    │──▶ │ apk:open     │──▶ │ Build APK(s)     │
│ (2–3 menit)  │    │ (Studio)     │    │ (5–10 menit)     │
└──────────────┘    └──────────────┘    └──────────────────┘
       │                                          │
       └── typecheck + vite + cap sync            └── output di
           gagal? berhenti di sini, hemat 10m         android/app/build/…
```

Total: **~1 perintah shell + 3 klik di Studio**. Semua error web-side
ketahuan sebelum masuk Gradle.