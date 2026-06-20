## Tujuan
Fitur baru "Judul Penyiapan REQUEST" — sama prinsip kerja seperti Ecer, tapi 1 judul berisi beberapa produk sekaligus, dan tiap penyiapan = 1 paket multi-produk dengan foto+lokasi. Stok semua item otomatis berkurang. Bisa diakses admin (halaman /request) maupun pegawai (link tugas + PIN).

## Database (migrasi baru)

Tabel baru di `public`:

1. **`request_titles`** — judul template paket
   - kolom domain: `name`, `note`, `position`
   - GRANT authenticated, RLS scoped `auth.uid()`

2. **`request_title_items`** — daftar produk dalam judul (template)
   - kolom domain: `title_id`, `warehouse_item_id`, `target_grams`, `unit_label`, `note`, `position`
   - GRANT authenticated, RLS via parent owner (security definer helper)

3. **`request_preparations`** — realisasi 1 paket (1 baris per penyiapan)
   - kolom domain: `title_id`, `photo_path`, `location_url`, `gps_lat`, `gps_lng`, `note`, `created_by`, `prep_task_item_id`
   - RLS scoped `auth.uid()`

4. **`request_preparation_items`** — rincian item yg dipotong stoknya per penyiapan
   - kolom domain: `preparation_id`, `warehouse_item_id`, `actual_grams`
   - Trigger `apply_request_preparation_item` (security definer) potong stok saat INSERT, balikin saat DELETE

5. **RPC pegawai** (security definer, sama pola Ecer):
   - `request_list_titles_via_task(token, pin)` — list judul + items
   - `request_submit_via_task(token, pin, title_id, items[], photo_path, location_url, gps, note, prep_task_item_id)` — bikin preparation + items dalam 1 transaksi

Bucket reuse `ecer-photos` (atau bucket baru `request-photos`? — reuse `ecer-photos` lebih simpel, policy storage sudah ada).

## Kode

1. `src/lib/request.ts` — types + helper signed URL + upload (reuse bucket ecer-photos dengan prefix folder `request/`)
2. `src/routes/_authenticated.request.tsx` — halaman admin: CRUD judul (tambah item per judul), daftar penyiapan, form penyiapan baru (pilih semua produk → isi qty + 1 foto+lokasi)
3. `src/components/ReadyRequestSection.tsx` — mirip ReadyEcerSection di beranda, daftar judul siap kirim
4. `src/routes/_authenticated.index.tsx` — tambah shortcut "Penyiapan Request" + render `<ReadyRequestSection />`
5. `src/components/AppSidebar.tsx` — tambah link "Penyiapan Request"
6. **Halaman pegawai** — tambah tab/section "REQUEST" pada halaman tugas pegawai yang sudah ada (cari route prep worker), pakai RPC `request_list_titles_via_task` / `request_submit_via_task`

## Catatan teknis
- Tabel parent (`request_titles`) RLS pakai `auth.uid() = user_id`. Tabel child pakai EXISTS lookup ke parent untuk hindari recursion.
- Trigger pengurangan stok pakai `FOR UPDATE` + cek `stock_base >= actual_grams` per item (sama pola `apply_ecer_preparation`).
- Form admin: tombol "Tambah Produk" untuk append baris produk ke judul; saat penyiapan, item bawaan judul muncul auto, qty bisa di-override.
- Worker flow: pegawai pilih judul → form menampilkan semua item dengan input gram → 1 foto+lokasi → submit RPC.

Setelah migrasi disetujui, saya lanjut kode TypeScript-nya.