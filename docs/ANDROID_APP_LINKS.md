# Android App Links (HTTPS terverifikasi) — MCM Storage

Manifest sudah mendeklarasikan intent-filter `autoVerify="true"` untuk:

| Host | Path prefix | Dipakai untuk |
|---|---|---|
| `mcmstorage.app` | `/t/` | Portal tugas pegawai (`/t/<share_token>`) |
| `mcmstorage.app` | `/undang` | Link undangan |
| `www.mcmstorage.app` | `/t/`, `/undang` | Sama, host www |

Scheme kustom mengikuti package Play: `mcmstorage.app://…`.

## Yang harus dipasang owner (belum bisa otomatis)

Verifikasi App Links hanya jalan kalau file berikut dapat diakses publik
tanpa redirect, dengan `Content-Type: application/json`:

```
https://mcmstorage.app/.well-known/assetlinks.json
https://www.mcmstorage.app/.well-known/assetlinks.json
```

Isi file (ganti `SHA_256_CERT_FINGERPRINT`):

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "mcmstorage.app",
      "sha256_cert_fingerprints": [
        "AA:BB:CC:...:FF"
      ]
    }
  }
]
```

## Fingerprint mana yang dipakai?

Masukkan **semua** fingerprint yang mungkin menandatangani APK yang dipasang user:

1. **Play App Signing** (wajib kalau distribusi lewat Play):
   Play Console → Release → Setup → App signing → *SHA-256 certificate fingerprint*.
2. **Upload key** (keystore lokal Anda) — untuk APK yang dipasang manual di luar Play:
   ```bash
   bun run aab:fingerprints            # cetak MD5/SHA-1/SHA-256 dari keystore
   bun run aab:fingerprints:copy:sha256
   ```
3. **Debug keystore** (opsional, hanya untuk uji lokal):
   ```bash
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey \
     -storepass android -keypass android
   ```

## Verifikasi setelah rilis

```bash
# 1. File terjangkau & JSON valid
curl -sI https://mcmstorage.app/.well-known/assetlinks.json

# 2. Cek status verifikasi di perangkat (Android 12+)
adb shell pm get-app-links mcmstorage.app
# harapkan: mcmstorage.app: verified

# 3. Paksa verifikasi ulang
adb shell pm verify-app-links --re-verify mcmstorage.app
```

Kalau statusnya bukan `verified`, link tetap terbuka di browser (tidak ada
kerusakan fungsional) — perbaiki assetlinks lalu re-verify.

