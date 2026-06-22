## Tujuan
Sederhanakan alur penyiapan produk: hapus total menu **Manajemen Pegawai** (beserta data pegawai existing) dan ganti dengan dua mode yang dipilih langsung dari halaman **Penyiapan Produk**:

1. **Siapkan Sendiri** — owner foto + paste link lokasi → simpan → masuk daftar "Siap Dikirim" → tombol **Kirim WA** memindahkan ke **Riwayat Terkirim**.
2. **Via Pegawai** — pilih kontak pegawai sederhana (nama + nomor WA) → owner isi item yang harus disiapkan → kirim link tugas + PIN via WA atau salin.

---

## Ringkasan Perubahan

### A. Hapus Manajemen Pegawai
- Hapus route `src/routes/_authenticated.manajemen-pegawai.tsx`.
- Hapus item menu "Manajemen Pegawai" dari `src/components/AppSidebar.tsx`.
- Drop tabel `public.employees` (saat ini 1 baris — akan hilang).
- Bersihkan referensi `employees` di `audit`, `index`, `gudang`, dan tipe Supabase (regen otomatis via migration).
- `link-pegawai.tsx` tetap dipertahankan sebagai halaman tugas (sudah pakai `prep_tasks`, tidak butuh tabel employees).

### B. Tabel baru: kontak pegawai ringan
- `public.staff_contacts` — `id`, `user_id`, `name`, `wa_phone`, `created_at`. RLS per-owner + GRANT lengkap.

### C. Tabel baru: hasil "Siapkan Sendiri"
- `public.self_prep_items` — `id`, `user_id`, `title`, `photo_path` (storage), `location_url`, `note`, `status` ('ready' | 'sent'), `sent_at`, `wa_target`, `created_at`.
- Reuse bucket `prep-photos` untuk foto.
- RLS per-owner + GRANT lengkap.

### D. Halaman Penyiapan Produk baru
Lokasi: refactor `src/routes/_authenticated.tugas.tsx` (atau buat ulang sebagai entry "Penyiapan Produk") menjadi 2 tab/section:

**Tab 1 — Siapkan Sendiri**
- Form: input judul, upload foto (galeri/kamera HP via `<input type="file" accept="image/*">`), input link lokasi (paste), catatan, tombol **Simpan**.
- List "Siap Dikirim" (status='ready'): kartu dengan thumbnail, judul, link lokasi (clickable), tombol **Kirim WA** (buka `https://wa.me/?text=...`), tombol hapus.
- Saat **Kirim WA** ditekan: update status → 'sent', isi `sent_at`, item pindah ke section "Riwayat Terkirim".
- Section "Riwayat Terkirim" (status='sent'): list ringkas, tombol hapus.

**Tab 2 — Via Pegawai**
- Daftar kontak pegawai sederhana (CRUD inline: tambah nama+WA, edit, hapus) — pakai `staff_contacts`.
- Tombol "Buat tugas baru" → form: judul tugas, daftar item (nama, qty, satuan, catatan opsional) — ini reuse RPC `prep_create_task` yang sudah ada (membuat `prep_tasks` + `prep_task_items` + PIN + share_token).
- Setelah dibuat: tampil kartu tugas dengan link `publicTaskUrl(token, pin)` + PIN, tombol **Kirim via WA** (ke nomor pegawai terpilih) dan **Salin**.

### E. Routing
- Sidebar: ganti item "Manajemen Pegawai" → tidak ada lagi. "Penyiapan Produk" tetap arah ke `/tugas`.
- `/link-pegawai` tetap dapat diakses owner sebagai daftar tugas aktif (atau di-embed dalam tab "Via Pegawai"). Untuk MVP biarkan apa adanya.

---

## Implementasi (urutan)

1. **Migration** (1 migration):
   - `DROP TABLE public.employees CASCADE;`
   - `CREATE TABLE public.staff_contacts (...)` + GRANT + RLS + policy `auth.uid()=user_id`.
   - `CREATE TABLE public.self_prep_items (...)` + GRANT + RLS + policy `auth.uid()=user_id`.

2. **Hapus & bersihkan**:
   - Hapus `src/routes/_authenticated.manajemen-pegawai.tsx`.
   - Edit `AppSidebar.tsx` (hapus 1 item).
   - Audit `src/routes/_authenticated.audit.tsx`, `_authenticated.index.tsx`, `_authenticated.gudang.tsx`: hapus query/section yang baca `employees`.

3. **Komponen baru**:
   - `src/components/SiapkanSendiriSection.tsx` — form + list ready + list sent.
   - `src/components/ViaPegawaiSection.tsx` — CRUD kontak + bridge ke `prep_create_task`.
   - Refactor `_authenticated.tugas.tsx` menjadi shell 2-tab yang merangkai dua section di atas.

4. **WA helper**: pakai `src/lib/share-wa.ts` yang sudah ada (`waUrl(phone, text)`); fallback ke `https://wa.me/?text=` jika nomor kosong.

5. **Verifikasi**:
   - Build check otomatis.
   - Buka `/tugas` via Playwright untuk memastikan tab tampil & form bisa dikirim.

---

## Catatan Teknis
- Data 1 baris di `employees` akan hilang (sesuai persetujuan "hapus total").
- Tugas existing di `prep_tasks` (3 baris, 39 item) tidak terdampak — RPC dan halaman pegawai (`/t/:token`) tetap berjalan.
- Tidak menyentuh `auth`, `storage`, atau bucket existing — hanya menambah row di `prep-photos`.
- Validasi link lokasi: `https://` only, ≤2048 char (konsisten dengan validasi prep_submit yang sudah ada).
