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

Workflow **Lockfile Format** (`.github/workflows/lockfile-format.yml`) menjalankan
`bun run check:lockfile` pada setiap PR ke `main` (dan push ke `main`) sebagai
status check tersendiri bernama **check:lockfile (format lockfile teks)**.
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
