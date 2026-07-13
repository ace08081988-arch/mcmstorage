# Deep Link iOS — `biz.mcmstorage.app://`

Runtime handler sudah lintas-platform (`src/lib/native-deeplink.ts` via
`@capacitor/app`). Yang khas iOS hanyalah pendaftaran custom URL scheme di
`Info.plist`.

## Langkah sekali setup

```bash
bunx cap add ios              # buat folder ios/ (kalau belum ada)
node scripts/patch-ios-deeplink.mjs
bunx cap sync ios
```

`scripts/patch-ios-deeplink.mjs` menambahkan `CFBundleURLTypes` dengan
scheme `biz.mcmstorage.app` ke `ios/App/App/Info.plist`. Skrip idempoten —
aman dijalankan ulang setiap kali Info.plist diregenerasi.

## Uji cepat di simulator/perangkat

```bash
xcrun simctl openurl booted "biz.mcmstorage.app://t/TOKEN?p=1234"
```

Atau di Safari iPhone, ketuk link:

```
biz.mcmstorage.app://t/TOKEN?p=1234
```

Aplikasi akan terbuka di `/t/TOKEN#p=1234` dan form PIN terisi otomatis
dari fragment (persis seperti Android).

## Universal Link (opsional, nanti)

Untuk membuka link `https://mcmstorage.biz/t/...` langsung ke app tanpa
Safari, butuh:
1. File `apple-app-site-association` di root domain `mcmstorage.biz`
   (mirip `assetlinks.json` untuk Android).
2. Associated Domains capability + entitlement di Xcode.

Custom scheme di atas sudah cukup untuk auto-fill PIN dari QR code /
share link internal — Universal Link ditunda sampai dibutuhkan.