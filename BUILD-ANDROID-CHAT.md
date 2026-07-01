# Build APK MCM Chat (chat-only)

Codebase yang sama seperti MCM Storage, hanya UI storage disembunyikan
lewat flag `VITE_APP_MODE=chat`. Backend Lovable Cloud tetap SATU — user
MCM Chat dan MCM Storage saling terhubung (kontak, pesan, notifikasi).

## Perbedaan dengan APK penuh

|                  | MCM Storage          | MCM Chat              |
| ---------------- | -------------------- | --------------------- |
| `appId`          | `biz.mcmstorage.app` | `biz.mcmstorage.chat` |
| `appName`        | MCM Storage          | MCM Chat              |
| `VITE_APP_MODE`  | `full` (default)     | `chat`                |
| Sidebar          | Semua grup           | Komunikasi/Akun/Sistem |
| Beranda `/`      | Dashboard            | Redirect ke `/chat`   |

Karena `appId` beda, kedua APK bisa terpasang **berdampingan** di HP yang
sama tanpa saling menimpa.

## Langkah build

```bash
# 1. install (sekali)
bun install
bunx cap add android   # kalau folder android/ belum ada

# 2. build web + sync APK chat-only
bun run apk:chat

# 3. buka Android Studio → Build → Build APK(s)
bunx cap open android
```

APK hasilnya di `android/app/build/outputs/apk/`. Rename ke
`mcm-chat.apk` sebelum diunggah ke halaman `/download`.

## Kembali ke APK penuh

```bash
bun run apk:full
```

Perintah `apk:full` dan `apk:chat` menimpa folder `android/` yang sama
(`appId` di `AndroidManifest.xml` di-generate ulang dari
`capacitor.config.ts`). Jangan lupa **rebuild APK di Android Studio**
setiap kali ganti varian, dan simpan APK hasilnya sebelum switch.

## Testing tanpa rebuild

Di browser preview, buka DevTools → Console:

```js
localStorage.setItem("mcm.appMode", "chat"); location.reload();
```

Untuk kembali:

```js
localStorage.removeItem("mcm.appMode"); location.reload();
```

Override ini juga tersedia di halaman **Pengaturan → Mode aplikasi**.
