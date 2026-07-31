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

### Izin tambahan untuk panggilan (Mikrofon + Overlay)

Fitur MCM Chat butuh dua izin ekstra yang **wajib dideklarasi manual** di
`android/app/src/main/AndroidManifest.xml` setelah `bunx cap add android`
atau `bunx cap sync android` (Capacitor tidak menambahkannya sendiri).

Tambahkan di dalam `<manifest>` sejajar dengan `<uses-permission>` yang
sudah ada:

```xml
<!-- Mikrofon untuk panggilan audio/video (WebRTC getUserMedia) -->
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

<!-- Tampilkan di atas aplikasi lain — dipakai untuk floating incoming call
     dan notifikasi panggilan saat aplikasi di background -->
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
```

> `SYSTEM_ALERT_WINDOW` di Android 6+ adalah **special permission**: user
> harus meng-approve manual lewat Setelan → Aplikasi → MCM Storage →
> "Tampilkan di atas aplikasi lain". Deklarasi manifest saja tidak cukup —
> aplikasi harus mengarahkan user ke halaman itu dengan intent
> `Settings.ACTION_MANAGE_OVERLAY_PERMISSION` saat pertama kali fitur
> incoming-call overlay dipakai.

`RECORD_AUDIO` akan diminta otomatis oleh WebView saat `getUserMedia`
dipanggil pertama kali (di dalam layar panggilan).

## Catatan

- `appId` saat ini: `biz.mcmstorage.app` (ubah di `capacitor.config.ts`
  kalau perlu).
- Push notification hanya akan terkirim setelah Firebase Cloud Messaging
  ditambahkan. Izinnya tetap diminta sekarang supaya siap.