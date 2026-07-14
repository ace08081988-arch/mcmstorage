## Diagnosis

Di aplikasi saat ini ada 3 surface yang menampilkan "kotak ecer siap kirim", dan aturan gate-nya belum seragam:

| Surface | Sumber data | Tombol yang muncul | Wajib "Jual" dulu? |
|---|---|---|---|
| `/tugas` → tab **Siapkan Sendiri** (`SiapkanSendiriSection`) | `self_prep_items` | **Jual (catat penjualan)** + WA + Chat + Hapus | ✅ Ya — `saleShareGate` blokir WA/Chat sebelum `sold_at` |
| `/ecer` → detail judul, kartu **PrepBox** (worker prep) | `ecer_preparations` (created_by='worker') | Ikon Share2 → buka `SendEcerPrepsDialog` (3 langkah: pelanggan → verifikasi bayar → kirim WA) | ✅ Ya — dialog wajib pilih metode bayar sebelum RPC `send_ecer_preps_to_customer` |
| **`/index` (Beranda) → `ReadyEcerSection`** — kartu "PSR (SPR) · N kotak siap" dari worker shots | `prep_submissions` + `ecer_preparations` | Tombol **WA / Chat** langsung: bikin caption, share, tandai `sent_at` di `prep_submissions`. Tidak ada tombol Jual, tidak ada pencatatan penjualan/hutang, tidak buka `SendEcerPrepsDialog` | ❌ Tidak — inilah bocor yang di video |

Alur di video: pegawai menyiapkan → foto masuk ke kartu `ReadyEcerSection` di Beranda → owner tap WA/Chat → langsung ke share (hanya edit teks caption). Penjualan tidak tercatat, hutang tidak tercatat — melanggar aturan "state penjualan harus eksplisit" yang sudah berlaku di Siapkan Sendiri & `/ecer`.

## Perbaikan

**Prinsip:** `ReadyEcerSection` (kartu dashboard) tidak boleh mengirim langsung. Gate-nya sama dengan Siapkan Sendiri: harus lewat pencatatan penjualan dulu.

**Karena `/ecer` sudah punya `SendEcerPrepsDialog` yang lengkap (3 langkah: pelanggan → verifikasi bayar → konfirmasi & kirim WA + panggil RPC `send_ecer_preps_to_customer` yang menulis penjualan + piutang atomik),** solusi paling aman dan tidak menduplikasi logika:

### Ubahan di `src/components/ReadyEcerSection.tsx`

1. **Tombol WA & Chat per kartu (individual + bulk) tidak lagi memicu `shareToWhatsApp` / `shareToChat` langsung.** Sebagai gantinya, kedua tombol membuka `SendEcerPrepsDialog` (di-lift dari `_authenticated.ecer.tsx` ke komponen bersama, atau di-embed dengan navigasi + auto-open).

2. **Alur baru (mirror Siapkan Sendiri):**
   - Tap **WA** atau **Chat** pada kartu ecer di Beranda → resolve `ecer_preparations` aktif untuk judul itu (yang `sold_at IS NULL`) → buka `SendEcerPrepsDialog` dengan `preps` sudah terisi.
   - Owner isi pelanggan (langkah 1) → pilih metode bayar Lunas/Hutang/Sebagian + total (langkah 2) → konfirmasi → RPC `send_ecer_preps_to_customer` tulis penjualan + piutang → baru WA/Chat share caption+foto+bukti.
   - Setelah sukses: `emitDebtTx` → kartu di dashboard otomatis refresh (sudah ada listener `useOnDebtTx`).

3. **Kalau kartu hanya berisi `prep_submissions` yang belum diverifikasi jadi `ecer_preparations`:** tombol WA/Chat non-aktif dengan tooltip "Verifikasi kiriman pegawai di /ecer dulu" (surface yang benar untuk verifikasi tetap `/ecer` detail — jangan duplikasi verifikasi di dashboard).

4. **Lift `SendEcerPrepsDialog` menjadi file bersama** `src/components/ecer/SendEcerPrepsDialog.tsx` supaya bisa dipakai `_authenticated.ecer.tsx` DAN `ReadyEcerSection`. Ekspor tipe props yang sudah ada. Import `customers` di `ReadyEcerSection` sekali per uid (persis pola `SiapkanSendiriSection`).

5. **Hapus alur `sendWA` / bulk-WA yang lama di `ReadyEcerSection`** setelah dialog terhubung — kode ~500 baris idempotency/preview/log untuk share langsung menjadi tidak relevan pada dashboard (share dilakukan post-RPC oleh dialog). Simpan `send-log` untuk kanal `/ecer` detail saja.

### Yang TIDAK berubah

- `/ecer` detail page (`_authenticated.ecer.tsx`) — sudah benar, cuma di-refactor untuk pakai file bersama.
- `SiapkanSendiriSection` — sudah benar, jadi referensi.
- RPC `send_ecer_preps_to_customer` — tidak diubah.
- Aturan explicit state: tidak ada auto-detect "sudah dibayar".

## Cakupan pekerjaan

- [ ] Ekstrak `SendEcerPrepsDialog` ke `src/components/ecer/SendEcerPrepsDialog.tsx` + dependencies (`buildPaymentMessageLines`, `getPaymentBreakdown`, dll — sebagian besar sudah di `src/lib/`).
- [ ] Update `_authenticated.ecer.tsx` untuk import dari lokasi baru.
- [ ] `ReadyEcerSection`: ganti onClick WA/Chat (individual + bulk) → buka dialog dengan `ecer_preparations` aktif untuk baris tsb.
- [ ] Tambah state `customers` di `ReadyEcerSection` (fetch sekali per uid).
- [ ] Gate: kalau tidak ada `ecer_preparations` aktif (cuma submission mentah), tombol disabled + tooltip arahkan ke `/ecer`.
- [ ] Test manual di 411px: worker prep → verifikasi di /ecer → kartu Beranda → tap WA → dialog 3 langkah → kirim → cek piutang tercatat.

## Yang perlu Anda konfirmasi

**Pertanyaan tunggal:** Ketika kartu di Beranda cuma berisi kiriman pegawai yang **belum diverifikasi jadi ecer_preparations** (masih `prep_submissions` mentah), apa yang harus terjadi saat owner tap WA/Chat?

- **(A)** Tombol disabled + arahkan owner ke `/ecer` untuk verifikasi dulu — verifikasi tetap satu tempat, dashboard cuma tampilkan.
- **(B)** Buka dialog verifikasi + jual sekaligus di dashboard — 1 tap untuk approve + catat penjualan + kirim.

Opsi (A) lebih dekat dengan struktur saat ini dan minim risiko regresi. Opsi (B) lebih cepat untuk owner tapi menduplikasi logika verifikasi (`prep_approve` RPC) ke surface baru.

Kalau tidak dijawab, saya default ke **(A)** sesuai preferensi "narrow, auditable slices".