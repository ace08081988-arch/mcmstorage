## Tujuan

Hilangkan duplikasi antara section "Produk Eceran Siap Kirim" di Beranda dan halaman `/ecer`. Semua fungsi (pilih produk, daftar judul, kotak penyiapan, detail, edit, hapus, foto + lokasi + berat aktual, share WA) dipindah ke Beranda sebagai satu section penuh "Penyiapan Ecer".

## Perubahan

1. **Ekstrak halaman `/ecer` jadi komponen.**
   - File baru `src/components/EcerSection.tsx` berisi seluruh isi `EcerPage` saat ini (list view + detail view + dialog buat judul / produk baru / edit).
   - Komponen menerima search-state dari `useSearch`-nya sendiri sehingga tetap mendukung deep-link parameter `item`, `title`, `highlight`, `edit`.

2. **Beranda (`src/routes/_authenticated.index.tsx`).**
   - Tambahkan `validateSearch` agar Beranda mengenal param `item`, `title`, `highlight`, `edit` (dipakai oleh deep link lama).
   - Hapus tile menu "Penyiapan Ecer" pada grid menu cepat (tidak perlu lagi karena section-nya ada di halaman ini).
   - Ganti `<ReadyEcerSection />` dengan `<EcerSection />` lengkap dengan judul "Penyiapan Ecer" dan deskripsi singkat.
   - Tambahkan anchor `id="ecer"` agar link `/#ecer` dari sidebar/audit langsung scroll ke section ini.

3. **Hapus halaman `/ecer`.**
   - File `src/routes/_authenticated.ecer.tsx` diganti jadi redirect: `beforeLoad` melempar `redirect({ to: "/", search: { item, title, highlight, edit }, hash: "ecer", replace: true })` agar bookmark/notifikasi lama otomatis pindah ke Beranda + scroll.

4. **Komponen `ReadyEcerSection` dihapus** (tidak dipakai lagi) — file `src/components/ReadyEcerSection.tsx` dihapus, import-nya di Beranda dilepas.

5. **Update tautan internal.**
   - `src/components/AppSidebar.tsx`: item "Penyiapan Ecer" diarahkan ke `/` dengan `hash: "ecer"`.
   - `src/routes/_authenticated.audit.tsx`: entry "Penyiapan Ecer" jadi `to: "/", hash: "ecer"`.
   - Di dalam `EcerSection`, semua `router.navigate({ to: "/ecer", search: {...} })` diganti `to: "/"` dengan `hash: "ecer"` agar URL tetap di Beranda.

## Catatan teknis

- TanStack Router: `redirect({ to, search, hash, replace })` di `beforeLoad` adalah cara aman menjaga deep-link lama tanpa membuat user melihat halaman kosong sebelum dialihkan.
- `validateSearch` di Beranda harus menerima keempat param sebagai opsional string supaya halaman tetap valid tanpa parameter.
- Tidak ada perubahan skema database / RLS / server function — murni reorganisasi UI front-end.

## Yang TIDAK berubah

- Logika upload foto, perhitungan stok, share WhatsApp, konfirmasi hapus, retry WA — semua tetap sama, hanya dipindah container-nya.
- Permission, RLS, dan tabel `ecer_titles` / `ecer_preparations` tidak disentuh.
