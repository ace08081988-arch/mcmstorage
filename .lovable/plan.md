## Ringkasan

Di halaman `/tugas` → "Siapkan Sendiri", tambah tombol **Jual** di setiap kartu tugas (yang belum terjual). Tap Jual → dialog pilih pelanggan + pilih produk gudang & gram + metode bayar (Lunas / Hutang / Sebagian) → catat penjualan (potong stok, catat piutang bila perlu) → tandai tugas "sudah dijual". Tombol WA & Chat dikunci sampai Jual sukses. Setelah sukses, WA/Chat aktif dan kaption pengiriman otomatis menyertakan:

- Foto-foto yang sudah ada di tugas
- Link lokasi yang sudah ada
- Ringkasan penjualan (produk + gram + total)
- Catatan hutang bila metode = Hutang / Sebagian (sisa piutang)

## Perubahan database

Tambah kolom di `self_prep_items` untuk merekam status penjualan (paralel dengan pola di `ecer_preparations` / `request_preparations`):

- `sold_at timestamptz` — kapan dijual
- `sold_customer_id uuid` → `customers(id)`
- `sold_total numeric` — total penjualan
- `sold_paid_amount numeric` — jumlah dibayar (untuk Sebagian)
- `sold_payment_method text` — "kas" | "hutang" | "sebagian"
- `sold_debt_id uuid` → `debts(id)` (nullable; untuk kasus Hutang/Sebagian)

Tidak menambah tabel baru. Item penjualan (produk × gram) tidak dipersistensi di kartu tugas — sudah tercatat penuh di tabel `sales` (rujukan silang via note "Tugas: <title>").

## Alur UI

### Kartu tugas (`SiapkanSendiriSection.tsx`)

Header kartu bertambah baris status:

- `status === "ready" && !sold_at` → tombol **Jual** hijau primer + tombol WA & Chat dalam keadaan **disabled** dengan tooltip "Catat penjualan dulu".
- `sold_at != null` → tampilkan chip "Terjual • Lunas/Hutang/Sebagian • Rp x.xxx" + tombol WA & Chat **aktif**.
- `status === "sent"` → tampilan riwayat seperti sekarang, tetap terkunci.

### Dialog Jual (`SellSelfPrepDialog.tsx`, baru)

Isi form:

1. Pilih pelanggan (combobox dari `customers`).
2. Daftar baris penjualan (minimal 1 baris):
   - Pilih produk (dari `warehouse_items` milik user)
   - Input gram (mode base) — tampilkan sisa stok, warning kalau kurang
   - Input harga per base (auto-fill dari `default_sale_price_per_base` bila ada)
   - Subtotal otomatis
3. Total keseluruhan.
4. Metode bayar: Lunas / Hutang / Sebagian. Sebagian → input nominal dibayar.
5. Tombol simpan: nonaktif bila stok kurang atau data tidak lengkap.

Submit:

- Untuk setiap baris → `INSERT INTO sales(user_id, item_id, qty_base, price_per_base, total_revenue, cost_at_sale, note='Tugas Siapkan Sendiri: <title>', customer_id, payment_method)`. Trigger existing memotong stok.
- Metode Hutang / Sebagian → `INSERT INTO debts(user_id, customer_id, amount=total, paid_amount=paid_amount, note=...)` sekali untuk total tugas, lalu simpan `debt_id` di `self_prep_items.sold_debt_id`.
- Update `self_prep_items` set `sold_at`, `sold_customer_id`, `sold_total`, `sold_paid_amount`, `sold_payment_method`, `sold_debt_id`.
- Toast sukses, tutup dialog, `load()` refresh.

Kalau salah satu insert `sales` gagal (mis. stok kurang di baris ke-N), rollback baris-baris sebelumnya lewat delete sederhana lalu tampilkan error. (RPC transaksional bisa ditambah nanti; untuk MVP: cek stok semua baris di awal supaya rollback jarang perlu.)

### WA / Chat (setelah Jual)

Fungsi `onSendWA` dan `onSendChat` yang sudah ada tetap dipakai, hanya ditambah:

- Guard: `if (!r.sold_at) return toast.error("Catat penjualan dulu");` (defensive; UI sudah men-disable).
- Kaption ditambahkan blok ringkasan penjualan setelah judul + note:
  ```
  <title>
  <note>

  💰 Penjualan
  • <produk> <gram>g × Rp<price> = Rp<subtotal>
  ...
  Total: Rp<sold_total>
  Pembayaran: Lunas | Hutang Rp<sisa> | Dibayar Rp<paid>, sisa Rp<sisa>
  Pelanggan: <nama>

  📍 <location_url>
  ```
- Untuk ambil rincian baris, dialog Jual menyimpan snapshot ke `self_prep_items.sold_summary` (kolom teks yang sudah ada tapi belum dipakai untuk ini) — atau ambil ulang dari `sales` via `note ILIKE 'Tugas Siapkan Sendiri: <title>%'` + `sold_at`. Pakai `sold_summary` untuk kesederhanaan.

## File yang disentuh

- `supabase/migrations/xxxx_self_prep_sale_columns.sql` (baru) — tambah kolom & FK.
- `src/components/SiapkanSendiriSection.tsx` — tombol Jual + gating WA/Chat + tampilan chip penjualan + kaption tambahan.
- `src/components/SellSelfPrepDialog.tsx` (baru) — form dialog.
- `src/integrations/supabase/types.ts` — regen otomatis pasca migrasi.

Tidak menyentuh: /ecer, /request, dashboard, chat, kontak.

## Verifikasi

1. `/tugas` → kartu tugas siap → tombol WA/Chat disabled, tombol **Jual** hijau aktif.
2. Tap Jual → dialog muncul → pilih pelanggan, tambah 1 baris (produk + 500g @ Rp 10.000/g) → total Rp 5.000.000 → pilih Lunas → Simpan → toast sukses → dialog tutup → kartu menampilkan chip "Terjual Lunas Rp 5.000.000" dan WA/Chat menyala.
3. Tap WA → WhatsApp terbuka dengan foto + link lokasi + ringkasan penjualan + Total + Lunas.
4. Tap Chat → picker percakapan → kirim → pesan terkirim dengan konten yang sama.
5. Ulangi dengan Hutang → dialog piutang tercatat di `/kontak` (piutang), kaption WA menyertakan "Hutang Rp 5.000.000".
6. Ulangi dengan Sebagian (dibayar Rp 2.000.000) → piutang tercatat Rp 3.000.000 sisa, kaption WA menyertakan "Dibayar Rp 2.000.000, sisa Rp 3.000.000".
7. Stok gudang berkurang sesuai gram di setiap baris.
8. `bun run typecheck` hijau.

## Yang tidak dilakukan di plan ini

- Refactor /ecer dan /request (sudah benar; dialog bayar sudah ada di sana).
- Masalah "Terima permintaan teman diarahkan ke gak jelas" — plan terpisah, butuh Anda beritahu titik masuk yang bermasalah (notifikasi push? banner? deep-link `/i/<kode>`?).
