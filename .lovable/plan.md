## Tujuan
Ubah input **Nama judul** di dialog "Judul Request Baru / Edit Judul Request" (`src/routes/_authenticated.request.tsx`) supaya:
- Saat mengetik, muncul saran dari kontak Buku Alamat (`address_book`) yang cocok.
- Bisa pilih kontak yang ada → nama judul otomatis terisi.
- Bisa tetap mengetik nama baru manual (freeform) dan simpan seperti biasa — tidak wajib memilih dari daftar.

## Perubahan UI
File: `src/routes/_authenticated.request.tsx` (sekitar baris 500).

Ganti `<Input>` "Nama judul" dengan **combobox ringan** (input + dropdown saran) di bawahnya:

```
Nama judul
[ Bu Ani________________ ]   ← tetap input teks bebas
 ├─ 👤 Bu Ani           (kontak, WA 0812…)
 ├─ 👤 Bu Anita         (kontak)
 └─ ➕ Pakai "Bu Ani" sebagai nama baru
```

Perilaku:
- Debounce ~150 ms; filter case-insensitive `name.includes(query)` dari `fetchAddressBook()`.
- Batasi 6 saran teratas.
- Klik saran kontak → set `name` ke `row.name`.
- Klik "Pakai … sebagai nama baru" atau langsung tekan Simpan → simpan freeform (perilaku sekarang, tidak berubah).
- Dropdown tertutup saat input di-blur / Escape / setelah pilih.
- Jika belum ada kontak sama sekali, dropdown tidak muncul — input tetap berfungsi normal.

## Data
- Ambil kontak via `fetchAddressBook()` dari `src/lib/address-book.ts` (sudah ada), dibungkus `useQuery(["address_book"])` supaya cached lintas dialog.
- Tidak menulis apa pun ke `address_book` dari dialog ini — memilih kontak hanya menyalin `name` ke field judul. Menambah kontak baru tetap dilakukan di halaman `/buku-alamat` seperti biasa (menjaga scope UI-only).

## Batasan / non-goal
- Tidak mengubah skema DB, tidak menambah foreign key `titles → address_book`.
- Tidak menyentuh alur POS Kasir, chat, atau tempat lain — hanya dialog Judul Request.
- Tidak mengubah tombol "Chat" / share flow.

## Detail teknis
- Komponen combobox dibuat inline (tanpa shadcn `Command` baru) supaya patch kecil: `useState` untuk `open`, `useMemo` filter, list `<button>` di dalam `<div className="relative">` di bawah input. Sudah konsisten dengan gaya file ini yang banyak memakai Tailwind langsung.
- Aksesibilitas: `role="listbox"` + `aria-activedescendant`, panah atas/bawah + Enter untuk pilih, Esc tutup.
- Aman untuk edit mode (`existing`): nilai awal `name` dipertahankan; combobox hanya membuka dropdown saat user mengetik.
