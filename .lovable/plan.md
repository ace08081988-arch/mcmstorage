## Masalah

Di dashboard, kartu Ecer & Request punya tombol **WA** dan **Chat** yang hanya membagikan foto pegawai — tidak melewati dialog verifikasi pembayaran dan tidak menandai paket sebagai terkirim (`sold_at`). Akibatnya "kirim WA sukses tapi paket tetap di daftar aktif". Alur pembayaran yang benar hanya ada di halaman detail `/ecer` dan `/request` (via `SendEcerPrepsDialog` / `SendPrepToCustomerDialog`).

Tujuan: satu jalur "Kirim ke pembeli" yang selalu meminta metode bayar (Lunas / Hutang / Bayar sebagian), mencatat penjualan + piutang lewat RPC, memindahkan paket ke **Riwayat Terkirim**, baru kemudian membagikan foto ke WA.

## Perubahan

### 1. Angkat dialog jadi komponen bersama

Pindahkan dua dialog dari route file ke `src/components/`:

- `src/components/SendEcerPrepsDialog.tsx` — dipindah dari `_authenticated.ecer.tsx` beserta helper `resolvePhotoUrl` (yang dipakai untuk ambil foto ecer/prep bucket). Ekspor default + named.
- `src/components/SendPrepToCustomerDialog.tsx` — dipindah dari `_authenticated.request.tsx` beserta helper resolusi fotonya.

Kedua route lama tetap memakai dialog-nya lewat impor dari lokasi baru (tanpa perubahan perilaku pada halaman detail).

### 2. Dashboard Ecer (`src/components/ReadyEcerSection.tsx`)

- Hapus tombol **WA** dan **Chat** per-kartu (share kiriman pegawai) — semua alur kirim ke pembeli sekarang lewat verifikasi bayar. Tombol **Segarkan** & pratinjau foto pegawai tetap.
- Tambah satu tombol utama **"Kirim ke pembeli"** (hijau `#25D366`) per kartu, hanya aktif bila `prep_count > 0` untuk judul tersebut.
- Klik → fetch preps aktif untuk `r.id`:
  ```ts
  supabase.from("ecer_preparations")
    .select("*")
    .eq("title_id", r.id)
    .is("sold_at", null)
    .order("created_at");
  ```
  lalu fetch daftar `customers` (mirror `_authenticated.ecer.tsx`) → buka `SendEcerPrepsDialog` dengan semua preps aktif tersebut (owner masih bisa batal / adjust di dialog).
- Setelah `onSent`: panggil `onRefresh()` yang sudah ada + emit event badge supaya `prep_count` turun tanpa reload.
- Kartu yang `prep_count === 0`: tombol disabled, tooltip "Belum ada kotak siap".

### 3. Dashboard Request (`src/components/ReadyRequestSection.tsx`)

Perlakuan identik dengan Ecer:

- Hapus tombol WA/Chat share foto pegawai.
- Tambah tombol **"Kirim ke pembeli"** yang fetch preps aktif untuk request tersebut + customers, buka `SendPrepToCustomerDialog`.
- Refresh badge setelah `onSent`.

### 4. `wa-sent-history` (localStorage)

Karena tombol WA share foto pegawai dihapus dari dashboard, `markSent` di titik-titik itu ikut dihapus. Riwayat WA (localStorage-only) yang dulu diisi otomatis tidak lagi terisi dari dashboard. `useSentDetails` / `SentDetailList` di kartu tidak lagi ditampilkan.

Tidak ada migrasi data localStorage — entri lama tetap ada, tapi UI tidak lagi merujuknya di kartu dashboard.

### 5. Dokumen alur (opsional, ringkas)

Update baris tunggal di `docs/responsive-layout-rules.md` jika ada referensi tombol WA/Chat kartu dashboard. (Cek dulu; skip bila tidak ada.)

## File yang disentuh

- `src/components/SendEcerPrepsDialog.tsx` (baru)
- `src/components/SendPrepToCustomerDialog.tsx` (baru)
- `src/routes/_authenticated.ecer.tsx` (hapus definisi lokal + impor)
- `src/routes/_authenticated.request.tsx` (hapus definisi lokal + impor)
- `src/components/ReadyEcerSection.tsx` (ganti tombol WA/Chat → tombol "Kirim ke pembeli" + fetch preps + dialog)
- `src/components/ReadyRequestSection.tsx` (perlakuan identik)

## Detail teknis

- **Tipe preps**: `SendEcerPrepsDialog` menerima `EcerPreparation[]` dari `@/lib/ecer`. Import path sama.
- **Fetch customers**: gunakan pola yang sudah dipakai di `_authenticated.ecer.tsx` (`customers` table, `user_id = auth.uid()`).
- **Idempotency & realtime**: state `sending` di dialog sudah menangani double-click. Setelah RPC sukses dialog menutup + panggil `onSent` yang menyegarkan grid + emit `debtTx`. Realtime badge produk & piutang sudah subscribe ke event ini.
- **Backward compatibility**: halaman detail `/ecer` dan `/request` tetap berperilaku sama karena dialog hanya berpindah lokasi, bukan berubah kontrak.

## Verifikasi

1. Buka `/` → kartu Ecer dengan preps aktif → klik "Kirim ke pembeli" → dialog muncul → pilih Lunas → Kirim WA → toast sukses → kartu langsung reload → `prep_count` turun → paket masuk Riwayat Terkirim di `/ecer`.
2. Sama untuk Bayar sebagian: dialog terima nominal dibayar → RPC → piutang tercatat sebesar sisa → paket di Riwayat.
3. Kartu tanpa preps aktif: tombol disabled.
4. Halaman detail `/ecer` dan `/request` tetap berfungsi seperti sebelumnya (regression test manual: buka detail judul, klik share icon per kotak → dialog sama muncul).
5. `bun run typecheck` dan build tetap hijau.
