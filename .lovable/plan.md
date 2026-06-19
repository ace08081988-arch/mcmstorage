## Ringkasan

Fitur baru "Tugas Pegawai": Anda buat tugas dari item Gudang, sistem hasilkan link + PIN, kirim ke pegawai via WA. Pegawai buka link, masukkan PIN, lalu unggah/ambil foto barang + lokasi. Foto bisa diedit (stiker, panah, teks, coret). Hasil otomatis sinkron ke aplikasi Anda secara realtime. Tombol "Bagikan ke WA" pakai Web Share API HP sehingga foto ikut terkirim.

## Apa yang dibangun

### 1. Backend (Lovable Cloud)
- Tabel `prep_tasks` — 1 tugas berisi banyak item; menyimpan `share_token` (acak 32 char), `pin_hash` (4–6 digit, hashed), `status`, `expires_at`, `owner_user_id`.
- Tabel `prep_task_items` — referensi ke item gudang, qty diminta, qty disiapkan, catatan.
- Tabel `prep_submissions` — foto + lokasi + catatan yang dikirim pegawai per item. Kolom: `task_item_id`, `photo_path` (storage), `location_url`, `gps_lat/lng`, `note`, `submitted_at`.
- Bucket storage `prep-photos` (publik-via-signed-url): pegawai upload via signed upload URL agar tidak butuh login.
- RLS: pemilik tugas baca/tulis penuh; akses publik (anon) dibatasi ke RPC `submit_prep_photo(token, pin, …)` yang memverifikasi PIN sebelum insert.
- Realtime channel di `prep_submissions` agar aplikasi Anda lihat foto masuk langsung.

### 2. Halaman publik pegawai `/t/$token`
- Form PIN dulu. Setelah benar, tampilkan daftar item: nama, qty diminta, foto referensi.
- Per item: tombol "Foto kamera", "Pilih dari galeri", "Ambil lokasi" (GPS), tempel link maps manual, catatan.
- Editor foto lengkap (lihat bagian 3) sebelum kirim.
- Tombol "Kirim" upload foto + lokasi ke server. Indikator progress per item.
- Layout mobile-first, bisa offline-resume (draft di localStorage per token).

### 3. Editor foto (canvas, custom)
Komponen `<PhotoEditor>` berbasis HTML Canvas + react state:
- Layer system: foto dasar + N overlay (stiker, teks, panah, coretan).
- Tools: crop, rotate 90°, brightness/contrast slider, free-draw (brush dengan warna+tebal), teks (font+warna+ukuran), stiker emoji, panah preset (lurus, lengkung, ↑↓←→↖↗↙↘) dengan warna+tebal+ukuran, lingkaran/kotak highlight.
- Manipulasi layer: drag, resize handle, rotate handle, hapus, duplicate, urutan (atas/bawah).
- Undo/redo (history stack maks 30).
- Export ke JPEG (quality 0.85) sebelum upload.

### 4. UI Gudang — pembuatan tugas
- Di Tab Stok tambah tombol "Kirim ke pegawai" di tiap item dan toolbar "Buat tugas baru".
- Halaman `/_authenticated/tugas` — daftar tugas (aktif/selesai), buat tugas: pilih item satu per satu, atur qty, klik "Buat & kirim".
- Setelah dibuat: dialog tampilkan link + PIN, tombol "Bagikan via WA" (Web Share API jika tersedia, fallback `wa.me?text=...`).
- Detail tugas: lihat foto yang masuk realtime, qty disiapkan vs diminta, tandai selesai, terima ke stok (opsional: tombol "Tambah ke stok" yang otomatis isi form pembelian).

### 5. Perbaikan share WA dengan foto
- Helper `shareToWhatsApp({ text, files })`:
  - Jika `navigator.canShare({ files })` true → pakai Web Share API sistem (Android/iOS bisa pilih WA dan foto ikut terlampir).
  - Fallback: download foto + buka `wa.me?text=...` dengan pesan yang menyertakan link halaman publik foto.
- Pakai helper ini di drawer produk lama (yang sebelumnya hanya kirim teks lokasi) dan di halaman tugas.

## Detail teknis

- Token: `crypto.getRandomValues` 24 byte base64url.
- PIN: 6 digit, disimpan sebagai bcrypt/scrypt hash (pgcrypto `crypt()`). Verifikasi via RPC `verify_prep_pin(token, pin)` return ephemeral access token (JWT pendek di cookie httpOnly per submission).
- Upload publik: RPC `request_prep_upload(access_token, item_id)` → return signed upload URL dari Storage (`createSignedUploadUrl`).
- Realtime: subscribe `postgres_changes` pada `prep_submissions` filter `task_id`.
- Editor: satu file `src/components/photo-editor/` dengan submodul tool. Tidak pakai library berat — Canvas 2D + pointer events.
- Web Share API butuh HTTPS; aplikasi sudah HTTPS di preview/published.

## Yang tidak termasuk (bisa ditambah nanti)

- Login pegawai permanen (kita pakai link+PIN saja sesuai pilihan Anda).
- Otomatisasi "stok ≤ ambang" — tugas dibuat manual sesuai pilihan Anda.
- Notifikasi push ke aplikasi Anda saat foto masuk (cukup realtime sambil aplikasi terbuka).

## Urutan kerja

1. Migrasi DB + bucket + RLS + RPC.
2. Halaman publik `/t/$token` minimal (tanpa editor) + upload alur.
3. UI buat tugas + share WA dengan Web Share API.
4. Realtime + halaman detail tugas.
5. Editor foto lengkap (paling besar; iterasi sendiri).
6. Polish: progress, draft lokal, error handling.

Konfirmasi untuk saya mulai dari langkah 1?
