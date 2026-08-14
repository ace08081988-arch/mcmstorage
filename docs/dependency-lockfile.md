# Lockfile Bun: `bun.lock` vs `bun.lockb`

Repo ini **wajib** memakai lockfile teks `bun.lock`. `bun.lockb` (biner) tidak
boleh di-commit.

## Kenapa teks

| Kebutuhan | `bun.lock` (teks) | `bun.lockb` (biner) |
| --- | --- | --- |
| Diff di PR / code review | ✅ terbaca baris per baris | ❌ "binary file changed" |
| Dependabot / Renovate | ✅ bisa membuat & mem-parse patch | ⚠️ sering gagal/menimpa buta |
| Scanner dependency (`bun audit`, gate CI) | ✅ versi transitif bisa diverifikasi dari commit | ❌ harus install dulu untuk tahu isinya |
| Merge conflict | ✅ bisa diselesaikan manual | ❌ harus regenerasi |
| Ukuran/kecepatan install | sedikit lebih lambat dibaca | sedikit lebih cepat |

Karena setiap perubahan dependency di sini harus lolos gate `audit:deps:ci`,
`audit:router-versions`, dan komentar **Dependency PR Changelog**, isi lockfile
harus bisa dibaca langsung dari commit — jadi teks menang.

## Aturan singkat

- **Selalu `bun.lock`.** `saveTextLockfile = true` sudah diset di `bunfig.toml`,
  jadi `bun install` menghasilkan format teks secara otomatis.
- **Jangan commit `bun.lockb`.** Sudah masuk `.gitignore`, dan
  `bun run check:lockfile` (jalan di `prebuild` + CI) menggagalkan build kalau
  file itu muncul.
- **Kapan `bun.lockb` boleh dipakai?** Hanya lokal dan sementara — misalnya
  eksperimen install cepat di mesin sendiri. Hapus sebelum commit.

## Gate CI

Tiga lapis pengaman, dari paling awal:

1. **pre-commit** (`.githooks/pre-commit`) — menolak commit yang men-stage
   `bun.lockb`. Kalau format lockfile belum sesuai, hook otomatis menjalankan
   `bun run fix:lockfile` lalu men-stage `bun.lock`/`bunfig.toml` hasil
   perbaikannya ke commit yang sedang berjalan. Lewati auto-fix dengan
   `SKIP_LOCKFILE_FIX=1`, atau seluruh cek dengan `SKIP_LOCKFILE_CHECK=1`.
2. **pre-push** (`.githooks/pre-push`) — menjalankan `bun run check:lockfile`
   sebelum push, jadi masalah ketahuan sebelum PR dibuat. Lewati hanya kalau
   benar-benar perlu: `SKIP_LOCKFILE_CHECK=1 git push`.
3. **CI** — workflow di bawah.

Aktifkan hook dengan `bun run hooks:install` (otomatis lewat `prepare` saat
`bun install`).

Workflow **Lockfile Format** (`.github/workflows/lockfile-format.yml`) menjalankan
pada setiap PR ke `main` (dan push ke `main`), sebagai status check tersendiri
bernama **check:lockfile (format lockfile teks)**:

1. `bun run check:lockfile` — validasi format.
2. `bun run fix:lockfile` — regenerasi lockfile di runner.
3. `git diff -- bun.lock bunfig.toml` — build **gagal** kalau hasil regenerasi
   berbeda dari yang di-commit (lockfile tidak sinkron dengan `package.json`).
   Diff-nya ditampilkan di job summary.

Kalau gagal, job summary menampilkan output pemeriksaan plus perintah perbaikan
(`bun run fix:lockfile`). Jadikan check ini required di branch protection agar PR
dengan lockfile biner tidak bisa di-merge.

## Prosedur update dependency

```bash
# 1. Ubah versi/overrides di package.json
# 2. Regenerasi lockfile teks
bun install
# 3. Verifikasi
bun run check:lockfile
bun run audit:router-versions
bun run audit:deps:ci
bunx vitest run
bun run build
```

## Migrasi kalau terlanjur ada `bun.lockb`

Cara cepat (otomatis):

```bash
bun run fix:lockfile
```

Script `scripts/fix-lockfile.mjs` melakukan semuanya sesuai aturan di dokumen
ini: menyetel `saveTextLockfile = true` di `bunfig.toml` bila belum ada,
menghapus `bun.lockb` (termasuk dari index git kalau terlacak), meregenerasi
`bun.lock` teks lewat `bun install --save-text-lockfile`, lalu memverifikasi
hasilnya dengan `check:lockfile`. Exit code non-nol kalau masih gagal.

### Pratinjau tanpa menulis apa pun (dry-run)

```bash
bun run fix:lockfile:dry     # sama dengan: bun run fix:lockfile -- --dry-run
```

Mode ini **tidak** menulis `bunfig.toml`, **tidak** menghapus `bun.lockb`, dan
**tidak** menimpa `bun.lock`. Lockfile diregenerasi di direktori sementara lalu
dibandingkan dengan yang ada di repo, sehingga kamu melihat daftar rencana
perubahan plus diff `bun.lock`. Exit code `0` bila sudah sinkron, `1` bila masih
ada yang perlu diperbaiki — cocok dipakai sebagai pengecekan cepat sebelum commit.

### Ringkasan audit

Baik mode apply maupun dry-run selalu menutup dengan blok
**RINGKASAN AUDIT LOCKFILE** berisi tiga bagian: (1) file yang diubah, (2)
dependensi yang berubah — `+` tambah, `~` naik/turun versi (`lama → baru`), `-`
hapus, dengan total per kategori, dan (3) status verifikasi `check:lockfile`
beserta kesimpulan sinkron/perlu diperbaiki. Blok ini bisa langsung ditempel ke
PR atau log audit.

Cara manual:

```bash
rm -f bun.lockb
bun install            # menulis ulang bun.lock (teks)
bun run check:lockfile
```

Jangan menghapus `bun.lock` hanya karena install gagal 401/403 — itu biasanya
token registry yang kedaluwarsa, bukan lockfile-nya. Hapus lockfile hanya saat
registry/scope di `bunfig.toml` benar-benar berubah.

## Format changelog PR dependency (wajib)

Komentar changelog pada PR dependency dihasilkan otomatis oleh
`node scripts/dep-pr-changelog.mjs` dan divalidasi oleh gate
`node scripts/check-dep-pr-changelog.mjs` (job **Dependency PR Changelog**).
PR tidak boleh di-merge sebelum gate ini lulus.

Template yang diwajibkan:

1. Judul `## 📦 Ringkasan update dependency`.
2. Tabel versi `| Paket | Perubahan | Info |` dengan tiap baris memuat
   `lama` → `baru` (atau penanda `baru`/`dihapus`). Bila PR hanya menyentuh
   lockfile, wajib ada kalimat "Tidak ada perubahan versi di `package.json`".
3. Bagian `### 🛡️ Security fix` selalu ada; tiap butir advisory (termasuk di
   `### ⚠️ Advisory baru muncul`) wajib menyebut **severity** dan menyertakan
   link advisory.
4. Baris gate merge yang menyebut `bun run audit:deps:ci` dan
   `bun run audit:router-versions`.

Jangan mengedit komentar secara manual — jalankan ulang generatornya, lalu cek
lokal dengan `bun run check:dep-changelog dep-changelog.md`.

## Catatan CI (14 Agu 2026)

Override `nanoid` dikunci di `3.3.18` (GHSA-2v37-7h3g-55p8). Step *Audit dependensi*
di workflow `ci-typecheck-build.yml` harus tetap hijau setelah perubahan ini.
