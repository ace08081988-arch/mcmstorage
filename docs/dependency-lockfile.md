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

```bash
rm -f bun.lockb
bun install            # menulis ulang bun.lock (teks)
bun run check:lockfile
```

Jangan menghapus `bun.lock` hanya karena install gagal 401/403 — itu biasanya
token registry yang kedaluwarsa, bukan lockfile-nya. Hapus lockfile hanya saat
registry/scope di `bunfig.toml` benar-benar berubah.
