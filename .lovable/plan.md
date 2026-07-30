# Template & Format Pesan WA

Tujuan: owner bisa mengatur sendiri isi caption WA (judul, rincian, harga, status pembayaran, lokasi, catatan, penutup) dari halaman pengaturan, tanpa menyentuh kode.

## Ruang Lingkup
- Berlaku untuk caption yang dirakit di alur Ecer (`SendEcerPrepsDialog`), Request (`SendPrepToCustomerDialog`), dan `ReadyPackagesPanel`.
- Blok pembayaran & lokasi tetap dirakit lewat SSOT `buildPaymentMessageLines` — template hanya mengatur urutan, label, dan baris opsional lain.

## UX
Halaman baru: `/pengaturan-pesan-wa` (menu di sidebar "Pengaturan").
Layout `SettingsSection` dengan 2 kolom di desktop / stacked di mobile:

1. **Editor template** — textarea besar berisi template dengan token `{judul}`, `{items}`, `{total}`, `{pembayaran}`, `{lokasi}`, `{catatan}`, `{nama_pembeli}`, `{tanggal}`. Chip token yang dapat diklik untuk menyisipkan.
2. **Live preview** — memakai contoh data (kas / hutang / partial × lokasi ada / kosong) yang bisa diganti dropdown, memakai `buildCaption` yang sudah disatukan.

Tambahan opsi toggle:
- Emoji header (⭐/📦/none)
- Tampilkan detail per-kotak atau ringkas
- Label kustom: "Total", "Pembayaran", "Sisa hutang", "Lokasi ambil", "Untuk", "Catatan"
- Baris penutup (default "Terima kasih 🙏")

Tombol: **Simpan**, **Kembalikan default**, **Salin contoh**.

## Data
Migrasi `wa_message_templates`:
```
id uuid pk, user_id uuid unique refs auth.users, 
template text not null, 
options jsonb not null default '{}', 
updated_at timestamptz default now()
```
RLS: owner-only (`user_id = auth.uid()`). GRANT untuk `authenticated` + `service_role`. Fallback ke default bila belum ada baris.

## Teknis
- `src/lib/wa-template.ts` — SSOT: `DEFAULT_TEMPLATE`, `DEFAULT_OPTIONS`, `renderCaption({ template, options, data })`. Fungsi ini menggantikan `buildCaption` inline di ketiga call-site; blok `{pembayaran}` memanggil `buildPaymentMessageLines`, blok `{lokasi}` memakai `location_url` (placeholder tetap dari SSOT).
- `useWaTemplate()` hook — TanStack Query, cache-first, invalidate saat simpan.
- Refactor `SendEcerPrepsDialog`, `SendPrepToCustomerDialog`, `ReadyPackagesPanel` untuk memakai `renderCaption`; jaga signature `location_url` supaya banner "lokasi kosong" di `CaptionPreviewDialog` tetap jalan.
- Test:
  - unit `wa-template.test.ts` — render setiap token, opsi label kustom, urutan tetap, fallback default, escape tanda kurung kurawal literal.
  - snapshot untuk 3 skenario (kas+loc, hutang+no-loc, partial+loc) memakai template default agar identik dengan snapshot lama `payment-summary`.
  - integration: simpan template → render caption memakai template baru.

## Non-goals
- Tidak mengubah pipeline share/clipboard (`src/lib/share-wa.ts`).
- Tidak menyentuh perakitan pesan MCM Chat atau tool MCP `preview_pesan_kirim` di iterasi ini (bisa dipakai template yang sama di iterasi berikutnya).
