# Panduan Rilis ke Google Play Console

Dokumen ringkas ini menjelaskan langkah menyiapkan secrets, menjalankan dry-run, dan memastikan versi benar sebelum upload AAB ke Play Console.

---

## 1. Siapkan secrets di GitHub

Buka **Settings → Secrets and variables → Actions → New repository secret**, lalu tambahkan:

| Secret | Cara mendapatkan nilai |
| --- | --- |
| `KEYSTORE_BASE64` | `base64 -w0 android/mcm.keystore` |
| `KEYSTORE_ALIAS` | Alias yang dipakai saat membuat keystore |
| `KEYSTORE_STORE_PASS` | Password store keystore |
| `KEYSTORE_KEY_PASS` | Password key keystore |
| `PLAY_SERVICE_ACCOUNT_JSON_B64` | `base64 -w0 service-account.json` dari Google Play Console |
| `SLACK_WEBHOOK_URL` | *(opsional)* Webhook Slack untuk notifikasi rilis |

> **Catatan:** Semua nilai di atas harus di-generate/sendiri oleh pemilik akun Play Console. Jangan bagikan file keystore atau service account ke siapa pun.

### 1a. Membuat keystore baru (kalau belum punya)

```bash
keytool -genkey -v \
  -keystore android/mcm.keystore \
  -alias mcm \
  -keyalg RSA -keysize 2048 -validity 10000
```

Catat password store, password key, dan alias-nya.

### 1b. Membuat service account Play Console

1. Buka Google Play Console → **Setup → API access**.
2. Hubungkan project Google Cloud.
3. Buat service account dengan role **Release Manager** (atau minimal permission untuk mengelola rilis).
4. Buat key JSON, simpan sebagai `service-account.json`.

---

## 2. Pastikan folder Android sudah ada

Pastikan `android/` sudah ter-commit di repo. Kalau belum:

```bash
bunx cap add android
git add android
git commit -m "chore: add android scaffold"
git push
```

---

## 3. Periksa dan sesuaikan versi

Buka `android/app/build.gradle`, pastikan nilai ini benar:

```gradle
defaultConfig {
    versionCode 1
    versionName "1.0"
}
```

Aturan:

- `versionCode` harus **lebih besar** dari versi yang sudah ada di Play Console.
- `versionName` bebas, tapi disarankan mengikuti semver (misal `1.0.0`).

Untuk rilis berikutnya, naikkan `versionCode` secara manual atau biarkan workflow menaikkannya otomatis (default workflow sudah bump otomatis untuk rilis non-debug).

---

## 4. Jalankan dry-run pertama

1. Buka tab **Actions** di GitHub.
2. Pilih workflow **"Build & Release AAB"**.
3. Klik **Run workflow**.
4. Isi input seperti ini:
   - **variant**: `full`
   - **track**: `internal`
   - **release_status**: `draft`
   - **dry_run**: ✅ **true** (centang)
   - **skip_version_check**: ❌ **false**
5. Klik **Run workflow**.

Dry-run akan:

- Build AAB
- Validasi keystore
- Cek `versionCode` lokal vs Play Console
- **Tidak mengupload** apa pun

Tunggu sampai workflow selesai. Buka **Actions → run → Summary** untuk melihat:

- Path artifact AAB
- Hasil cek versi
- Pesan error kalau ada

---

## 5. Pastikan dry-run lolos

Cek di job summary:

- ✅ **"job berhasil"**
- ✅ Tidak ada pesan error di step "Build + release AAB"
- ✅ Tabel perbandingan versi lokal vs Play Console menunjukkan `versionCode` lebih tinggi dari yang sudah terbit

Kalau ada error, perbaiki dulu sebelum lanjut ke upload nyata.

---

## 6. Upload ke Play Console

Setelah dry-run lolos:

1. Buka workflow **"Build & Release AAB"** lagi.
2. Klik **Run workflow**.
3. Isi input:
   - **variant**: `full`
   - **track**: `internal` (atau `alpha`, `beta`, `production`)
   - **release_status**: `draft` (atau `inProgress`)
   - **dry_run**: ❌ **false**
   - **skip_version_check**: ❌ **false**
4. Klik **Run workflow**.

Workflow akan mengupload AAB ke track yang dipilih. Setelah berhasil:

- Buka **Google Play Console → Release → Testing / Production**.
- Lanjutkan review dan publikasikan sesuai track.

---

## 7. Setelah rilis

- Naikkan `versionCode` di `android/app/build.gradle` untuk rilis berikutnya.
- Simpan backup `android/mcm.keystore` dan `service-account.json` di tempat aman.
- Jangan commit file keystore atau service account ke repo.

---

## Ringkasan perintah cepat

```bash
# Buat keystore
keytool -genkey -v -keystore android/mcm.keystore -alias mcm -keyalg RSA -keysize 2048 -validity 10000

# Base64 keystore & service account
base64 -w0 android/mcm.keystore
base64 -w0 service-account.json

# Pastikan android/ sudah ter-commit
bunx cap add android
git add android && git commit -m "chore: add android scaffold"
```
