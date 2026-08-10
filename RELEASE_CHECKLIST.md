# Release Checklist — Ace Storage / Ace Chat

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
- [ ] Preflight strict lolos: `bun run aab:preflight:strict`.
- [ ] Changelog / release notes sudah ditulis (lihat bagian Changelog di bawah).
- [ ] Keystore dan `keystore.properties` sudah diamankan (tidak ikut ke repo).
- [ ] Tidak mengunggah APK ke Production (AAB wajib untuk production).
- [ ] `assetlinks.json` terpasang & `adb shell pm get-app-links biz.mcmstorage.app` = `verified` (lihat `docs/ANDROID_APP_LINKS.md`).
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

## Production Track

> Lanjutkan hanya setelah internal testing lolos smoke test.

- [ ] Pilih menu **Rilis → Production**.
- [ ] Klik **Create release** / **Buat rilis**.
- [ ] Upload AAB yang sama dan final: `dist/app-release.aab`.
- [ ] Isi **Release name**: `{{ 1.2.3 (5) }}`.
- [ ] Isi **Release notes** untuk setiap bahasa aktif:
  - Indonesia: `{{ ... }}`
  - English: `{{ ... }}`
- [ ] Klik **Review release**.
- [ ] Periksa peringatan/error Play Console (content rating, policy, dsb).
- [ ] Klik **Start rollout to Production**.
- [ ] Pantau status review Google (bisa memakan waktu beberapa jam hingga beberapa hari).
- [ ] Setelah rilis aktif, cek aplikasi dari perangkat pengguna / akun non-developer.

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
bun run aab:preflight:strict

# Konversi AAB ke APK untuk testing
bun run aab:to-apk --aab dist/app-release.aab --out dist/mcm.apk

# Install + buka di HP
bun run apk:install:launch -- --apk dist/mcm.apk

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
