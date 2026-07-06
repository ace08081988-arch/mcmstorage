## Ringkasan

Saat ini PrepBox ecer hanya punya tombol Share WA + Delete — tidak ada pencatatan penjualan, tidak ada verifikasi pembayaran, dan tidak ada Riwayat Terkirim. Dialog kirim request prep sudah ada tapi hanya menerima **kas** atau **hutang** penuh, belum ada **partial** (bayar sebagian, sisanya masuk piutang).

Tugasnya:
1. Ecer: dialog batch kirim beberapa kotak sekaligus dalam 1 transaksi, dengan pilihan **Lunas / Hutang / Bayar sebagian**. Kotak yang sudah terkirim pindah ke Riwayat Terkirim, read-only, tidak muncul lagi di grid aktif.
2. Request prep: tambah opsi **Bayar sebagian** ke dialog kirim, sisanya otomatis jadi piutang.
3. Skema `ecer_preparations` dapat kolom sold_* (mirror pola request_preparations) supaya Riwayat Terkirim jalan.

## Perubahan database (1 migrasi)

- `ecer_preparations`: tambah kolom `sold_at`, `sold_customer_id` (FK customers), `sold_party_name`, `sold_total`, `sold_paid_amount`, `sold_payment_method` (kas/hutang/partial), `sold_note`. Trigger `apply_ecer_preparation` sekarang jalan di INSERT/DELETE — pindahkan agar DELETE hanya kembalikan stok saat `sold_at IS NULL` (biar RPC kirim tidak double-count karena dia insert ke sales sebagai penggantinya). Baca dulu trigger existing lalu putuskan: tambah UPDATE guard atau tandai row dengan sold sebelum DELETE.
- `debts.source` CHECK: tambah `'ecer_prep'`.
- RPC baru `send_ecer_preps_to_customer(_prep_ids uuid[], _customer_id, _party_name, _total_amount, _paid_amount, _payment_method text, _note)`:
  - Validasi: metode ∈ {kas, hutang, partial}; kalau partial → 0 < paid < total; kas → paid = total; hutang → paid = 0.
  - Lock semua prep milik user, tolak yang `sold_at IS NOT NULL`.
  - Alokasi total pro-rata per prep (berdasar `actual_grams`) untuk masukkan ke `sales` (payment_method sales tetap 'kas' kalau lunas, else 'hutang' — batas CHECK existing).
  - Delete row `ecer_preparations` tidak dilakukan; sebagai gantinya update flag sold_* dan buat sales insert manual (bukan lewat trigger DELETE). Menghindari perubahan trigger existing.
  - Kalau ada sisa (hutang atau partial): insert `debts(kind='piutang', source='ecer_prep', source_id=<first prep_id>, amount = total - paid)`. Kalau partial → debt = sisa saja (langsung net); tidak perlu debt_payments.
  - Return prep_ids yang berhasil.
- RPC `send_request_prep_to_customer`: tambah param `_paid_amount numeric DEFAULT NULL`, terima `_payment_method = 'partial'`. Logic sama: sales tetap kas/hutang pro-rata; debt.amount = total - paid. Backward compat: kalau `_paid_amount IS NULL` fallback ke perilaku lama (kas→paid=total, hutang→paid=0).

## Perubahan UI

### `src/routes/_authenticated.ecer.tsx`
- State pilihan multi-kotak per judul (Set of prep IDs). Tombol "Pilih" masuk mode seleksi di card judul.
- Header aksi ketika ada yang dipilih: tombol **Kirim ke pembeli (N)** membuka dialog batch baru.
- Dialog `SendEcerPrepsDialog` — mirip `SendPrepToCustomerDialog` tapi:
  - Ringkasan: daftar kotak terpilih (nama produk, aktual_grams, unit).
  - Pilih pelanggan (link/manual) — reuse pola existing.
  - Total harga (input manual).
  - Metode bayar: 3 radio → **Lunas / Hutang / Bayar sebagian**. Bila partial → input "Dibayar sekarang" (< total).
  - Catatan.
  - Kirim: panggil RPC `send_ecer_preps_to_customer` + lampirkan foto semua kotak terpilih ke WA (reuse `resolvePhotoUrl` + `shareToWhatsApp`).
- Grid aktif filter `!sold_at`; tab/section **Riwayat Terkirim** baru menampilkan yang `sold_at != null`, read-only (tidak ada Edit/Delete/Share ke pembeli lagi — Share WA opsional tetap boleh, atau tidak, ikuti pola request).
- Badge angka pada card judul: hanya hitung kotak yang belum sold.

### `src/routes/_authenticated.request.tsx`
- `SendPrepToCustomerDialog`: tambah radio ke-3 "Bayar sebagian" + input paid amount saat dipilih. Kirim `_payment_method: 'partial'` + `_paid_amount` ke RPC. Caption WA sebutkan "Dibayar: Rp X · Sisa piutang: Rp Y".

## Detail teknis

- Trigger `apply_ecer_preparation` existing: jalan pada INSERT (kurangi stok) & DELETE (kembalikan stok). RPC baru **tidak** delete row, hanya update flag sold_* dan insert baris `sales` — stok tetap terpotong sekali (dari trigger insert prep dulu), yang bertambah adalah revenue lewat trigger `apply_sale`. Karena qty tidak berubah, kita perlu **tidak** memicu double-decrement dari sales: sales trigger memotong stok lagi. Solusi: hapus item stok sekali dengan cara yang sama seperti request — trigger prep DELETE mengembalikan stok, lalu INSERT sales memotong stok. Jadi RPC ecer: `DELETE FROM ecer_preparations WHERE id=<prep>` (trigger kembalikan stok) → tapi ini menghapus row yang kita butuh untuk Riwayat Terkirim. 
  
  Rencana konkret: pisahkan siklus stok dari kehidupan row. Migrasi ubah trigger `apply_ecer_preparation` supaya DELETE hanya kembalikan stok bila `OLD.sold_at IS NULL`. Kemudian RPC: `UPDATE ... SET sold_at=now()` dulu (trigger tidak jalan di UPDATE), lalu insert sales (trigger `apply_sale` potong stok — konsisten dengan flow request). Hasilnya: row prep tetap ada dengan flag sold, stok bersih (net: 1× potong lewat prep insert awal, dan +1× dari sales insert → double-count). 
  
  Alternatif yang lebih bersih & konsisten dengan request: trigger prep pada DELETE saat `sold_at IS NULL` kembalikan stok; RPC untuk tiap prep terpilih: `DELETE prep` (stok +qty) → `INSERT INTO ecer_preparations_sold_archive(...)` … tapi ini bikin skema paralel. 
  
  Alternatif terbaik: **hentikan trigger `apply_ecer_preparation` melakukan stock movement**; sebagai gantinya `sales` insert selalu jadi single source of truth untuk stok keluar, dan `ecer_preparations` insert HANYA reserve stok kalau belum terjual — ubah trigger jadi net-zero pada saat sold (yaitu: pas UPDATE sold_at IS NULL → NOT NULL, "batalkan" pengurangan stok awal karena sales akan menggantinya). Konkret: `AFTER UPDATE OF sold_at` bila NEW.sold_at IS NOT NULL DAN OLD.sold_at IS NULL → tambah stok balik (`+actual_grams`). Trigger sales lalu potong lagi. Delete on sold row: no-op (sudah tidak mempengaruhi stok).
  
  Rencana final: tambahkan branch UPDATE ke trigger `apply_ecer_preparation` untuk kompensasi saat prep pindah ke terkirim (stok net +qty saat transition), dan pastikan DELETE hanya kembalikan stok saat `sold_at IS NULL`. RPC: `UPDATE sold_*` lebih dulu (trigger kompensasi jalan) → `INSERT sales` (potong lagi) → `INSERT debts` bila perlu.
  
  Lookup dan sesuaikan trigger `apply_ecer_preparation` di migrasi sebagai bagian dari perubahan ini.

- Batasan sales CHECK `payment_method IN ('kas','hutang')`: untuk partial, semua sales rows tetap dicatat sebagai `hutang` (karena ada sisa piutang) — pertimbangan alternatif split kas/hutang pro-rata tidak dilakukan agar tidak inflate transaksi.

## File yang disentuh

- `supabase/migrations/*` (satu migrasi baru)
- `src/routes/_authenticated.ecer.tsx` (dialog batch + mode seleksi + tab Riwayat Terkirim + filter grid + read-only guard)
- `src/routes/_authenticated.request.tsx` (radio partial + input paid amount + kirim ke RPC)
- `src/integrations/supabase/types.ts` (regen otomatis setelah migrasi disetujui)

## Verifikasi

- Kirim 2 kotak lunas → 2 sales kas, no debt, kedua prep di Riwayat Terkirim, stok gudang net = 1× potong.
- Kirim 3 kotak hutang → 3 sales hutang, 1 debt piutang penuh, prep di Riwayat.
- Kirim 2 kotak partial (total 100k, bayar 30k) → sales hutang pro-rata, debt piutang 70k, prep di Riwayat.
- Request prep partial: sama pola, debt = sisa.
- Ecer terkirim tidak muncul di grid aktif, tidak bisa Edit/Delete/Share ulang.
- Badge angka judul konsisten dengan hanya yang belum sold.
