## Ringkasan

Setiap produk di Gudang dapat memiliki **Judul Ecer** (misal: "KRISTAL 1 gram") berisi banyak **Penyiapan Ecer** (kotak-kotak yang berisi foto + lokasi + berat aktual + keterangan). Saat penyiapan disimpan, stok produk otomatis berkurang sebesar berat yang diisi. Bisa diakses dari Gudang, halaman khusus `/ecer`, dan oleh pegawai lewat link tugas (PIN).

## Apa yang dibangun

### 1. Database (Lovable Cloud)

Dua tabel baru, plus reuse bucket `prep-photos` yang sudah ada.

**`ecer_titles`** — judul ecer per produk
- `warehouse_item_id` (fk), `user_id`, `name` (mis. "KRISTAL 1 gram"), `target_grams` (numeric, mis. 1.00), `unit_label` (`g`/`gram`), `note`, `position`

**`ecer_preparations`** — kotak penyiapan
- `title_id` (fk), `user_id`, `warehouse_item_id` (denormal untuk RLS cepat), `actual_grams` (mis. 0.90), `photo_path`, `location_url`, `gps_lat/lng`, `note`, `created_by` (`admin`/`worker`), `prep_task_item_id` (nullable — jika dibuat via link pegawai), `created_at`

**Trigger `apply_ecer_prep`** — INSERT: kurangi `warehouse_items.stock_base` sebesar `actual_grams` (cek cukup). DELETE: kembalikan stok.

RLS standar `user_id = auth.uid()` + GRANT authenticated/service_role.

### 2. RPC publik untuk pegawai

Reuse alur `prep_get_task` + `prep_submit`. Tambah RPC `ecer_submit_via_task(_token, _pin, _title_id, _actual_grams, _photo_path, _location_url, _gps_lat, _gps_lng, _note)`:
- Verifikasi PIN tugas (sama seperti `prep_submit`).
- Cek `title_id` milik `owner_user_id` tugas.
- Insert `ecer_preparations` dengan `created_by='worker'`, `prep_task_item_id` opsional.
- Stok auto-kurang via trigger.

### 3. UI Admin

**Di Gudang (`ProductEditDrawer`)** — tab baru "⚖️ Ecer":
- Daftar Judul Ecer (CRUD). Tiap judul tampil sebagai card: nama, target berat, jumlah penyiapan.
- Klik judul → buka panel daftar **kotak penyiapan** (grid foto thumbnail), tombol "+ Penyiapan baru".
- Form penyiapan: pilih foto (kamera/galeri) → editor foto opsional → ambil lokasi (GPS) / tempel link → berat aktual → keterangan → Simpan.

**Halaman baru `/ecer`** (`src/routes/_authenticated.ecer.tsx`):
- Daftar semua judul ecer lintas produk, filter per kategori/produk.
- Klik judul → halaman detail dengan grid kotak penyiapan + tombol tambah.
- Tombol "Bagikan ke WA" per penyiapan (pakai `shareToWhatsApp` yang sudah ada).

**Di `ReadyPackagesPanel`** — ganti panel ecer LocalStorage lama:
- Saat membuat paket, dropdown "Pilih dari Penyiapan Ecer tersedia" → otomatis isi qty + lampirkan foto + lokasi ke caption WA.

### 4. UI Pegawai (link tugas)

Di `src/routes/t.$token.tsx`, untuk tiap item yang punya `warehouse_item_id`:
- Tampilkan daftar Judul Ecer milik item itu.
- Pegawai pilih judul → form penyiapan (foto + lokasi + berat aktual + keterangan).
- Kirim → call `ecer_submit_via_task`. Realtime muncul di dashboard admin.

### 5. Komponen yang dipakai ulang

- `PhotoEditor` (sudah ada) untuk anotasi foto sebelum upload.
- `shareToWhatsApp` (sudah ada) untuk share kotak penyiapan.
- `signedUrl`, `uploadPrepPhoto` dari `src/lib/prep.ts` (bucket `prep-photos`).

### 6. Migrasi data lama

Panel ecer LocalStorage di `ReadyPackagesPanel` (`ecer:presets:*`) di-deprecate. Tampilkan info sekali "Pindah ke Ecer baru" + tombol buka halaman ecer produk.

## Detail teknis

```text
ecer_titles (1) ──< ecer_preparations (N)
       │
       └── warehouse_items (target produk)
```

- Path foto: `ecer/<user_id>/<title_id>/<timestamp>-<rand>.jpg` di bucket `prep-photos`.
- Stok berkurang via trigger SECURITY DEFINER, transaksi tunggal (insert + update stok atomik).
- Realtime: subscribe `postgres_changes` pada `ecer_preparations` filter `user_id`.

## Yang TIDAK termasuk (bisa nanti)

- Edit foto setelah disimpan (hapus + buat ulang saja).
- Laporan/agregasi ecer (total gram terjual per judul).
- Auto-buat paket siap kirim dari kotak penyiapan (sekarang manual: pilih di form paket).

## Urutan kerja

1. Migrasi DB (tabel + RLS + trigger + RPC).
2. Komponen admin: tab Ecer di Gudang + halaman `/ecer`.
3. UI pegawai di `/t/$token`.
4. Integrasi dengan Paket Siap Kirim (pilih penyiapan tersedia).
5. Polish: realtime, share WA, deprecate LocalStorage lama.

Setuju saya mulai dari langkah 1 (migrasi DB)?