---
name: rilis-android-ace
description: Prosedur rilis Ace Storage (mcmstorage.app) — build AAB/APK Android dan publish web Cloudflare, versionCode SSOT, clean install anti-konflik dependensi, verifikasi worker lokal, keystore, CI GitHub Actions, upload manual Play Console Internal testing, plus gerbang performa HP 360–430px. Pakai saat diminta bikin build baru, naikkan versi, publish ulang, perbaiki CI rilis, atau memastikan APK/AAB nyata bisa dipasang di HP.
---

# Rilis Ace Storage (Android + Web)

Aplikasi nyata, bukan simulasi. Artefak hanya boleh disebut siap kalau benar-benar
dibangun dari commit yang dimaksud dan lulus gerbang di bawah. Jangan pernah klaim
"sudah jadi" tanpa bukti build/uji.

## Fakta tetap proyek

- Satu aplikasi saja: **Ace Storage**, appId `mcmstorage.app`. Tidak ada flavor chat.
- SSOT versi: `android/version.properties` (`VERSION_CODE`, `VERSION_NAME`), dibaca
  `android/app/build.gradle`. Jangan edit manual — pakai `bun run version:bump`.
- Format versionCode: `YYMMDDNN` (contoh `26082202` = 22 Agu 2026, build ke-2).
- Build web untuk native WAJIB `CAPACITOR_BUILD=1` (`bun run build:mobile`), yang
  mematikan Nitro dan mengaktifkan mode SPA + `scripts/prepare-capacitor-web.mjs`.
  `bun run build` biasa = build SSR Cloudflare (situs live), bukan untuk APK.
- Typecheck rilis pakai `bunx tsc --noEmit`, bukan `tsgo` (pernah gagal di CI).
- Upload Play Console **manual permanen**. Org policy Google Cloud memblokir
  pembuatan service-account key — jangan tawarkan otomatisasi upload lagi.
- Track pertama = **Internal testing**. Workflow rilis manual-only
  (`.github/workflows/mcm-storage-play-release.yml`).

## Urutan kerja Android (jangan dibalik)

1. Pastikan commit/branch kanonik benar. Konfirmasi dulu bila ada repo mirip.
2. **Clean install tanpa cache** bila ada gejala resolusi dependensi aneh
   (mis. error `prefault` dari dua versi zod): hapus `node_modules` + lockfile
   stale, install ulang, baru lanjut. Jangan tambal error runtime yang sebenarnya
   konflik versi.
3. `bun run version:check` → bila artefak baru untuk Play, `bun run version:bump`.
4. Gerbang cepat: `bunx tsc --noEmit` dan `bunx vitest run`.
5. `bun run build:mobile` — harus exit 0, dan `dist` hasilnya berisi `index.html`
   dengan meta viewport (kalau hilang, WebView Android tampil zoom/blank).
6. Sinkron native: `bun run sync:native` (atau `npx cap sync android`).
7. Build artefak: APK debug untuk uji cepat, AAB signed untuk Play.
8. Verifikasi artefak sebelum lapor: nama file, ukuran > 0, dan `versionCode`
   di dalam artefak cocok dengan `android/version.properties`.

## Urutan kerja publish web (Cloudflare/SSR)

Publish bukan langkah terakhir yang dipercaya buta — situs bisa 500 walau publish
sukses. Sebelum menyatakan live:

1. `bun run build` (SSR) harus hijau.
2. Jalankan worker hasil build secara lokal (wrangler) dan cek minimal `/` dan
   satu rute publik → harus 200, log worker bersih.
3. Baru publish, lalu cek URL live sekali lagi.

Akar 500 yang sudah pernah terjadi — periksa ini dulu sebelum menebak:

- Bundel SSR terpecah jadi chunk saling-impor → `createMiddleware`/`createSsrRpc`
  undefined. Solusi: paksa satu chunk SSR di `vite.config.ts`.
- Modul server bocor ke graph klien (mis. `@tanstack/react-start/server` diimpor
  dari modul biasa) → pindahkan ke `*.server.ts` dan impor dinamis di handler.
- `crypto.randomUUID()` / nilai acak di lingkup modul → dilarang di Cloudflare
  Worker, bikin 500 global. Wajib inisialisasi malas.

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
- Sesudah rotasi kunci backend, `.env` diperbarui lalu **publish ulang** — kunci
  baru hanya berlaku di versi live setelah publish.
- Kalau secret kurang: berhenti, laporkan **BLOCKED** + nama secret persis yang
  harus diisi di GitHub → Settings → Secrets and variables → Actions.

## Performa aplikasi (cek sebelum rilis)

Gerbang ini melindungi HP kelas menengah Android 360–430px:

- Tidak ada render storm: timer/tick dipisah ke komponen sendiri, kartu list
  di-memo, list panjang pakai virtualisasi.
- Upload paralel dibatasi (maks 2, `async-pool.ts`).
- Tidak ada nilai acak/`crypto.randomUUID()` di lingkup modul.
- Key list stabil (pakai id, bukan indeks) supaya state tidak bergeser.
- Foto besar dikecilkan sebelum masuk scene editor (sisi terpanjang ~1600px).
- Draft (foto + catatan + GPS) bertahan saat WebView recreate.

## Format laporan ke pemilik

Bahasa Indonesia, singkat, tanpa opsi mengambang:

```text
Build: <artefak>
Commit: <sha7>  versionCode: <n>  versionName: <x>
Gerbang: tsc OK, tes OK, build:mobile OK, worker lokal 200
Langkah Anda: <satu tap konkret, mis. buka Play Console → Internal testing → Create new release → unggah AAB>
```

Kalau tersendat, tulis `BLOCKED: <sebab konkret>` + satu langkah manual persis,
lalu berhenti. Jangan optimisme, jangan bukti buatan.
