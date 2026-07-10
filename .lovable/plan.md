## Konteks

Halaman Beranda menampilkan dua panel utama:
- `ReadyEcerSection` (2571 LOC) — kartu ecer siap-kirim, tab Aktif/Riwayat terkirim, bulk select, view/layout toggle, chat share, WA share. Ini sumber utama keluhan.
- `ReadyRequestSection` — daftar judul request + badge `N paket`. Tidak punya tab Riwayat / bulk select / view toggle.

Sebelum mulai edit 2500+ baris kritikal, saya butuh konfirmasi arah keputusan berikut (semua di sisi UI/UX; tidak ada perubahan DB/RLS/RPC/business logic).

## Root cause "Riwayat terkirim tampak tidak jelas"

1. Kartu ecer (`EcerCard`) me-render **layout dan tombol yang berbeda** untuk `view="sent"` vs `view="active"` — bukan card yang konsisten. Contoh: `view==="sent"` menyembunyikan sebagian info produk dan menampilkan cap "Terkirim / Sukses / Tersinkron" yang mendominasi.
2. Beberapa aksi masih di-render di card meski tidak relevan untuk tab Riwayat (tombol "Kirim" mestinya hilang, "Aktif"/undo kadang muncul).
3. `BulkToolbar` selalu muncul begitu ada kartu — termasuk di mobile — dengan tombol "Pilih beberapa" walau tidak ada bulk-op yang jelas untuk operator harian di 411px.
4. `LayoutModeToggle` (grid/list/table icons di bawah) selalu tampil di mobile meski daily user hanya butuh 1 layout list.

## Rencana Perubahan (UI/UX only)

### A. Card Riwayat Terkirim = Card Aktif + Overlay Status
- Buang cabang layout khusus `view==="sent"` di `EcerCard`. Render struktur inti yang **sama** (nama produk, foto/thumbnail, GPS, jumlah foto, detail kiriman) di kedua tab.
- Overlay tipis (badge "Terkirim · <waktu relatif>") di kanan-atas card, tidak menghabiskan space.
- Sisipkan **satu row aksi** yang berbeda kondisional:
  - Tab **Aktif**: `Pratinjau` · `Kirim WA` · `Kirim Chat` · menu tiga titik (lihat B).
  - Tab **Riwayat**: `Preview foto` · `Buka Maps` (jika ada GPS) · menu tiga titik (lihat B).
- Tombol `Kirim ke pembeli` / `Kirim` / `Kirim ulang` **tidak muncul** di tab Riwayat. `Kirim ulang` tetap ada tapi hanya di menu tiga titik (per-card) untuk kasus kiriman gagal.

### B. Konsolidasi ke Menu Tiga Titik (per card)
Sekarang tombol tersebar. Rencana:
- Tab **Aktif** ⋯: `Pratinjau`, `Buka Maps` (jika ada), `Refresh sinkron`, `Tandai terkirim (skip)`, `Kirim ulang WA/Chat` (hidden kalau belum pernah dikirim).
- Tab **Riwayat** ⋯: `Preview foto`, `Buka Maps` (jika ada), `Kirim ulang WA/Chat`, `Kembalikan ke Aktif` (undo), `Hapus dari Riwayat` (dengan konfirmasi — sudah ada mekanisme hide lokal via `wa-sent-history`).

Semua item menu yang no-op untuk konteks saat ini disembunyikan, bukan disable, agar mobile tidak penuh.

### C. Bersihkan No-op / Redundant Buttons (mobile)
| Tombol | Keputusan |
|---|---|
| `Pilih beberapa` (BulkToolbar) | **Sembunyikan di mobile** (`< sm`). Tetap tampil di desktop dengan aksi bulk WA/Chat/Delete existing. |
| Layout toggle grid/list/table di ReadyEcer | **Sembunyikan di mobile**. Mobile force `list` layout. Tetap tampil di desktop. |
| Layout toggle di ReadyRequestSection | Idem — hidden < sm. |
| Tombol `Kirim` pada card di tab Riwayat | **Hapus** (sudah salah konteks). |
| Tombol `Aktif`/undo yang muncul inline | Pindahkan ke menu tiga titik sebagai `Kembalikan ke Aktif`. |
| Tombol `Kelola →` di ReadyRequestSection | **Tetap** (fungsional, ke `/request`). |
| Thumbnail "6 foto" | Konfirmasi handler ada (buka preview) — jika no-op akan diberi handler yang membuka dialog preview foto yang sudah ada. |

### D. Konsistensi Layout Mobile
- Grid ecer di mobile jadi 1 kolom full-width (sudah kebanyakan begitu tapi ada state grid yang membuat sempit) — pastikan `grid-cols-1` di `< sm`.
- Card padding & typography sama untuk kedua tab.
- Tidak ada horizontal overflow: `min-w-0` + `truncate` pada semua row.

### E. Aksi Destructive
- `Hapus dari Riwayat` — sudah pakai `AlertDialog` konfirmasi + hide lokal via `wa-sent-history`. **Tidak** hard-delete. Copy diperjelas: "Sembunyikan dari Riwayat".
- `Kembalikan ke Aktif` — pakai handler `ecer-bulk:undo:<id>` yang sudah ada; tidak destructive.

## File yang Akan Diubah

- `src/components/ReadyEcerSection.tsx` — refactor lokal (bukan rewrite) pada:
  - `BulkToolbar` — sembunyikan di mobile (`hidden sm:flex`).
  - Wrapper `LayoutModeToggle` — `hidden sm:inline-flex`.
  - `EcerCard` — hapus branching layout `view==="sent"`, satukan struktur, sisipkan menu tiga titik konsolidasi (komponen baru `EcerCardMenu` inline).
  - Hapus tombol inline `Kirim` di tab Riwayat.
- `src/components/ReadyRequestSection.tsx` — sembunyikan `LayoutModeToggle` di mobile.
- Jika perlu, tambahkan komponen kecil `<EcerCardMenu />` di file yang sama (bukan refactor besar keluar file).

**Tidak** disentuh: DB migration, RLS, `sales`/`request_preparations`/`wa_sent_history` schema, event bus `ecer-bulk:*`, handler `handleRefresh`, alur `send WA/Chat`, verifikasi bayar, permission.

## Verifikasi

1. `bunx tsgo --noEmit` hijau.
2. Build via harness.
3. Manual (411px & 390px, screenshot pakai Playwright headless):
   - Buka `/` → tab Aktif → kartu tampil, aksi Kirim WA/Chat visible.
   - Switch ke Riwayat terkirim → layout kartu sama, badge "Terkirim" di kanan atas, tidak ada tombol "Kirim".
   - Menu tiga titik pada kartu Riwayat → Preview, Maps, Kirim ulang, Kembalikan ke Aktif, Sembunyikan.
   - `Pilih beberapa` & layout toggle tidak muncul di mobile.
   - Desktop (≥ sm) tidak berubah signifikan.

## Yang Tetap Ditahan

Publish tetap ditahan sampai user smoke test ulang 411px/390px dan menyatakan lulus.

## Persetujuan yang Saya Butuhkan

1. **Setujui daftar tombol yang disembunyikan/dipindahkan** di tabel bagian C.
2. **Konfirmasi**: `Pilih beberapa` & layout toggle boleh hilang di mobile, tetap ada di desktop. (Alternatif: hapus total dari kedua ukuran.)
3. **Konfirmasi**: mobile card Riwayat tetap punya `Kirim ulang` di menu tiga titik (untuk retry kiriman gagal), atau hilangkan sama sekali karena bulk sudah tersedia di desktop.

Setelah OK, saya eksekusi langsung — perkiraan 1 giliran, semua di frontend.