# Panduan Rilis ke Google Play Console

Dokumen ringkas ini menjelaskan langkah menyiapkan secrets, menjalankan mode **build-only** (signed AAB + artifact), dan memastikan versi benar sebelum upload AAB ke Play Console.

**Package name aplikasi ACE STORAGE di Play Console: `mcmstorage.app`** (varian chat: `biz.mcmstorage.chat`).
`namespace` sumber Android tetap `biz.mcmstorage.app` — itu hanya paket kelas Java, bukan identitas app di Play.

---

## 1. Siapkan secrets di GitHub

Buka **Settings → Secrets and variables → Actions → New repository secret**, lalu tambahkan:

| Secret | Cara mendapatkan nilai |
| --- | --- |
| `KEYSTORE_BASE64` | `base64 -w0 android/mcm.keystore` |
| `KEYSTORE_ALIAS` | Alias yang dipakai saat membuat keystore |
| `KEYSTORE_STORE_PASS` | Password store keystore |
| `KEYSTORE_KEY_PASS` | Password key keystore |
| `PLAY_SERVICE_ACCOUNT_JSON_B64` | *(hanya untuk `dry_run=false`/upload otomatis)* `base64 -w0 service-account.json` dari Google Play Console |
| `SLACK_WEBHOOK_URL` | *(opsional)* Webhook Slack untuk notifikasi rilis |

> Mode default workflow (`dry_run=true`) adalah **build-only**: hanya 4 secret keystore
> di atas yang wajib. Play Developer API tidak dipanggil sama sekali.

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

## 4. Jalankan build-only (upload manual ke Play Console)

1. Buka tab **Actions** di GitHub.
2. Pilih workflow **"Build & Release AAB"**.
3. Klik **Run workflow**.
4. Isi input seperti ini:
   - **variant**: `full`
   - **track**: `internal`
   - **release_status**: `draft`
   - **dry_run**: ✅ **true** (centang) → build-only
   - **skip_version_check**: ❌ **false**
5. Klik **Run workflow**.

Build-only akan:

- Build **signed** AAB (`app-release.aab`)
- Validasi keystore
- Mengunggah artifact `aab-full-<run_number>` (berisi `app-release.aab` + mapping + SHA-256)
- **Tidak** memanggil Play Developer API (tidak upload, tidak cek versi remote)

Unduh artifact-nya, lalu unggah `app-release.aab` secara manual di Play Console.

Tunggu sampai workflow selesai. Buka **Actions → run → Summary** untuk melihat:

- Path artifact AAB
- Hasil cek versi
- Pesan error kalau ada

---

## 5. Pastikan build-only lolos

Cek di job summary:

- ✅ **"job berhasil"**
- ✅ Tidak ada pesan error di step "Build + release AAB"
- ✅ `versionCode` yang di-build lebih tinggi dari yang sudah pernah diunggah di Play Console
  (saat ini `versionCode=2`, `versionName=1.0.0`)

Kalau ada error, perbaiki dulu sebelum lanjut ke upload nyata.

---

## 6. Upload ke Play Console

Setelah build-only lolos (opsi otomatis; butuh `PLAY_SERVICE_ACCOUNT_JSON_B64`):

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
