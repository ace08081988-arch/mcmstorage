# Fix Tugas Penyiapan Barang — mobile 411px

Publish tetap ditahan sampai smoke test ulang lulus. Tidak menyentuh DB/RLS/RPC/migration/permission model. Perubahan UI + guard runtime kecil di file yang sudah ada.

## Diagnosis singkat (bukti lokasi kode)

- **App Lock muncul setelah Galeri/Kamera** — dua sumber:
  1. `src/routes/_authenticated.tsx` (baris ~72–79): handler `visibilitychange` panggil `lockNow()` saat `document.visibilityState==="hidden"` bila `cfg.lockOnHide` aktif. Native picker Android memang bikin WebView "hidden" → app lock nyala waktu user kembali. Ini kena halaman `/tugas` (Siapkan Sendiri).
  2. `src/routes/t.$token.tsx` (baris 310–370, 749–794): sesi PIN pegawai berbasis TTL. Waktu WebView di-recreate setelah picker native, sudah ada persistensi via `sessionStorage`, tapi bila TTL habis atau sessionStorage dibersihkan OEM, layar PIN kembali muncul. Butuh grace period saat picker terbuka.
- **"Belum ada item tugas" tampil bersama Permintaan Paket** — `t.$token.tsx` baris 2110–2144 render empty-state tanpa memeriksa apakah `RequestSection` (baris 2168) punya paket aktif.
- **Kemajuan 0/0** — `t.$token.tsx` baris 1593–1595, 1749–1780: dihitung hanya dari `items.length` (tugas satuan). Waktu `totalItems===0` tetap render "0 / 0".
- **Aksi kirim paket kurang jelas di mobile** — `ReadyPackagesPanel.tsx` baris 876–929: tombol "Simpan paket" ada di dasar form panjang, tidak sticky.
- **Unit copy** — sudah ada `humanBaseUnit()` sebagai SSOT setelah Batch A-2. Perlu sweep di `t.$token.tsx` dan `RequestSection` untuk memastikan tidak ada string "gr" / "botol" hardcoded.

## Perubahan yang dilakukan

### 1. `src/lib/app-lock.ts` — API suppress picker
- Tambah export baru:
  - `SUPPRESS_LOCK_EVENT`
  - `beginNativePicker(reasonMs=90_000)` — set flag `app-lock:suppress-until = now + reasonMs` di `localStorage`.
  - `endNativePicker()` — hapus flag.
  - `isLockSuppressed()` — baca flag, cek belum expired.
- Tidak ubah struktur `LockConfig`, tidak ubah biometric API.

### 2. `src/routes/_authenticated.tsx` — hormati suppress flag
Di handler `onVis` dan `resetIdle` cek `isLockSuppressed()`. Jika true, jangan panggil `lockNow()`. Guard 90 detik cukup untuk siklus buka picker → pilih foto → kembali; tetap kunci kalau user beneran keluar app lama.

### 3. `src/routes/t.$token.tsx`
- **Empty-state cerdas.** Ganti render tunggal empty-state jadi:
  - Jika `totalItems===0` dan `RequestSection` melaporkan `packagesCount>0` → sembunyikan panel besar; ganti dengan strip tipis: "Tidak ada tugas satuan — lanjutkan lewat Permintaan Paket di bawah."
  - Jika `totalItems===0` dan tidak ada paket → tampilkan copy sekarang.
  - Sinyal `packagesCount` di-lift dari `RequestSection` via prop `onCountsChange({ pending, total })`.
- **Progres.** `Kemajuan {done}/{total}` hanya render bila `totalItems>0`. Bila 0 tapi ada paket, ganti label jadi "Paket aktif: N".
- **Grace period picker.** Sebelum `input.click()` di setiap tombol Kamera/Galeri (baris ~2877, ~4083 dan handler `openNativeCamera`/`openNativeGallery` di 2349/2373/3759/3783), panggil `beginNativePicker()`; pada handler `onChange` selesai atau `abort` panggil `endNativePicker()`. Bump `writeSession(pin)` (baris 352) supaya TTL restart.
- **Unit copy.** Sweep string di label item tugas & paket: pakai `humanBaseUnit(package_type, base_unit)` yang sudah ada. Standarkan `gram` → `g` untuk konsistensi input suffix. `botol` tetap.
- **Tombol yang diaudit.**
  - "Sinkronkan ulang sekarang" (baris ~1798) → tetap, kecilkan ke ikon-only di ≤414px.
  - "Tutup" pada card paket → tetap.
  - "Kirim Paket" (baris 4278) → dipindah ke sticky bottom bar bila `openId` aktif.

### 4. `src/components/RequestSection.tsx` (dipanggil dari `t.$token.tsx`)
- Terima prop `onCountsChange?`. Emit `{ total, pending }` tiap kali daftar paket berubah.
- Sticky action bar mobile: saat sebuah paket sedang dibuka (`activePackageId`), render `<div class="sticky bottom-0 ...">` berisi tombol utama "Kirim Paket" (disabled bila qty invalid / foto kosong, dengan alasan mikro "Butuh foto bukti" atau "Isi jumlah dulu"). Preview foto & tombol Kamera/Galeri tetap di dalam card.

### 5. `src/components/SiapkanSendiriSection.tsx`
- Bungkus `input[type=file]` (baris 584): pasang `onClick={()=>beginNativePicker()}` + `onChange` yang panggil `endNativePicker()` setelah baca file (atau timeout 90s).

## Yang TIDAK dilakukan (tanpa approval)

- Tidak refactor `RequestSection` atau `ReadyPackagesPanel` besar-besaran.
- Tidak ubah TTL PIN worker portal (tetap `cfg.sessionTtlMs`).
- Tidak sentuh RPC `prep_peek_task`, `submissions`, atau DB.
- Tidak hapus tombol yang ada — hanya reposisi/hide berdasarkan state.

## Verifikasi

1. `bunx tsgo --noEmit` harus hijau.
2. `bun run build` harus hijau.
3. Smoke test mobile 411px & 390px:
   - Buka `/tugas` → klik Galeri di Siapkan Sendiri → pilih foto → kembali → **tidak** minta PIN app-lock.
   - Buka worker portal via link → PIN → buka paket PCG → klik Galeri → pilih foto → kembali → **tidak** minta PIN worker portal ulang.
   - Buat link tugas tanpa item tapi dengan paket → buka → **tidak** ada empty state besar "Belum ada item tugas"; hanya strip tipis + paket.
   - Item PASIR menampilkan `g`, GS menampilkan `botol`, tidak ada campuran `gr` / `botol` di item gram.
   - Kirim paket → tombol jelas terlihat di sticky bar, disabled saat syarat kurang, aktif setelah foto+qty valid.

## Laporan akhir (setelah implementasi)

Format tetap: penyebab, file berubah, copy yang diganti, tombol yang direposisi, hasil typecheck, hasil build, risiko regresi, konfirmasi Publish ditahan.

Konfirmasi lanjut?
