# Release Checklist — MCM Storage (`mcmstorage.app`)

> Project ini HANYA merilis satu aplikasi Android: **MCM Storage**.
> Aplikasi chat privat umum (`com.mcm.privateconnect`) adalah project terpisah
> dan tidak pernah dibangun dari repo ini.

## Identity Matrix (wajib cocok)

| Item | Nilai |
|------|-------|
| Nama aplikasi | `MCM Storage` |
| applicationId / package Play | `mcmstorage.app` |
| Namespace sumber Java (bukan identitas Play) | `biz.mcmstorage.app` |
| Activity class explicit | `biz.mcmstorage.app.MainActivity` |
| Component untuk adb | `mcmstorage.app/biz.mcmstorage.app.MainActivity` |
| Capacitor `appId` | `mcmstorage.app` |
| Web aktif | `https://mcmstorage.lovable.app` |
| Track rilis tahap ini | `internal` (Internal testing) saja |

> `namespace` ≠ `applicationId`. Namespace hanya menentukan paket kelas Java/R,
> sedangkan `applicationId` (`mcmstorage.app`) adalah identitas di Google Play
> dan Firebase. Keduanya memang berbeda — itu bukan kesalahan konfigurasi.

## Kontrak Secrets (satu-satunya nama yang valid)

| Secret | Isi |
|--------|-----|
| `KEYSTORE_BASE64` | keystore upload/rilis, base64 |
| `KEYSTORE_ALIAS` | alias key |
| `KEYSTORE_STORE_PASSWORD` | password store |
| `KEYSTORE_KEY_PASSWORD` | password key |
| `GOOGLE_SERVICES_JSON_B64` | `google-services.json` Firebase untuk package `mcmstorage.app`, base64 |
| `PLAY_SERVICE_ACCOUNT_JSON_B64` | service account Play (akses ke `mcmstorage.app`), base64 |

Nilai secret tidak pernah dicetak ke log/artifact. Nama-nama secret lama
(varian berawalan `MCM_STORAGE_…` dan `ANDROID_…`) sudah dihapus dari seluruh
workflow, skrip, dan dokumentasi — hanya enam nama di tabel ini yang berlaku.


> Copy-paste template untuk setiap upload AAB ke Google Play Console.
> Ganti placeholder `{{ ... }}` sesuai rilis yang sedang dikerjakan, atau jalankan `bun run release:checklist` untuk mengisinya otomatis.

---

## Metadata Rilis

| Item | Nilai |
|------|-------|
| Versi | `{{ 1.2.3 }}` |
| Version Code | `{{ 5 }}` |
| Tanggal rilis | `{{ 12 Juli 2026 }}` |
| Branch | `{{ main }}` |
| Commit SHA | `{{ abc1234 }}` |
| AAB path | `dist/app-release.aab` |

---

## Pre-upload Validation

- [ ] Bekerja di branch bersih: `git status` tidak ada file yang belum di-commit.
- [ ] `bun run version:check` berhasil dan menampilkan versionCode `{{ 5 }}` / versionName `{{ 1.2.3 }}` (SSOT: `android/version.properties`).
- [ ] Bump versi dilakukan eksplisit sekali (`bun run version:bump`) dan sudah di-commit — build/dry-run tidak menaikkan versi.
- [ ] Debug APK QA hijau: workflow **Android Debug APK (QA)** menghasilkan artifact + SHA-256.
- [ ] Version code lebih besar dari rilis sebelumnya di Play Console.
- [ ] Format versionName valid (contoh: `1.2.3`, `1.2.3-beta.1`).
- [ ] File AAB sudah dibangun: `bun run aab:build:release` → `dist/app-release.aab` ada.
- [ ] Preflight strict lolos: `bun run aab:preflight`.
- [ ] Changelog / release notes sudah ditulis (lihat bagian Changelog di bawah).
- [ ] Keystore dan `keystore.properties` sudah diamankan (tidak ikut ke repo).
- [ ] Tidak mengunggah APK ke Production (AAB wajib untuk production).
- [ ] `assetlinks.json` terpasang & `adb shell pm get-app-links mcmstorage.app` = `verified` (lihat `docs/ANDROID_APP_LINKS.md`).
- [ ] SHA-256 artifact dicatat (`dist/checksums/SHA256SUMS.txt` dari workflow).
- [ ] `mapping.txt` tersimpan di `dist/mapping/` untuk deobfuscation.

---

## Lokal Smoke Test (sebelum upload)

- [ ] Konversi AAB ke APK: `bun run aab:to-apk --aab dist/app-release.aab --out dist/mcm.apk`.
- [ ] Install ke HP test: `bun run apk:install:launch -- --apk dist/mcm.apk`.
- [ ] Buka aplikasi dan verifikasi splash screen / halaman utama muncul.
- [ ] Cek versi yang terpasang di perangkat sesuai `{{ 1.2.3 }} ({{ 5 }})`.
- [ ] Jalankan flow kritis yang baru diubah: `{{ ... }}`.

---

## Internal Testing Track

- [ ] Buka [Google Play Console](https://play.google.com/console) → Pilih aplikasi.
- [ ] Pilih menu **Rilis → Testing → Internal testing**.
- [ ] Klik **Create release** / **Buat rilis**.
- [ ] Upload AAB: `dist/app-release.aab`.
- [ ] Isi **Release name**: `{{ 1.2.3 (5) }}`.
- [ ] Isi **Release notes** (Bahasa Indonesia + Inggris wajib):
  - Indonesia: `{{ ... }}`
  - English: `{{ ... }}`
- [ ] Klik **Review release**.
- [ ] Klik **Start rollout to Internal testing**.
- [ ] Bagikan link internal testing ke tester (biasanya diri sendiri / tim kecil).
- [ ] Install dari link internal testing di HP dan lakukan smoke test ulang.

---

## Production Track — DIKUNCI

Tahap ini **tidak** merilis ke closed testing, open testing, atau production.
`scripts/upload-play.mjs` menolak track selain `internal`, dan workflow
`MCM Storage Play Release` hanya menyediakan pilihan `internal`.
Buka kembali bagian ini hanya setelah keputusan produk eksplisit.

---

## Changelog (copy-paste ke Play Console)

### Bahasa Indonesia

```
## {{ 1.2.3 }} ({{ 5 }}) — {{ 12 Juli 2026 }}

- Ditambahkan: {{ fitur baru A }}
- Diperbaiki: {{ bug B }}
- Diubah: {{ penyesuaian C }}
```

### English

```
## {{ 1.2.3 }} ({{ 5 }}) — {{ July 12, 2026 }}

- Added: {{ new feature A }}
- Fixed: {{ bug B }}
- Changed: {{ adjustment C }}
```

---

## One-liner Commands

```bash
# Cek versi
bun run version:check

# Build AAB release
bun run aab:build:release

# Validasi preflight
bun run aab:preflight

# Konversi AAB ke APK untuk testing
bun run aab:to-apk --aab dist/app-release.aab --out dist/mcm.apk

# Install + buka di HP
bun run apk:install:launch -- --apk dist/mcm.apk

# Launch manual lewat adb (component faktual)
adb shell am start -n mcmstorage.app/biz.mcmstorage.app.MainActivity

# Tag rilis
git tag -a v{{ 1.2.3 }} -m "Release {{ 1.2.3 }}"
git push origin v{{ 1.2.3 }}
```

---

## Post-release

- [ ] Tag Git sudah di-push: `v{{ 1.2.3 }}`.
- [ ] Catat tanggal rilis aktif di Play Console.
- [ ] Backup AAB final dan keystore ke lokasi aman.
- [ ] Update dokumentasi / README jika diperlukan.
- [ ] Siapkan feedback channel untuk laporan pengguna.

---

## Catatan / Issue Khusus Rilis Ini

```
{{ Tulis catatan khusus di sini: dependensi baru, perubahan besar, risiko, dsb. }}
```
