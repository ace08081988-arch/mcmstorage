# Build APK Android (Capacitor)

MCM Storage dibungkus dengan Capacitor sehingga bisa di-install sebagai APK
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

## Izin yang diminta otomatis

Saat aplikasi pertama kali dibuka di device native, MCM Storage akan
meminta empat izin sekaligus: **Notifikasi, Kamera, Lokasi, dan
Galeri/Foto**. User bisa menolak, dan dialog akan muncul lagi saat fitur
terkait dipakai.

## Catatan

- `appId` saat ini: `biz.mcmstorage.app` (ubah di `capacitor.config.ts`
  kalau perlu).
- Push notification hanya akan terkirim setelah Firebase Cloud Messaging
  ditambahkan. Izinnya tetap diminta sekarang supaya siap.