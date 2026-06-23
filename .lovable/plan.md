## Tujuan
Membuat data tugas penyiapan sinkron otomatis dua arah antara aplikasi admin (`/tugas`) dan link pegawai (`/t/<token>`), serta menjaga konsistensi saat admin mengedit item, PIN, status, atau masa berlaku — termasuk perlindungan dari konflik tulis-baca saat pegawai sedang mengisi foto.

## Apa yang akan diubah

### 1. Realtime dua arah
- **Admin → Pegawai (baru):** trigger Postgres di `prep_tasks` & `prep_task_items` mengirim "ping" via `realtime.send()` ke topic `prep:<share_token>` setiap kali ada INSERT/UPDATE/DELETE. Payload hanya berisi `{kind, op}` (tidak ada data sensitif).
- **Pegawai berlangganan:** halaman `/t/<token>` membuka channel broadcast `prep:<token>` setelah PIN benar; setiap ping memanggil ulang `prep_get_task` (PIN sudah disimpan in-memory) sehingga daftar item, status, dan waktu kedaluwarsa langsung diperbarui tanpa reload.
- **Pegawai → Admin (sudah ada):** `TaskDetail` di `_authenticated.tugas.tsx` sudah berlangganan `postgres_changes` untuk `prep_submissions` & `prep_task_items` — tetap dipertahankan.
- **Fallback:** re-fetch otomatis saat tab kembali aktif (`visibilitychange`) dan heartbeat 15 detik, agar jika websocket terputus pun data tidak basi lama.

### 2. Konsistensi edit
- **Item tugas:** kolom `updated_at` ditambahkan ke `prep_task_items` (+ trigger auto-update) supaya setiap perubahan punya versi.
- **PIN diganti:** jika admin mengubah PIN saat pegawai sedang aktif, RPC berikutnya akan mengembalikan `bad_pin`; halaman pegawai menangkapnya dan otomatis melempar kembali ke layar verifikasi PIN dengan pesan "PIN diperbarui pemilik, masukkan PIN baru".
- **Status tugas → selesai / kedaluwarsa:** ping realtime memicu refresh; jika `prep_get_task` mengembalikan `not_found`, halaman pegawai menampilkan layar "Tugas sudah ditutup pemilik" dan menonaktifkan semua tombol kirim.
- **Stok gudang:** tidak diubah — pengurangan stok tetap dilakukan atomik di dalam `prep_submit` (sudah benar). Tidak ada double-deduct karena setiap submit menghasilkan baris `prep_submissions` baru dengan pengurangan satu kali.

### 3. Perlindungan konflik (Beri peringatan & blokir submit)
- `prep_submit` menerima parameter baru `_expected_updated_at timestamptz` (opsional).
- Sebelum mengurangi stok, RPC membandingkan dengan `prep_task_items.updated_at`. Jika item berubah setelah pegawai membuka layar → kembalikan `{ok:false, error:'item_changed', current_updated_at}`.
- Halaman pegawai menangkap error tersebut: foto **tidak** terkirim, muncul banner kuning "Item ini baru saja diubah admin. Silakan periksa kembali sebelum kirim." dan tombol "Muat ulang item" yang memuat versi terbaru.
- Saat ping realtime diterima dan item yang sedang dikerjakan pegawai (sudah memilih foto) berubah, banner yang sama muncul preemptive, jadi pegawai tahu sebelum klik kirim.

### 4. RLS / akses anon
- Tambah policy `realtime.messages` agar role `anon` boleh `SELECT` (subscribe) hanya untuk topic dengan prefix `prep:`. Tidak ada policy `INSERT` untuk anon → pegawai tidak bisa kirim ping palsu.
- Tidak menambah akses anon ke tabel `prep_*` (semua tetap lewat RPC SECURITY DEFINER + PIN).

## File yang disentuh

### Migration (SQL)
- Tambah kolom `prep_task_items.updated_at` + trigger `update_updated_at_column`.
- Buat fungsi `prep_broadcast_change()` + trigger AFTER INSERT/UPDATE/DELETE di `prep_tasks` dan `prep_task_items`.
- Ubah `prep_submit` agar menerima `_expected_updated_at` dan mengembalikan `item_changed` saat konflik (signature lama tetap kompatibel — parameter default NULL).
- Tambah policy `anon SELECT` pada `realtime.messages` untuk topic `prep:%`.

### Front-end
- `src/routes/t.$token.tsx`
  - Berlangganan channel broadcast `prep:<token>` setelah authed.
  - Pasang heartbeat 15 dtk + listener `visibilitychange`.
  - Tangani `bad_pin` setelah authed → kembali ke layar PIN.
  - Tangani `not_found` setelah authed → tampilkan layar "Tugas ditutup".
  - Saat ping menunjukkan item yang sedang diisi telah berubah → set state `staleItemIds` → banner peringatan di `ItemCard`.
  - Kirim `_expected_updated_at` saat submit, tangani `item_changed`.
- `src/routes/_authenticated.tugas.tsx`: tidak diubah (sudah realtime). Hanya pastikan setiap `update` item / `prep_reset_pin` / ubah status memicu broadcast lewat trigger baru.

## Tidak termasuk dalam ronde ini
- Tidak menyentuh alur stok gudang (tidak ada laporan inkonsistensi konkret) — biarkan trigger yang ada bekerja.
- Tidak mengubah fitur ecer/request submit via task (struktur sama, bisa diperluas terpisah jika perlu).
