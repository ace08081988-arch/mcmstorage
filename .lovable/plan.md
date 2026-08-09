# Audit Menyeluruh Ace Storage (MCM Storage) — mode audit, tanpa perubahan kode

## Ringkasan kondisi aktual

Aplikasi bukan prototipe. Typecheck bersih, ribuan unit test lulus, dan infrastruktur mobile sudah matang: tinggi layar nyata (`--app-vh`), safe-area per perangkat, token z-index tunggal, audit overflow otomatis, serta uji E2E jarak aman FAB dan split-screen. Tidak ditemukan data dummy, teks "lorem ipsum", atau label "coming soon" di kode.

Basis data sehat: tidak ada lagi fungsi bernama ganda (overload) — temuan Critical audit sebelumnya sudah tertutup. Seluruh tabel `public` punya RLS aktif dan berkebijakan, **kecuali `doc_sequences`** (RLS aktif, nol kebijakan).

Yang sudah selesai sejak audit sebelumnya: overload fungsi database dihapus, notifikasi gagal salin caption WhatsApp, panel "kiriman belum tercocokkan" di Ecer, jeda (debounce) realtime Ecer + cache URL foto, koordinasi penyegaran portal pegawai, target sentuh navigasi utama dan kartu Ecer, serta audit responsif yang kini mencakup rute inti bila sesi login tersedia.

Sisa masalah bersifat **titik buta dan utang struktur**, bukan kerusakan alur.

## Temuan

### Critical

Tidak ada temuan Critical yang tersisa pada sesi ini.

### High

1. **Berkas raksasa menampung banyak alur sekaligus.** `t.$token.tsx` 5.374 baris, `_authenticated.ecer.tsx` 5.084, `_authenticated.request.tsx` 4.465, `ReadyEcerSection.tsx` 2.791, `_authenticated.index.tsx` 2.375.
   Dampak: satu perubahan kecil berisiko merusak alur lain; logika pencocokan dan pembayaran nyaris tidak bisa diuji unit.
   Akar masalah: fitur ditambahkan di tempat yang sama secara bertahap.
   Solusi: ekstrak logika murni (pencocokan Ecer, ringkasan pembayaran, status paket) ke modul terpisah beserta uji unitnya — tanpa mengubah tampilan.

2. **Audit responsif rute inti belum pernah benar-benar dijalankan.** Skrip sudah mendukung sesi, tetapi hasil pengukuran Gudang/Request/Ecer/Hutang-Piutang/Chat pada 320-768 px belum ada.
   Dampak: klaim "responsif" pada halaman tersibuk masih belum terbukti.
   Solusi: jalankan audit bersesi, lalu perbaiki pelanggaran yang muncul satu per satu.

3. **Kesalahan ditelan diam-diam di jalur penting.** Pola `catch { /* ignore */ }` masih terpakai di `t.$token.tsx` (8), `webrtc.ts` (7), `_authenticated.ecer.tsx` (3), dan lainnya.
   Dampak: kegagalan nyata (mode privat, kuota penuh, izin ditolak) tidak sampai ke pengguna maupun catatan log — sulit didiagnosis dari laporan pengguna.
   Solusi: bedakan "boleh diabaikan" dan "harus dilaporkan"; jalur unggah, izin, dan penyimpanan sesi masuk kategori kedua.

### Medium

4. **Belum ada komponen bersama untuk kondisi kosong / gagal / offline.** Hanya ada `RouteLoadError.tsx`. Tiap halaman besar menulis bloknya sendiri sehingga bahasa, ikon, dan jarak berbeda-beda — inilah penyebab utama kesan "kurang jadi".
5. **Penanganan offline tidak seragam.** `navigator.onLine` dipakai ad-hoc di Chat, Ecer, dan Request; tidak ada indikator offline global maupun antrean aksi terpadu.
6. **`min-h-screen` masih dipakai di 18+ tempat** (Gudang, Kios, Hutang-Piutang, Kontak, portal pegawai) sementara sisa aplikasi memakai `--app-vh`. Berpotensi ruang kosong atau potongan di Android WebView.
7. **`doc_sequences`: RLS aktif tanpa kebijakan.** Akses hanya lewat fungsi. Perlu diputuskan dan didokumentasikan secara eksplisit, bukan dibiarkan ambigu.
8. **Sesi pegawai tersimpan di tiga tempat** (`sessionStorage`, `BroadcastChannel`, `localStorage`) — tab lama bisa tetap merasa masuk setelah tab lain keluar.
9. **Sekitar 56 fungsi database dapat dipanggil tanpa login.** Yang diperiksa aman karena memvalidasi pengguna di dalam fungsi, tetapi belum semuanya diperiksa satu per satu.

### Low

10. Tiga komponen "Siap Dikirim" paralel dengan ukuran sangat timpang, logika mirip tapi ditulis terpisah.
11. 28 berkas memakai timer berkala; sebagian bisa digabung ke satu penjadwal.
12. Sisa gaya lama `text-xs` masih berdampingan dengan skala tipografi `text-ms-*` di beberapa berkas.

## Quick wins vs perubahan arsitektur

- Quick wins: 2 (jalankan audit), 6, 7, 12.
- Perubahan arsitektur: 1, 3, 4, 5, 8, 10, 11.

## Rencana eksekusi bertahap yang aman

**Tahap 1 — Bukti sebelum tebakan.** Jalankan audit responsif bersesi untuk rute inti; kumpulkan daftar pelanggaran nyata; putuskan dan dokumentasikan status `doc_sequences`; telusuri daftar fungsi yang bisa dipanggil tanpa login.

**Tahap 2 — Perbaiki hasil ukur.** Tutup pelanggaran overflow/overlap yang ditemukan Tahap 1; migrasikan `min-h-screen` ke `--app-vh` per halaman, satu halaman per langkah dengan verifikasi visual.

**Tahap 3 — Konsistensi rasa "produk jadi".** Bangun komponen bersama kondisi kosong/gagal/offline plus indikator offline global, lalu adopsi bertahap dimulai dari Gudang, Request, dan Ecer.

**Tahap 4 — Kurangi risiko struktur.** Ekstrak logika murni dari berkas raksasa ke modul teruji; satukan sumber kebenaran sesi pegawai.

**Tahap 5 — Higienis jangka panjang.** Hilangkan pola menelan kesalahan di jalur penting, gabungkan timer, satukan tiga komponen "Siap Dikirim".

Setiap tahap berdiri sendiri, bisa dihentikan kapan saja, dan tidak mengubah alur bisnis.

## Yang tidak bisa diverifikasi otomatis

Kamera dan galeri asli, kunci aplikasi saat kembali dari kamera, akurasi GPS, pengiriman ke WhatsApp lintas versi Android, notifikasi latar saat aplikasi tertutup, pemasangan PWA, perilaku offline nyata, dan tampilan bilah sistem pada perangkat berponi.

Skenario uji perangkat nyata yang disarankan:
- HP Android 360 px dan 411 px, plus tablet portrait dan landscape.
- Alur penuh pegawai pada sinyal lemah: buka link, PIN, foto, editor, lokasi, unggah, Siap Dikirim.
- Alur admin: paket siap kirim, pembayaran Cash/DP/Hutang, kirim WA, Terkirim ke Riwayat.
- Mode layar terbagi dan keyboard terbuka di /pos-kasir.
- Putus koneksi di tengah unggah, lalu sambung kembali.
- Notifikasi ditekan saat aplikasi tertutup (cold start) dan deep link.

## Catatan teknis

Semua klaim berasal dari pembacaan berkas dan kueri katalog basis data pada sesi ini. Yang belum ditelusuri baris demi baris: keseluruhan `t.$token.tsx`, `_authenticated.ecer.tsx`, dan `_authenticated.request.tsx`, serta seluruh 56 fungsi yang dapat dipanggil tanpa login.
