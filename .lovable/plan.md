## Konteks

Saat ini `ReadyRequestSection` (di Beranda, section "PAKET REQUEST SIAP KIRIM") cuma menampilkan baris judul + badge `N paket` yang nge-link ke `/request`. Tidak ada:
- Kartu detail per judul (produk, kotak siap, kiriman pegawai, badge "Belum dikirim / Cocok / dst").
- Tombol WA / Chat langsung.
- Alur verifikasi penjualan → catat hutang otomatis sebelum kirim.

Yang diminta: samakan **tampilan kartu** dan **alur kirim** dengan `ReadyEcerSection` (Ecer / Siapkan Sendiri) — tap WA/Chat wajib lewat dialog verifikasi pembayaran dulu, baru share.

## Yang akan dibangun

### 1. Card UI paritas dengan Ecer
Ganti list Request di Beranda dengan komponen kartu identik gaya `ReadyEcerSection`:
- Judul + ikon domain (Request).
- Chip status: "Belum ada data", "Belum dikirim", "Cocok: produk + Xg" (mirror aturan yang sama).
- Baris "X kotak siap".
- Section "Kiriman pegawai" (foto/verifikasi pegawai kalau ada) + tombol Segarkan.
- Menu titik-tiga (⋮) sama kayak ecer.
- Layout toggle (list/compact/grid/detail) tetap dipakai.

### 2. Alur kirim sama persis dengan Ecer / Siapkan Sendiri
Tombol WA & Chat pada kartu Request **tidak** langsung buka WA/chat. Sebagai gantinya:
1. Buka dialog verifikasi (mirror `SendEcerPrepsDialog`): step 1 verifikasi pembayaran (Tunai / Transfer / Hutang) → step 2 pencatatan penjualan + hutang otomatis (RPC eksplisit, `sold_at` di-set benar) → step 3 konfirmasi + share (WA/Chat).
2. Bulk WA/Chat: sama dengan Ecer — hanya boleh 1 judul sekaligus, kalau >1 tampilkan toast "Kirim ke pembeli hanya bisa satu judul sekaligus agar pencatatan penjualan tetap eksplisit."
3. Kalau tidak ada `request_preparations` (belum diverifikasi dari kiriman pegawai) → tombol WA/Chat disabled + tooltip arahkan ke `/request` untuk verifikasi dulu (paritas gate ecer).

### 3. Ekstraksi dialog
Kalau `SendPrepLinkDialog` di `/request` sudah punya alur verifikasi setara `SendEcerPrepsDialog`, ekstrak jadi komponen `src/components/request/SendRequestPrepsDialog.tsx` dan pakai ulang dari Beranda + `/request`. Kalau belum, tulis dialognya berdasarkan `SendEcerPrepsDialog` (satu source of truth per domain, tidak nulis dua kali).

### 4. Guard state eksplisit
Tidak boleh auto-mark "Sudah Dikirim" / "Lunas" tanpa sinyal user. Semua transisi status lewat RPC yang sama dengan Ecer (aturan explicit-state).

## Yang TIDAK diubah

- Halaman `/request` (editor judul, editor prep, delivery history) tetap.
- Skema DB (`request_preparations`, `request_titles`, `request_title_items`) tetap.
- RLS / RPC.
- Section lain di Beranda (Ecer, Siapkan Sendiri) tidak disentuh.

## Cara eksekusi

Karena `ReadyEcerSection` 2.748 baris (banyak logic yang paritasnya harus dijaga), kerja dipecah jadi 3 PR-slice berurutan biar bisa Anda review per potong:

- **Slice A — UI kartu saja**: refactor `ReadyRequestSection` menampilkan kartu gaya ecer (chip, kotak siap, kiriman pegawai, ⋮ menu, layout toggle). WA/Chat masih redirect ke `/request` seperti sekarang. Zero perubahan alur pengiriman.
- **Slice B — Dialog verifikasi**: ekstrak/bikin `SendRequestPrepsDialog` + wire ke tombol WA/Chat di kartu + `/request?title=…&send=1` deeplink. Setelah slice B, tap WA/Chat = buka dialog verifikasi.
- **Slice C — Bulk + gate**: bulk WA/Chat (1 judul max), disabled state + tooltip kalau belum ada `request_preparations`, dan hapus semua fallback lama.

Tiap slice diverifikasi dengan `bunx tsgo --noEmit` sebelum lanjut. Slice A langsung bisa Anda uji di 411px.

## Yang perlu Anda konfirmasi

1. **Mulai dari Slice A dulu (UI-only), atau kerjakan A + B sekaligus?** Saya default ke A dulu karena paling aman untuk verifikasi visual di device Anda sebelum sentuh alur pembayaran.
2. **Kalau judul cuma punya kiriman pegawai (belum ada `request_preparations`)** → tombol WA/Chat: (a) disabled + tooltip arahkan ke `/request`, atau (b) auto-buka dialog verifikasi dari Beranda? Default saya (a) — sama dengan aturan explicit-state Ecer.
