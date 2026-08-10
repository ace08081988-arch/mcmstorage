# Batch A P0 — status di HEAD dan lanjutan antrean

## Ringkasan

Batch A (konfirmasi kirim yang jujur) sudah ada di HEAD dan terverifikasi. Tidak ada pekerjaan Batch A yang perlu diulang. Rencana ini hanya melanjutkan antrean berikutnya, tetap source/tests saja: tanpa migrasi, tanpa perubahan data produksi, tanpa publish, tanpa APK, tanpa secret.

## Yang sudah selesai (dibaca dari HEAD)

- `src/lib/post-share-confirm.ts` ada: helper konfirmasi eksplisit pasca-share, penjaga status share, dan kunci re-entry.
- `src/routes/_authenticated.ecer.tsx` dan `src/routes/_authenticated.request.tsx` sama-sama memanggil konfirmasi eksplisit sebelum RPC finansial, dan keduanya memakai penjaga status share.
- `src/components/ReadyEcerSection.tsx` tidak lagi memanggil share, RPC kirim, atau penandaan terkirim; hanya menavigasi ke alur kanonik.
- `src/lib/prep-status.ts` sudah ada sebagai kandidat sumber status tunggal.

## Yang akan dikerjakan berikutnya (Batch 1 — satu sumber status)

Tujuan: badge dan tombol di Request, ECER, dashboard, dan riwayat membaca status dari satu tempat, sehingga tidak ada lagi komponen yang menebak status dari kolom mentah.

1. Petakan semua tempat yang menyimpulkan status sendiri (kombinasi kolom verifikasi, waktu terjual, dan riwayat lokal), lalu arahkan ke `src/lib/prep-status.ts`.
2. Lengkapi `prep-status.ts` bila ada kondisi yang belum tercakup (menunggu verifikasi, siap dikirim, terkirim, dibatalkan/unsend).
3. Samakan label dan warna badge antara kartu dashboard, halaman Request, dan halaman ECER lewat satu peta label.
4. Tombol aksi (kirim, hapus, kembalikan) ditentukan dari status kanonik, bukan dari pengecekan kolom ad hoc di tiap komponen.

## Detail teknis

- File yang kemungkinan disentuh: `src/lib/prep-status.ts`, `src/components/ReadyEcerSection.tsx`, `src/components/ReadyRequestSection.tsx`, `src/routes/_authenticated.request.tsx`, `src/routes/_authenticated.ecer.tsx`, dan komponen badge terkait.
- Tanpa perubahan skema atau RPC. Hanya lapisan presentasi dan turunan status di klien.

## Tes

- Tes unit peta status: tiap kombinasi kolom menghasilkan satu status kanonik dan satu label.
- Tes audit source: tidak ada komponen dalam daftar yang menyimpulkan status sendiri di luar helper.
- Tes regresi alur kirim yang sudah ada tetap hijau.

## Kriteria diterima

Satu prep menampilkan status dan label identik di dashboard, halaman Request/ECER, dan riwayat. Tombol aksi konsisten dengan status. Typecheck, seluruh tes, dan build produksi hijau.

## Risiko regresi

Label yang selama ini berbeda antar halaman akan berubah agar seragam; ini disengaja. Perubahan tombol aksi bisa menyembunyikan aksi yang dulu muncul pada status yang salah.
