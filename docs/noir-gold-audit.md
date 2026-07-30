# Kontrak Audit Noir & Gold — Slice 1

Dokumen ini mengunci "polish sidebar baru" sebagai standar bahasa visual
aplikasi. CI menegakkan sub-set aturannya lewat
`scripts/check-noir-gold.mjs`; codemod bantu ada di
`scripts/codemod-noir-gold.mjs`.

Prinsip dua jalur (sesuai memori proyek):

- **Jalur A — publik/customer-facing**: full branding Noir & Gold. Palet
  gold di-scope via class `public-scope` pada layout publik, tidak menyentuh
  preset user.
- **Jalur B — operasional**: preset appearance user tetap; audit hanya
  menormalisasi tipografi, spacing, dan warna ke token semantic.

---

## 1. Tipografi

- Judul halaman/section: `font-display` + skala `text-ms-*` (`text-ms-2xl` /
  `text-ms-xl` untuk hero, `text-ms-lg` untuk kartu). Jangan `text-[Xpx]`.
- Body copy: `text-ms-sm` default, `text-ms-xs` untuk meta.
- Label uppercase section: `text-section-label` (utility Tailwind v4)
  + prefix `<span aria-hidden className="dot-accent" />`.
- Angka nominal: selalu `tabular-nums`.
- Font ad-hoc (`font-[...]`, `[font-family:...]`) di JSX dilarang.

## 2. Spacing

Semua padding/gap/margin memakai skala mobile-scale (`ms-*`):

- `p-ms-2` (0.5rem) — chip, badge kompak.
- `p-ms-3` (0.75rem) — kartu kecil, header sidebar.
- `p-ms-4` (1rem) — kartu utama, section container.
- `p-ms-5` (1.25rem) — hero card, container halaman mobile.
- `p-ms-6` (1.5rem) — container halaman desktop.
- `gap-ms-*` mengikuti skala yang sama.

Nilai literal (`p-3`, `gap-2.5`, `px-4`) diperbolehkan hanya di file yang
belum di-audit slice-nya; codemod akan menormalisasi per slice.

## 3. Warna

- Hardcode hex/rgba di JSX (`className` atau `style`) dilarang.
- `emerald-*` dan `amber-*` dilarang — pakai token semantic:
  - `success` (paid/online/selesai)
  - `warning` (pending/menyinkron)
  - `destructive` (offline/gagal)
  - `primary` (aktif/highlight — ikut preset user)
  - `info` (informasional)
- Titik status: pakai `status-dot-{primary|success|warning|danger|muted}`.

## 4. Surface

- Kartu utama: `surface-elevated`.
- Kartu hero/modal: `surface-elevated-lg`.
- Tidak boleh mencampur `border bg-card shadow-sm` ad-hoc; pakai utility di
  atas atau buat variant komponen resmi.

## 5. Interaksi

- Item navigasi/tab aktif: utility `nav-active` (gradient tipis +
  ring dalam 1px). Rail 3px kiri opsional (pakai `before:` seperti di
  `AppSidebar`).
- Hover non-aktif: `nav-hover` (translate 2px + tint accent).
- Lift kartu: `lift-on-hover` + `shadow-elevate`.
- Ring fokus premium: `ring-premium`.

## 6. CI Guard

`scripts/check-noir-gold.mjs` menolak PR yang memasukkan kembali:

- `emerald-<digit>` / `amber-<digit>` di file `src/`.
- Hex color literal di JSX className/style props (dengan pengecualian
  file harness visual + snapshot test).
- `text-[<digit>px]` di luar allowlist (`src/lib/noir-gold-allowlist.json`).

Codemod `scripts/codemod-noir-gold.mjs` mode:

- `--dry-run <glob>`: laporkan kandidat penggantian.
- `--apply <glob>`: normalisasi `text-[Xpx]` → `text-ms-*` sesuai peta,
  `p-N/gap-N` literal → `p-ms-N/gap-ms-N` sesuai peta konservatif.

Aturan lengkap peta dan allowlist ada di kepala masing-masing script.