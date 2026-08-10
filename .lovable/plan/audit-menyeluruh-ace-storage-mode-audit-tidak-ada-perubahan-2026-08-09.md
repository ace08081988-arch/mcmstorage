# Audit Menyeluruh Ace Storage (mode audit — tidak ada perubahan kode)

## Ringkasan kondisi aktual

Aplikasi jauh dari "prototipe": typecheck bersih dan 2.397 unit test lulus, dengan infrastruktur khusus mobile yang sudah matang (`--app-vh`, safe-area per perangkat, token z-index, audit overflow, e2e clearance FAB/split-screen). Masalah yang tersisa bukan "aplikasi rusak", melainkan **titik buta**: area yang tidak tercakup pengujian otomatis, beberapa berkas raksasa yang menampung banyak logika sekaligus, dan pola kesalahan yang ditelan diam-diam.

Basis data sehat secara struktural: tabel `public` punya RLS aktif dan berkebijakan, kecuali `doc_sequences` (RLS aktif tanpa kebijakan). Fungsi RPC sensitif yang diperiksa (`create_chat_cart`, `fix_request_prep_payment`) sudah memvalidasi `auth.uid()`.

## Temuan

### Critical

1. **Fungsi database punya versi ganda (overload) — pemicu error "could not choose the best candidate function"**
   Bukti (kueri katalog database sesi ini): `prep_submit` 3 versi, `request_submit_via_task` 2 versi, `send_request_prep_to_customer` 2 versi. Pola persis sama dengan error yang dulu terjadi pada `prep_create_task`.
   Dampak: pegawai bisa gagal mengirim penyiapan dengan pesan teknis, tergantung parameter yang dikirim aplikasi.
   Akar masalah: migrasi menambah parameter baru tanpa menghapus versi lama.
   Perbaikan: hapus versi lama setelah memastikan tidak ada pemanggil tersisa.

2. **Tidak ada audit responsif otomatis untuk halaman inti yang butuh login**
   Bukti: `scripts/responsive_overflow_audit.py` hanya menguji rute publik dan harness visual; Gudang, Request, Ecer, Hutang-Piutang, dan Chat tidak pernah diukur pada 360/390/411 px.
   Dampak: regresi tata letak di halaman yang paling sering dipakai baru ketahuan dari laporan pengguna.
   Perbaikan: pakai infrastruktur auth E2E yang sudah ada untuk menyediakan sesi, lalu masukkan rute-rute itu ke daftar target audit.

### High

3. **Portal pegawai (`src/routes/t.$token.tsx`, 5.333 baris) menjalankan tiga mekanisme penyegaran sekaligus**
   Bukti: baris 1500-1529 — realtime broadcast, heartbeat 15 detik, dan `visibilitychange` semuanya memanggil `silentRefresh()`, ditambah timer 5 detik untuk label waktu.
   Dampak: boros data dan baterai di HP pegawai, potensi permintaan tumpang-tindih saat sinyal lemah.
   Perbaikan: satukan lewat satu penjadwal berjeda; pisahkan timer tampilan dari pengambilan data.

4. **Foto pegawai bisa "hilang" tanpa peringatan saat pencocokan gagal** (`src/components/ReadyEcerSection.tsx:311-348`)
   Bukti: setelah tiga tingkat pencocokan, submission yang tidak cocok dilewati (`continue`) tanpa badge maupun notifikasi.
   Dampak: admin mengira pegawai belum mengirim padahal fotonya sudah masuk.
   Perbaikan: tampilkan daftar "belum tercocokkan" dan izinkan penetapan manual.

5. **Caption WhatsApp bisa hilang total tanpa pemberitahuan** (`src/lib/share-wa.ts:213-236`)
   Bukti: kegagalan salin papan klip ditelan `catch { /* ignore */ }`.
   Dampak: pelanggan menerima foto tanpa keterangan pembayaran/lokasi — persis keluhan yang pernah dilaporkan.
   Perbaikan: notifikasi eksplisit + tombol "Salin ulang caption" saat gagal.

6. **Muat ulang berulang pada Ecer** (`ReadyEcerSection.tsx:187-457`)
   Bukti: dua saluran realtime memicu pemuatan penuh 5 tabel tanpa jeda; URL foto diminta satu per satu (N+1) setiap kali muat.
   Dampak: layar terasa berat saat pegawai mengunggah beberapa foto beruntun.
   Perbaikan: beri jeda pada pemicu realtime dan simpan sementara URL foto.

### Medium

7. **Target sentuh di bawah 44 px pada halaman inti** — `_authenticated.index.tsx` (rail navigasi `h-9 w-9`, toggle `h-8 w-8`) dan `_authenticated.ecer.tsx:2676-2686` (`h-8 w-8`, malah mengecil ke `h-7 w-7` saat ruang sempit). Rawan salah tekan di 360 px.
8. **Dua elemen masih memakai `h-screen` statis** — `_authenticated.index.tsx:1540` (sidebar mobile) dan `_authenticated.gudang.tsx:764` (sidebar desktop) belum ikut `h-app-vh`, berbeda dari sisa aplikasi.
9. **Tidak ada komponen bersama untuk kondisi kosong/gagal/offline** — tiap halaman besar menulis bloknya sendiri, sehingga bahasa dan tata letaknya berbeda-beda.
10. **Sesi pegawai disimpan di tiga tempat** (`sessionStorage`, `BroadcastChannel`, `localStorage`) — tab lama bisa tetap merasa masuk setelah tab lain keluar.
11. **Kesalahan ditelan diam-diam** di banyak titik penyimpanan lokal dan pemuatan data — kegagalan nyata (mode privat, kuota penuh) tidak pernah sampai ke pengguna maupun catatan log.
12. **Tabel `doc_sequences` punya RLS aktif tanpa kebijakan** — aksesnya hanya lewat fungsi; perlu dipastikan memang disengaja lalu didokumentasikan.

### Low

13. Sisa gaya lama `text-xs` di tiga baris `_authenticated.gudang.tsx` (126, 387, 858) di antara 134 pemakaian skala tipografi baru.
14. Tiga komponen "Siap Dikirim" paralel dengan ukuran sangat timpang (698 / 2.732 / 122 baris) — logika mirip tapi ditulis terpisah.
15. 37 timer berkala tersebar di seluruh aplikasi; sebagian bisa digabung.
16. Sekitar 56 fungsi database dapat dipanggil tanpa login. Yang diperiksa aman karena memvalidasi pengguna di dalamnya, tetapi belum semuanya diperiksa satu per satu.

## Quick wins vs perubahan arsitektur

- Quick wins (risiko rendah, hasil langsung terasa): 1, 5, 7, 8, 12, 13.
- Perubahan arsitektur (perlu perencanaan dan pengujian): 2, 3, 4, 6, 9, 10, 14.

## Rencana eksekusi bertahap

**Tahap 1 — Data & keamanan.** Hapus versi ganda fungsi database setelah verifikasi pemanggil; putuskan dan dokumentasikan status `doc_sequences`; audit daftar fungsi yang bisa dipanggil tanpa login.

**Tahap 2 — Alur inti tidak boleh kehilangan data.** Perbaiki notifikasi gagal salin caption WA; tampilkan panel "foto belum tercocokkan"; satukan penyegaran portal pegawai; beri jeda pada realtime Ecer.

**Tahap 3 — Responsivitas terukur.** Masukkan halaman inti ke audit otomatis dengan sesi login, lalu perbaiki temuannya; naikkan target sentuh; selesaikan dua sisa `h-screen`.

**Tahap 4 — Polish & konsistensi.** Komponen bersama untuk kondisi kosong/gagal/offline; rapikan sisa gaya lama; pecah komponen raksasa menjadi bagian yang bisa diuji.

**Tahap 5 — Higienis jangka panjang.** Gabungkan timer, kurangi pola menelan kesalahan, tambahkan uji unit untuk logika pencocokan Ecer.

## Yang tidak bisa diverifikasi otomatis

Perilaku kamera dan galeri asli, kunci aplikasi saat kembali dari kamera, akurasi GPS, pengiriman ke WhatsApp pada berbagai versi Android, notifikasi latar belakang saat aplikasi tertutup, pemasangan PWA, perilaku offline nyata, dan tampilan bilah sistem pada perangkat berponi.

Skenario uji perangkat nyata yang disarankan: HP Android 360 px dan 411 px; alur penuh pegawai (buka link, PIN, foto, edit, lokasi, kirim) pada sinyal lemah; alur admin (Siap Dikirim, bayar hutang, kirim WA); mode layar terbagi; putus koneksi di tengah unggah.

## Catatan teknis

- Semua klaim berasal dari pembacaan berkas dan kueri katalog database pada sesi ini; klaim tanpa bukti tidak dimasukkan.
- Belum ditelusuri baris demi baris: keseluruhan `t.$token.tsx` dan `ReadyEcerSection.tsx`, serta blok kondisi kosong di `_authenticated.request.tsx` dan layar percakapan.
- Verifikasi sesi ini: `tsgo --noEmit` bersih; 179 berkas uji lulus (2.397 uji).