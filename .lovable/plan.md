# Perbaikan Link Pegawai Penyiapan Request — Konsisten & 1-Paket

## Masalah

1. **Satu link bisa dipakai berulang.** `SendPrepLinkDialog` di `/request` membuat `prep_tasks` baru tiap sesi, tapi pegawai bisa submit banyak paket dari 1 PIN → Riwayat Pengiriman menumpuk banyak nama pegawai di 1 task, dan pesanan per orang saling tercampur.
2. **Fitur halaman pegawai (`/t/$token`) tidak sekonsisten form admin.** Kamera langsung, galeri, PhotoEditor, dan GPS otomatis sudah ada — tapi **tidak ada input lokasi manual** (koordinat/URL Maps) sebagai fallback ketika GPS device menolak izin.

## Perbaikan

### 1. DB: kunci "1 link = 1 paket"

Migrasi baru:

- `ALTER TABLE prep_tasks` — tambah kolom `max_submissions int NOT NULL DEFAULT 1`. Untuk task lama (tugas biasa via `/tugas-baru`, ecer, dsb.) di-backfill ke `NULL`-safe: default 1 hanya berlaku untuk task baru; task lama di-set ke nilai besar (mis. 999) via `UPDATE ... WHERE created_at < now()`.
- Update `prep_submit` dan `request_submit_via_task`: setelah insert submission/preparation sukses, hitung `used = COUNT(*)` dari tabel target (`prep_submissions` untuk tugas biasa, `request_preparations` untuk request via `via_task_id`). Kalau `used >= v_task.max_submissions`, `UPDATE prep_tasks SET status='completed', completed_at=now()` **dalam transaksi yang sama**.
- Balikan error `task_exhausted` jika sebelum insert `used >= max_submissions`.
- Tambah parameter opsional `_max_submissions int DEFAULT 1` ke `prep_create_task` — dilalui apa adanya. Backward compatible.

### 2. Frontend admin: dialog "Kirim link"

`src/routes/_authenticated.request.tsx` — `SendPrepLinkDialog`:

- Setelah pegawai berhasil submit 1x, session lama otomatis "kadaluarsa" (task jadi completed). Tambah label kecil di dialog: *"1 link + PIN = 1 penyiapan. Untuk pesanan berikutnya, buat link baru."*
- Tombol tambahan **"Buat link baru untuk pegawai lain"** yang reset session lokal (bikin token+PIN baru via `prep_create_task` fresh). Tidak menutup dialog — biar admin bisa langsung salin lagi.
- `prep_create_task` dipanggil dengan `_max_submissions: 1`.

### 3. Frontend pegawai: input lokasi manual

`src/routes/t.$token.tsx`:

- Di section lokasi, tambah accordion/collapsible **"Isi manual"** dengan 2 mode:
  - **Koordinat**: dua input `lat` + `lng` (parse `parseFloat`, clamp lat -90..90, lng -180..180). Tombol "Pakai" → set `gps` state + `locUrl = google maps URL`.
  - **URL Maps**: 1 input, validasi `https://` + regex koordinat opsional. Set `locUrl` langsung.
- Muncul otomatis kalau `getCurrentPosition` gagal (permission denied / timeout) dengan pesan pengarah.
- Reuse tombol "Ambil GPS otomatis" yang sudah ada.

### 4. Verifikasi

- Migrasi jalan bersih di lokal.
- `tsgo --noEmit` hijau.
- Test manual mental: bikin 2 pesanan → kirim link ke pegawai A → pegawai submit → link A completed → kirim link baru ke pegawai B → pegawai B submit → Riwayat menampilkan 2 baris terpisah dengan status masing-masing.

## Catatan teknis

- `max_submissions=1` untuk task Request via `SendPrepLinkDialog` dan `SendPrepLinkDialogForCustomer` (kalau ada). Task via `/tugas-baru` tetap unlimited (kompat) — bisa Ace atur belakangan.
- Task selesai (`status='completed'`) sudah otomatis ditangani oleh cek `status='active'` di kedua RPC → PIN mati dengan sendirinya.
- Input manual lokasi tidak mengganggu path GPS otomatis; keduanya menulis ke state yang sama (`gps` + `locUrl`), jadi submit tetap kirim URL Maps yang konsisten.

## File yang berubah

- **Migrasi baru** — kolom `max_submissions`, update `prep_submit`, `request_submit_via_task`, `prep_create_task`.
- `src/routes/_authenticated.request.tsx` — RPC arg, label, tombol reset session.
- `src/routes/t.$token.tsx` — komponen input lokasi manual.
