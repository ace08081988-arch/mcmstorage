# QA Ikon iOS (Apple Touch Icon)

Panduan uji + cache-clear supaya ikon MCM konsisten di iPhone/iPad setelah
update branding. iOS sangat agresif meng-cache `apple-touch-icon` di level
home screen — reload browser saja **tidak cukup**.

## Aset yang harus valid

| File | Ukuran | Wajib |
| ---- | ------ | ----- |
| `/apple-touch-icon.png` | 180×180 PNG, opaque, no alpha transparency | ✅ |
| `/apple-touch-icon-precomposed.png` (opsional fallback iOS lama) | 180×180 | ⛔ opsional |
| `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">` di `src/routes/__root.tsx` | — | ✅ |
| `manifest.webmanifest` → entri icons memuat `/apple-touch-icon.png` | — | ✅ |

Cek cepat di sandbox:

```bash
file public/apple-touch-icon.png            # harus 180 x 180
grep apple-touch-icon src/routes/__root.tsx public/manifest.webmanifest
curl -sI https://mcmstorage.biz/apple-touch-icon.png | grep -i -E "content-type|cache-control"
```

`content-type` wajib `image/png`. Kalau `cache-control` `immutable`/`max-age`
besar, revisi ikon HARUS lewat versi baru (rename file atau ganti hash) —
iOS tidak akan revalidate sebelum TTL habis.

## Uji visual di Safari iOS

1. **Full cache clear** sebelum tes:
   - Settings → Safari → **Clear History and Website Data**.
   - (Kalau app sudah terpasang di Home Screen) tekan lama ikon → **Remove App → Delete from Home Screen**.
2. Buka `https://mcmstorage.biz` di Safari (bukan Chrome iOS — Chrome pakai WebKit tapi cache terpisah).
3. Tap **Share → Add to Home Screen**.
4. Verifikasi di dialog preview: ikon harus versi MCM terbaru, bukan placeholder abu-abu / ikon lama.
5. Tap **Add**, lalu cek ikon di Home Screen (juga di folder App Library).
6. Tap ikon → splash screen & status bar warna sesuai `theme_color` manifest.

## Uji di Chrome iOS / in-app browser (WA, IG)

- Chrome/Edge iOS: buka situs → menu ⋯ → **Add to Home Screen**. Ikon
  diambil dari `apple-touch-icon` yang sama.
- WhatsApp/Instagram in-app browser: preview link menampilkan
  `apple-touch-icon` sebagai favicon kecil. Force-close app in-app browser
  sebelum retest agar preview refresh.

## Kalau ikon lama masih muncul

Urutan cache-clear paling ampuh (lakukan bertahap sampai ikon update):

1. Safari → Reload dengan **Request Desktop Website** lalu balikkan.
2. Settings → Safari → **Advanced → Website Data** → cari `mcmstorage.biz` → Swipe **Delete**.
3. Hapus ikon dari Home Screen, lalu **restart** iPhone (bukan sekadar lock).
4. Safari → Settings → **Clear History and Website Data** (semua situs).
5. Naikkan `SW_VERSION` di `public/sw-push.js` + bump nama file ikon
   (mis. `apple-touch-icon.png` → `apple-touch-icon-v2.png` dan update
   referensi di `__root.tsx` + `manifest.webmanifest`). Ini menembus cache
   CDN + iOS Home Screen tanpa perlu user hard-reset.

## Checklist rilis setelah rebrand

- [ ] File `public/apple-touch-icon.png` 180×180, opaque, ≤ 100 KB.
- [ ] Referensi konsisten di `__root.tsx`, `manifest.webmanifest`, `sw-push.js` precache list.
- [ ] `SW_VERSION` di `public/sw-push.js` dinaikkan.
- [ ] Bila desain ikon berubah signifikan → rename file (cache-bust).
- [ ] Uji di 1× iPhone Safari (Add to Home Screen) + 1× Chrome iOS.
- [ ] Uji preview link di WhatsApp (share URL ke chat sendiri).
- [ ] Konfirmasi visual: ikon Home Screen = ikon share sheet = favicon browser tab.

## Automated smoke test

Playwright headless tidak bisa mensimulasikan Add-to-Home-Screen iOS, tapi
bisa verifikasi header & referensi:

```bash
curl -sI https://mcmstorage.biz/apple-touch-icon.png | grep -iE "^(HTTP|content-type|content-length)"
curl -s https://mcmstorage.biz/ | grep -o 'apple-touch-icon[^>]*'
curl -s https://mcmstorage.biz/manifest.webmanifest | grep apple-touch-icon
```

Ekspektasi: HTTP 200, `image/png`, `content-length` > 3 KB, dan kedua HTML
+ manifest merujuk path yang sama.