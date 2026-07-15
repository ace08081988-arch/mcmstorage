
# Audit Noir & Gold — Dua Jalur, Enam Slice

Berdasarkan aturan memori kamu ("two-track — full branding di publik/customer-facing, restrained utility-only polish di operasional supaya preset appearance user tetap utuh"), audit ini **tidak** akan blanket-repaint semua halaman jadi emas. Sidebar baru itu sendiri sebenarnya tetap pakai token `--primary` (ikut preset user) — yang berubah cuma tipografi (`font-display`), rhythm spacing (`px-ms-*`), dan pemetaan warna status ke token semantic (`primary` / `success` / `warning`). Itu contract yang akan direplika.

## Contract "polish sidebar" yang jadi acuan

Elemen ini yang akan ditegakkan konsisten:

1. **Heading** — judul halaman/section pakai `font-display` + `text-ms-*` (bukan ad-hoc `text-[Xpx]`).
2. **Uppercase label** — group/section label pakai `text-ms-2xs uppercase tracking-[0.18em] text-muted-foreground/70` + dot 3px `primary/65%`.
3. **Spacing** — semua padding/gap pakai skala `ms-*` (`gap-ms-2`, `px-ms-3`, `py-ms-2`). Tidak ada `p-3`, `gap-2.5` acak.
4. **Warna status** — `success` (paid/online/selesai), `warning` (pending/menyinkron), `destructive` (offline/gagal), `primary` (aktif/highlight). Tidak boleh hardcode hex atau kembali ke `emerald-*` / `amber-*`.
5. **Surface** — kartu utama pakai `surface-elevated` / `surface-elevated-lg` (utility yang sudah ada), bukan campuran ad-hoc `border bg-card shadow-sm`.
6. **Interactive** — hover/active state pakai gradient tipis `from-primary/20 via-primary/8` + rail 3px kiri, seperti `SidebarMenuButton[data-active=true]`.
7. **Preset user tidak dilanggar** — semua warna aksen tetap lewat token `--primary`, jadi kalau user pilih preset hijau/biru, seluruh app ikut, bukan dipaksa emas.

## Jalur A — Publik / customer-facing (branding penuh Noir & Gold)

Halaman yang dilihat tamu, calon user, atau customer via link — di sini preset user tidak berlaku; branding brand-level. Sudah teridentifikasi:

- `src/routes/auth.tsx`, `src/routes/auth-callback.tsx` (login/OAuth)
- `src/routes/download.tsx`, `src/routes/download.$variant.tsx` (landing APK)
- `src/routes/t.$token.tsx` (share link ke customer)
- `src/routes/diagnostik.paket.tsx` (share link paket ke customer)
- `src/routes/_authenticated.undang.tsx` (invite QR)
- `src/components/PublicHeader.tsx`, `src/components/PublicFooter.tsx`
- `src/routes/__root.tsx` (shell + `<head>`)

Perlakuan: `--primary` dipin ke gold (`oklch(...)` dari preset "Noir & Gold" resmi), tipografi display serif untuk judul, latar deep-navy/charcoal, aksen emas terbatas — mengikuti palette memori kamu.

## Jalur B — Operasional (utility polish, preset user tetap)

Semua di bawah `_authenticated.*` selain yang di Jalur A. Perlakuan:
- Ganti sisa hex/ad-hoc utility ke token semantic (`primary`, `muted-foreground`, `success`, `warning`, `destructive`).
- Normalisasi tipografi + spacing sesuai contract di atas.
- **Preset warna user tidak diganti** — `--primary` tetap dari appearance preset yang dia pilih.

## Slice eksekusi (setiap slice minta approval on-device 411/390px sebelum lanjut)

```text
Slice 1  Foundation & lint guard
         ├── Perluas utility premium (heading, section-label, surface,
         │   status-dot) di src/styles.css supaya jadi single source.
         ├── ESLint rule tolak: emerald-/amber-/hex color literal di JSX,
         │   text-[Xpx] di luar allowlist, font ad-hoc.
         └── Codemod scripts/codemod-noir-gold.mjs (dry-run + apply mode).

Slice 2  Shell global (dampak paling luas, paling aman)
         ├── src/components/AppHeader.tsx, PageHeader, PageContainer,
         │   MobileBottomNav, SummaryCard, PillsTabs.
         └── Verifikasi visual di /dashboard, /gudang, /ecer, /chat.

Slice 3  Jalur A — publik/customer surfaces
         ├── auth, auth-callback, download*, t.$token, diagnostik.paket,
         │   undang, PublicHeader/Footer, __root head + og.
         └── Pin --primary = gold pada scope publik (via body class
             `public-scope` di layout publik) — tidak menyentuh preset
             user di operasional.

Slice 4  Jalur B — operasional inti (halaman terberat dulu)
         ├── dashboard, index (Beranda), gudang*, ecer*, request*,
         │   tugas*, pos-kasir*, hutang-piutang.
         └── Fokus: tipografi + spacing + surface tokens. Warna hanya
             normalisasi ke token; preset user tetap.

Slice 5  Jalur B — operasional sekunder
         ├── chat family (sudah paling matang, sentuh minimal),
         │   catatan, balas-cepat, buku-alamat, notifikasi, kontak*,
         │   profil, pengaturan* (kecuali admin-only).
         └── Sentuh chat dengan hati-hati — banyak snapshot test.

Slice 6  Admin & diagnostic (paling tidak berisiko rusak)
         └── audit, diagnostics, email-queue, admin*, sesi,
             device-verify, pengaturan-scroll-guard, pengaturan-kunci,
             lovable.visual.* (harness).
```

## Detail teknis

- **Contract file** — `docs/noir-gold-audit.md` akan didokumentasi sebagai aturan yang lint jaga (mirror `docs/responsive-layout-rules.md`).
- **Codemod** heuristik aman: replace `text-[<px>]` di allowlist token, replace `p-3/gap-2.5/px-4` menjadi `p-ms-*` **hanya** kalau ada di file yang kita audit slice itu; tidak pernah global blast.
- **CI guard** tambahan (mirip `check-no-turnstile.mjs`): `check-noir-gold.mjs` menolak PR yang re-introduce `emerald-`/`amber-`/hex color literal/`text-[Xpx]` di luar allowlist.
- **Preset user** dijaga: audit tidak mengubah `--primary` di `src/styles.css :root` / `.dark`. Gold hanya di-scope ke elemen ber-class `public-scope` (ditempel di layout publik) supaya operasional tetap ikut preset user.
- **Snapshot tests** — chat family punya snapshot; slice 5 akan meregenerate satu kali di akhir slice, bukan per-file.

## Yang perlu kamu putuskan sebelum mulai

1. **Sanggup dua jalur?** Kalau kamu mau full-gold di operasional juga (mengunci preset user ke Noir & Gold), bilang saja — saya skip pin `public-scope` dan langsung pin `--primary` di `:root`.
2. **Urutan slice** — mau saya mulai dari Slice 1 (foundation + lint guard), atau langsung Slice 3 (publik) karena visual impact-nya paling terasa dan tidak mengganggu operasional?
3. **Gate approval** — konfirmasi rutin per-slice via device 411/390px kamu, seperti PhotoEditorV2. Setuju?

Balas dengan pilihan (1) + (2) + (3), saya mulai slice pertama.
