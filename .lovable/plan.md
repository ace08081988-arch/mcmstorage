
## Audit Navigasi MCM Storage — Rencana Refactor Sidebar

Tujuan: sidebar `AppSidebar.tsx` (satu-satunya nav app) disusun ulang mengikuti alur kerja
**Dashboard → Gudang → Request Order → Penyiapan Ecer → POS/Kasir → Tugas Pegawai → Chat → Pembayaran → Riwayat → Pengaturan**, tanpa menghapus rute/fitur yang masih dipakai.

### 1. Temuan (inventaris singkat)

Sidebar sekarang punya 6 grup (Utama, Operasional, Komunikasi, Keuangan, Akun, Sistem) dengan 24 item. Beberapa yang tumpang tindih / meragukan:

| Item | Status | Catatan |
|---|---|---|
| Beranda `/` + Dasbor `/dashboard` | overlap ringan | `/` = home ber-lock/quick action, `/dashboard` = ringkasan bisnis. **Pertahankan keduanya**, tapi Dasbor jadi item #1 dan Beranda dipindah ke footer/profile |
| POS Kasir + Ringkasan POS | wajar dipisah, tapi 2 baris top-level bikin sidebar bising | Gabung sebagai satu item "POS Kasir" — halaman `/pos-kasir` sudah punya tab Ringkasan internal (verifikasi dulu; jika belum, tambahkan sub-item saja) |
| Penyiapan Produk `/tugas` + Daftar Tugas `/tugas-daftar` + Buat Tugas Manual `/tugas-baru` | 3 entri untuk 1 modul | Jadikan **satu** item "Tugas Pegawai" → `/tugas`; `/tugas-baru` dan `/tugas-daftar` tetap ada sebagai rute (dipanggil dari dalam halaman), tidak di sidebar |
| Pratinjau Label `/label-preview` | dev-utility | Pindah ke grup Sistem (bukan alur kerja harian) |
| Audit Rute `/audit` + Diagnostik `/diagnostics` + Chat-audit `/chat-audit` | overlap developer tools | Pertahankan semua rutenya, tapi cukup 1 entri "Diagnostik" di sidebar; sisanya diakses dari halaman itu |
| Notifikasi `/notifikasi` + Status Notifikasi `/status-notifikasi` + Pembaruan `/pembaruan` + Fitur `/fitur` | 4 halaman informasional | Tetap ada sebagai rute (link dari profil/notif dropdown), tapi hanya "Notifikasi" yang layak di sidebar |
| Catatan / Balas Cepat / Buku Alamat | pendukung Chat | Tetap, tapi dikelompokkan di bawah header "Chat & Komunikasi" |
| Hutang & Piutang | tunggal | Rename group jadi "Pembayaran & Keuangan" biar konsisten dengan permintaan |
| Log Penolakan Admin, OAuth Google, Rilis APK, Antrian Email | admin-only | Sudah difilter `filterSidebarItemsForAdmin` — dipertahankan di grup "Sistem" |

**Tidak ada rute yang dihapus** di slice ini. Yang berubah hanyalah *visibility* di sidebar. Semua halaman tetap bisa dibuka via URL / link dalam-halaman → dependensi aman.

### 2. Struktur sidebar baru

```text
UTAMA
  • Dasbor              /dashboard        LayoutDashboard
OPERASIONAL
  • Gudang & Supplier   /gudang           Package
  • Request Order       /request          PackagePlus
  • Penyiapan Ecer      /ecer             Scale
  • POS Kasir           /pos-kasir        Calculator
  • Tugas Pegawai       /tugas            ClipboardList
KOMUNIKASI
  • Chat                /chat             MessageCircle          (badge unread)
  • Catatan             /catatan          NotebookPen
  • Balas Cepat         /balas-cepat      MessageSquarePlus
  • Buku Alamat         /buku-alamat      ContactRound
  • Notifikasi          /notifikasi       BellRing
KEUANGAN
  • Hutang & Piutang    /hutang-piutang   Wallet
RIWAYAT & AUDIT
  • Audit Rute          /audit            ClipboardCheck
  • Diagnostik          /diagnostics      Activity
AKUN
  • Beranda             /                 Home                   (turun dari Utama)
  • Profil Akun         /profil           User
  • Pengaturan Kunci    /pengaturan-kunci Lock
  • Sesi & Perangkat    /sesi             MonitorSmartphone
SISTEM (admin-only, tak berubah)
  • Antrian Email, Rilis APK, Log Penolakan Admin, OAuth Google, Pratinjau Label
```

Grup baru "Riwayat & Audit" memenuhi slot "Riwayat" pada alur yang diminta; halaman
Riwayat transaksi sendiri hidup di dalam masing-masing modul (Ecer/Request/Chat arsip)
sesuai desain Slice A–D chat.

### 3. Polish visual (tanpa breaking changes)

- Label grup dipersingkat & huruf kecil kapital (`text-[10.5px] uppercase tracking-widest`).
- Ikon diseragamkan ukuran `h-4 w-4`, spacing item `gap-2.5`.
- Item aktif: strip aksen kiri `bg-primary/10 border-l-2 border-primary`.
- Badge unread di Chat dipertahankan.
- Sync pill di footer tetap.

### 4. Rekomendasi (tidak dieksekusi — perlu keputusan user)

Kandidat *hapus di masa depan* setelah verifikasi lebih lanjut:

1. `/fitur` — halaman "MCM Chat features" lama, mungkin tak relevan lagi untuk build MCM Storage.
2. `/pembaruan` — changelog manual; bisa digantikan halaman rilis notes.
3. `/status-notifikasi` — subset dari `/notifikasi`.
4. `/pengaturan-scroll-guard` + `/pengaturan-penyimpanan` + `/pengaturan-aksesibilitas` + `/pengaturan-tampilan` + `/pengaturan-privasi` — sebaiknya digabung ke satu halaman `/pengaturan` bertab. (Tidak dilakukan sekarang.)
5. `/chat-audit` — duplikasi konten `/audit`; kandidat dihapus setelah dicek referensinya.

Saya *tidak* akan mengubah/menghapus rute ini pada slice ini — hanya mencatat untuk audit lanjutan.

### 5. Ruang lingkup implementasi

File yang disentuh: **hanya** `src/components/AppSidebar.tsx` (susun ulang array `groups`, mungkin tambah 1–2 utilitas kecil di file yang sama). Tidak ada perubahan pada:
- rute `src/routes/**`
- schema database / migrasi
- auth, RLS, permissions
- logika bisnis modul

### Verifikasi

- `tsgo` typecheck.
- Manual: buka `/`, `/dashboard`, `/gudang`, `/pos-kasir`, `/chat` — pastikan sidebar tetap navigasi ke rute yang benar & badge unread muncul.
- E2E `sidebar-highlight` + `sidebar-scroll-guard` tetap harus lewat (tidak menyentuh mekanisme highlight/guard).

Setelah plan disetujui, saya kerjakan langsung dalam satu edit ke `AppSidebar.tsx`.
