## Ruang lingkup

"Premium++" diterjemahkan berdasarkan dua jawaban Anda:

- **Publik** (landing, auth, worker portal `/portal`, `/tugas/[token]`): full Noir & Gold + DM Serif Display / Fira Sans. Palet override diizinkan.
- **Operasional** (chat, ecer, gudang, tugas, pratinjau, dashboard, settings): warna TETAP ikut preset user di `/pengaturan-tampilan`. "Premium++" di sini artinya polish presentasi — tipografi heading, spacing, elevation/shadow, transisi mikro, refined states — TANPA menyentuh `:root` / `.dark` / `--primary` / `--mcm-brand`.

Aturan non-negotiable (mengikuti guardrail Anda):

1. Tidak menimpa token warna operasional. Semua polish operasional lewat utility opt-in (`text-premium-heading`, `shadow-elevate`, dll.), bukan override `:root`.
2. Setiap slice diverifikasi di 411px sebelum lanjut. Tidak ada auto-lanjut karena tsc/build hijau.
3. Tidak ada state implisit — motion & shadow diberi `prefers-reduced-motion` fallback dan mengikuti `ReduceMotionToggle` yang sudah ada.
4. Tidak menyentuh: `client.ts`, `.env`, `routeTree.gen.ts`, `supabase/config.toml`, `auth-*` generated, schema `auth/storage/realtime/vault`.

## Urutan slice (Anda tolak/lanjut per slice)

Sesuai jawaban high-traffic dulu:

```text
Slice 0  Fondasi tokens polish (utility premium, opsional font-display DM Serif untuk heading operasional, load font via <link>)
Slice 1  Chat        — hub kerja utama Anda
Slice 2  Ecer        — dashboard order & WA mirror
Slice 3  Gudang      — list produk & konversi
Slice 4  Tugas + Pratinjau
Slice 5  Publik full Noir & Gold (auth, /portal, /tugas/[token] worker)
Slice 6  Dashboard + Settings sisanya
```

Slice 5 sengaja tidak di depan karena landing sudah Noir & Gold (memori proyek). Kalau ternyata halaman auth/portal masih generik, Anda bisa minta saya angkat Slice 5 ke depan.

## Slice 0 — Fondasi (dikerjakan pertama)

Yang saya ubah:

- `src/routes/__root.tsx`: tambah `<link rel="preconnect">` + stylesheet `DM Serif Display` (400) + `Fira Sans` (400,500,600). Tidak sentuh `<head>` metadata lain.
- `src/styles.css`:
  - Tambah token `--font-display: "DM Serif Display", ui-serif, Georgia, serif;` dan `--font-body: "Fira Sans", ui-sans-serif, system-ui, ...;` di `@theme inline`.
  - Tambah token `--shadow-elevate`, `--shadow-elevate-lg`, `--gradient-gold` (khusus scope publik, prefixed `--public-*`).
  - Tambah `@utility text-premium-heading`, `@utility shadow-elevate`, `@utility surface-elevated` — semua opt-in, tidak mengubah default.
  - Tambah `@custom-variant` untuk gate reduce-motion.
- `src/lib/premium-typography.ts` (baru): helper class `cn`-friendly untuk heading operasional supaya konsisten.

Yang TIDAK berubah di Slice 0:

- Semua nilai `--background`, `--primary`, `--accent`, `--mcm-brand` di `:root` dan `.dark`.
- Semua preset di `/pengaturan-tampilan`.
- Semua komponen — mereka belum consume utility baru.

Verifikasi Slice 0:

- `tsgo --noEmit` bersih.
- Halaman apa pun harus render identik dengan sebelumnya (utility opt-in, belum dipakai).
- Anda buka `/pengaturan-tampilan`, ganti preset warna: harus tetap berfungsi.
- Screenshot 411px halaman index & satu operasional (chat) sebelum/sesudah: pixel-diff nol di area yang belum di-adopt.

## Slice 1..N — polish per rute

Template polish per rute (dijalankan setelah Slice 0 approved):

- PageHeader → font-display untuk judul, tracking-tight, ukuran naik satu step di 411px.
- Kartu utama → `surface-elevated` (border tipis + `shadow-elevate`), radius `--ms-radius-card` konsisten.
- CTA primer → keep bg-primary (preset user), tambah shadow inset + hover translate-y-[-1px] dengan reduce-motion fallback.
- Empty states → serif display + body Fira Sans, no illustration change.
- Divider & chip → refined dengan `color-mix` sedikit lebih pekat di `.dark`.

Setiap slice mengubah maksimum 3–5 file, ada test snapshot 411px di rute yang bersangkutan (kalau belum ada, saya buat baru — sesuai pola `viewport-snapshots` yang sudah ada di `src/routes/__snapshots__/`).

## Verifikasi wajib setiap slice

1. `tsgo --noEmit` + `vitest run` (test yang terkait).
2. Snapshot 411px + 390px + 320px (matriks Anda) — diff visual di-review.
3. Preset warna default dan satu preset non-default masih render benar (mencegah token bocor).
4. Reduce-motion aktif → tidak ada translate/scale.
5. Anda approve on-device sebelum saya lanjut ke slice berikutnya.

## Yang eksplisit BUKAN bagian dari rencana ini

- Perubahan business logic apa pun (Lunas, Sudah Dikirim, RLS, WA send flow).
- Perubahan schema DB atau RLS.
- Rilis Android/iOS build baru.
- Menyentuh preset warna user yang sudah ada.

Kalau plan ini OK, saya mulai Slice 0 (fondasi) dulu — kecil, reversible, tidak mengubah tampilan apa pun sampai slice berikut mengadopsi utility-nya.
