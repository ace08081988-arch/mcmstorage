## Konteks masalah (dari video + jawaban Anda)

1. **Logika penjualan belum berubah di detail** — di halaman `/ecer` dan `/request` tombol WA & Chat per-kotak masih share foto pegawai langsung ke pembeli tanpa lewat dialog Lunas/Hutang/Sebagian. Akibat: paket tetap "aktif", stok/piutang tidak dicatat. Rencana Juli 6 hanya mencabut tombol dari kartu dashboard — halaman detail terlewat. Ini akar keluhan #1.

2. **Layar tidak konsisten** — dashboard sudah pakai flow "Kirim ke pembeli" (wajib bayar), tapi detail masih flow lama (WA/Chat langsung). Dua alur berbeda untuk aksi yang sama → yang Anda maksud "tampilan gak konsisten sama sekali".

3. **Terima permintaan teman "diarahkan ke gak jelas"** — perlu reproduksi untuk memastikan; halaman `/kontak/permintaan` sendiri tidak melakukan navigasi setelah Terima, jadi kemungkinan besar entry-point-nya (notifikasi/banner chat/deep-link `/i/<code>`) yang meloncat aneh. Ditangani terpisah di plan berikutnya setelah Anda konfirmasi bagaimana Anda membuka layar Terima itu (dari mana → tap apa → mendarat di mana).

## Perubahan untuk plan ini (fokus #1 & #2)

Konsolidasi satu jalur "Kirim ke pembeli" — di detail juga WAJIB lewat dialog bayar dulu, baru buka WA/Chat.

### A. Angkat kanal (WA / Chat) menjadi parameter dialog

Perluas `SendEcerPrepsDialog` dan `SendPrepToCustomerDialog` (yang sekarang ada di `_authenticated.ecer.tsx` / `_authenticated.request.tsx`):

- Tambah prop `channel: "wa" | "chat"` (default `"wa"` untuk backward-compat).
- Setelah RPC sukses (paket tercatat sebagai terkirim + piutang/pembayaran tercatat), lakukan share sesuai `channel`:
  - `"wa"` → `shareToWA(...)` (perilaku existing).
  - `"chat"` → buka picker percakapan singkat (Sheet), lalu `shareToChat(...)`.
- Label CTA di footer dialog ikut kanal: "Kirim WA" / "Kirim Chat". Warna hijau tetap.
- Toast, `markSent`, dan refresh badge tetap dipanggil sama seperti sekarang.

### B. Pindahkan dialog jadi komponen bersama

Sesuai plan lama yang belum dieksekusi:

- `src/components/SendEcerPrepsDialog.tsx` (baru) — extract dari `_authenticated.ecer.tsx` beserta helper `resolvePhotoUrl`.
- `src/components/SendPrepToCustomerDialog.tsx` (baru) — extract dari `_authenticated.request.tsx`.
- Route lama impor dari lokasi baru; tidak ada perubahan perilaku pada halaman detail selain tombolnya (poin C).

### C. Kunci semua tombol WA & Chat per-kotak agar wajib lewat dialog

Di `_authenticated.ecer.tsx` dan `_authenticated.request.tsx`, tempat tombol WA / Chat per-kotak (yang sekarang share langsung):

- Klik WA per-kotak → **buka `SendEcerPrepsDialog` / `SendPrepToCustomerDialog`** dengan `preps = [kotak itu]` + `channel="wa"`. Dialog akan minta metode bayar, panggil RPC, baru buka WA.
- Klik Chat per-kotak → sama, `channel="chat"`.
- Tombol bulk WA / bulk Chat (kalau ada) juga dirouting ke dialog dengan preps terpilih.
- Kartu yang preps `sold_at !== null` (sudah di riwayat) tetap punya tombol share "kirim ulang" — di kanal ini tidak minta bayar lagi (langsung share) karena penjualan sudah tercatat. Bedakan lewat prop `alreadySold`.

### D. Dashboard `ReadyEcerSection` / `ReadyRequestSection`

Tombol "Kirim ke pembeli" (hijau) di kartu dashboard sekarang menawarkan pilihan kanal:

- Tap → dropdown kecil dua opsi: **WA** dan **Chat**. Pilih → dialog bayar dengan `channel` sesuai pilihan.
- Ini menyamakan dashboard dengan detail: keduanya lewat dialog yang sama, konsisten.

### E. Halaman detail: teks bantuan singkat

Di header daftar kotak siap kirim, tambah baris kecil: "Kirim ke pembeli otomatis mencatat penjualan/piutang lalu membuka WA/Chat." Menghilangkan kesan tombol WA lama "cuma buka WA".

## File yang disentuh

- `src/components/SendEcerPrepsDialog.tsx` (baru; extract + prop `channel`, `alreadySold`)
- `src/components/SendPrepToCustomerDialog.tsx` (baru; identik pola)
- `src/routes/_authenticated.ecer.tsx` (hapus definisi dialog lokal; rerute klik WA/Chat per-kotak lewat dialog; untuk preps `sold_at !== null` lewat dialog dengan `alreadySold` = true / atau langsung share)
- `src/routes/_authenticated.request.tsx` (idem)
- `src/components/ReadyEcerSection.tsx` (tombol "Kirim ke pembeli" → pilih kanal WA/Chat, pakai dialog)
- `src/components/ReadyRequestSection.tsx` (idem)

Tidak menyentuh: RPC penjualan/piutang, tabel database, alur `markSent`, realtime badge.

## Verifikasi

1. `/ecer` → tap ikon WA di satu kotak aktif → dialog bayar muncul (Lunas/Hutang/Sebagian) → pilih Lunas → tap "Kirim WA" → toast sukses → WA terbuka dengan foto → paket pindah ke "Riwayat Terkirim" → refresh dashboard: `prep_count` turun.
2. Ulangi dengan Chat → picker percakapan → foto terkirim di chat in-app → paket ke Riwayat.
3. `/request` → sama seperti #1 dan #2.
4. Dashboard → "Kirim ke pembeli" → pilih WA → dialog → sukses.
5. Kotak yang sudah di Riwayat → tombol share "kirim ulang" tidak minta bayar (langsung share), tidak double-catat penjualan.
6. `bun run typecheck` hijau; guardrail test yang relevan (`ecer-send-wa-*`) tetap lulus.

## Setelah plan ini disetujui & dieksekusi

Saya tangani keluhan #3 (Terima permintaan teman "diarahkan ke gak jelas") sebagai plan terpisah — perlu Anda beritahu: **dari mana Anda menekan "Terima"** (notifikasi push? banner di halaman /chat? dari `/i/<kode>`? dari `/kontak/permintaan`?) dan **halaman apa yang muncul setelahnya**. Tanpa reproduksi itu saya berisiko menebak lagi.
