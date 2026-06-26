# Samakan Semua Penyiapan dengan Pola "Siapkan Sendiri"

Tujuan: tiga alur penyiapan (Request, Ecer manual, Tugas pegawai) bisa pilih banyak foto, dan tombol Kirim WA otomatis melampirkan **semua foto** + link lokasi — sama persis dengan tab Siapkan Sendiri di /tugas.

## 1. Database (1 migration)

Tambah kolom `photo_paths text[]` (nullable, default '{}') ke:

- `public.request_preparations`  — untuk multi-foto penyiapan request.
- `public.prep_submissions`       — untuk multi-foto kiriman pegawai.

Backfill: `photo_paths = ARRAY[photo_path]` jika `photo_path` ada dan `photo_paths` kosong.
GRANT/RLS tidak berubah (kolom baru ikut policy kolom existing).

## 2. /request — PrepEditorDialog & PrepCard

`src/routes/_authenticated.request.tsx`

- **PrepEditorDialog** (form penyiapan baru):
  - Ganti single-file input + image editor jadi multi-file picker (kamera HP + galeri + multi-select), pola sama dengan `SiapkanSendiriSection`.
  - Preview grid + tombol "Hapus" per foto + "Hapus semua".
  - Upload semua foto ke bucket `request-photos` (path: `{uid}/{title_id}/{ts}-{i}.{ext}`); rollback jika salah satu gagal.
  - Simpan `photo_paths` (array) + `photo_path` = foto pertama (kompat).
- **PrepCard** (kartu paket tersimpan):
  - Tampilkan strip thumbnail semua foto + lightbox tap untuk perbesar.
  - `sendWA`: fetch semua signed URL → `File[]` → `shareToWhatsApp({ text, files, url: location_url })` (location ikut sebagai URL share + tetap di teks).
- **Title-level "Kirim WA"** (kartu judul): tetap text-only (ringkasan); tidak ada foto di level judul.

## 3. /ecer — entri manual

`src/routes/_authenticated.ecer.tsx`

- Verifikasi entri manual (sudah multi-foto sejak update sebelumnya) menggunakan pola yang sama: input multi + Kirim WA melampirkan semua foto. Selaraskan UI (label, tombol "Hapus semua") agar identik dengan SiapkanSendiri.
- Pastikan tombol "Kirim WA" pada kartu kiriman pegawai juga membaca `photo_paths` (lihat §4) dan melampirkannya.

## 4. /t/$token — submit pegawai

`src/routes/t.$token.tsx`

- Form upload pegawai: izinkan multi-file (kamera + galeri), preview + hapus per foto.
- Upload semua foto ke bucket `prep-photos`; insert `prep_submissions` dengan `photo_path` (foto utama) + `photo_paths` (semua).
- UX dan teks tombol disamakan dengan SiapkanSendiri.

## 5. Konsumen kiriman pegawai (Beranda)

`src/components/ReadyEcerSection.tsx` (dan `RecentSubmissionsSection` jika masih dipakai)

- Saat menggabungkan submission, baca `photo_paths` (fallback ke `photo_path`).
- Pre-sign semua path, tampilkan strip foto kecil di kartu.
- `Kirim WA` per kiriman: lampirkan semua foto + sertakan `location_url`.

## 6. Verifikasi

- `tsgo --noEmit` hijau.
- Smoke via Playwright headless:
  - `/request` → buat penyiapan multi-foto → kartu menampilkan thumbnail → Kirim WA → preview Web Share dipanggil dengan ≥2 file.
  - `/t/{token}` (preview sandbox) → upload 2 foto → submit OK.
  - Beranda → kartu pegawai menampilkan multi-foto + Kirim WA berisi foto.

## Detail teknis

- Storage buckets:
  - `request-photos` (existing) — tetap; tambahkan path bersarang per-title.
  - `prep-photos` (existing) — tetap.
  - `self-prep-photos` — tidak berubah.
- Util baru di `src/lib/share-wa.ts`: tidak ada (pakai API existing `shareToWhatsApp({ files, text, url })`).
- Format pesan WA standar:
  ```
  *<Nama paket>*
  Isi:
  • <produk> <qty><unit>
  
  Catatan: <opsional>
  Lokasi: <url>
  ```
- `shareToWhatsApp` sudah otomatis pakai Web Share API saat ada files (multi-attach), dan fallback ke wa.me text-only saat tidak didukung.

## Migration ringkas

```sql
alter table public.request_preparations
  add column if not exists photo_paths text[] not null default '{}';

update public.request_preparations
  set photo_paths = array[photo_path]
  where photo_path is not null and coalesce(array_length(photo_paths,1),0) = 0;

alter table public.prep_submissions
  add column if not exists photo_paths text[] not null default '{}';

update public.prep_submissions
  set photo_paths = array[photo_path]
  where photo_path is not null and coalesce(array_length(photo_paths,1),0) = 0;
```

## Tidak diubah

- Tab "Via Pegawai" (manajemen tugas) — flow create/edit tugas tidak butuh foto.
- Tombol Kirim WA di level ringkasan/laporan tetap text-only.
- Skema RLS/grants — tidak berubah, hanya tambah kolom.
