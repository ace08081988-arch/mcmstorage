---
name: rilis-android-ace
description: Prosedur rilis Android Ace Storage (mcmstorage.app) — build AAB/APK cepat dan benar, versionCode SSOT, keystore, CI GitHub Actions, upload manual ke Play Console, plus checklist performa aplikasi sebelum artefak dikirim. Pakai saat diminta bikin build baru, naikkan versi, perbaiki CI rilis, atau memastikan APK/AAB nyata bisa dipasang di HP.
---

# Rilis Android Ace Storage

Aplikasi nyata, bukan simulasi. Artefak hanya boleh disebut siap kalau benar-benar
dibangun dari commit yang dimaksud dan lulus gerbang di bawah. Jangan pernah klaim
"sudah jadi" tanpa bukti build.

## Fakta tetap proyek

- Satu aplikasi saja: **Ace Storage**, appId `mcmstorage.app`. Tidak ada flavor chat.
- SSOT versi: `android/version.properties` (`VERSION_CODE`, `VERSION_NAME`), dibaca
  `android/app/build.gradle`. Jangan edit manual — pakai `bun run version:bump`.
- Format versionCode: `YYMMDDNN` (contoh `26082202` = 22 Agu 2026, build ke-2).
- Build web untuk native WAJIB `CAPACITOR_BUILD=1` (`bun run build:mobile`), yang
  mematikan Nitro dan mengaktifkan mode SPA + `scripts/prepare-capacitor-web.mjs`.
  `bun run build` biasa = build SSR Cloudflare, bukan untuk APK.
- Typecheck rilis pakai `bunx tsc --noEmit`, bukan `tsgo` (pernah gagal di CI).
- Upload Play Console **manual permanen**. Org policy Google Cloud memblokir
  pembuatan service-account key — jangan tawarkan otomatisasi upload lagi.
- Track pertama = **Internal testing**. Workflow rilis manual-only
  (`.github/workflows/mcm-storage-play-release.yml`).

## Urutan kerja (jangan dibalik)

1. Pastikan commit/branch kanonik benar. Konfirmasi dulu bila ada repo mirip.
2. `bun run version:check` → bila artefak baru untuk Play, `bun run version:bump`.
3. Gerbang cepat: `bunx tsc --noEmit` dan `bunx vitest run`.
4. `bun run build:mobile` — harus exit 0, dan `dist` hasilnya berisi `index.html`
   dengan meta viewport (kalau hilang, WebView Android tampil zoom/blank).
5. Sinkron native: `bun run sync:native` (atau `npx cap sync android`).
6. Build artefak: APK debug untuk uji cepat, AAB signed untuk Play.
7. Verifikasi artefak sebelum lapor: cek nama file, ukuran > 0, dan `versionCode`
   di dalam artefak cocok dengan `android/version.properties`.

## Aturan artefak (pelajaran mahal)

- **Stale APK adalah kegagalan.** Kalau pemilik bilang perbaikannya tidak ada di
  build, jangan berdebat — cek commit SHA yang dipakai job build, bukan tanggal file.
- Build blank screen biasanya = aset web tidak ter-copy atau viewport/base path
  salah, bukan masalah izin/policy.
- Setiap laporan build sertakan: commit SHA, versionCode, versionName, nama artefak.

## Keystore & secrets

- `storeFile` harus path absolut (`$GITHUB_WORKSPACE/...`), bukan relatif.
- Secret keystore di-decode base64 tanpa spasi/newline liar ("invalid input" =
  base64 rusak, bukan keystore rusak).
- Jangan pernah mencetak, mengembalikan, atau meng-echo isi secret/keystore.
- Kalau secret kurang: berhenti, laporkan **BLOCKED** + nama secret persis yang
  harus diisi di GitHub → Settings → Secrets and variables → Actions.

## Performa aplikasi (cek sebelum rilis)

Gerbang ini melindungi HP kelas menengah Android 360–430px:

- Tidak ada render storm: timer/tick dipisah ke komponen sendiri, kartu list
  di-memo, list panjang pakai virtualisasi.
- Upload paralel dibatasi (maks 2, `async-pool.ts`).
- Tidak ada nilai acak/`crypto.randomUUID()` di lingkup modul — dibuat malas saat
  pertama dipakai (di Worker ini menyebabkan 500 global).
- Foto besar dikecilkan sebelum masuk scene editor (sisi terpanjang ~1600px).
- Draft (foto + catatan + GPS) bertahan saat WebView recreate.

## Format laporan ke pemilik

Bahasa Indonesia, singkat, tanpa opsi mengambang:

```text
Build: <artefak>
Commit: <sha7>  versionCode: <n>  versionName: <x>
Gerbang: tsc OK, tes OK, build:mobile OK
Langkah Anda: <satu tap konkret, mis. buka Play Console → Internal testing → Create new release → unggah AAB>
```

Kalau tersendat, tulis `BLOCKED: <sebab konkret>` + satu langkah manual persis,
lalu berhenti. Jangan optimisme, jangan bukti buatan.
