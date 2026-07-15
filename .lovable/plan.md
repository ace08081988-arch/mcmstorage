Kerjakan bertahap, per slice minta approval sebelum lanjut. Fokus hasil: cepat dimuat, konsisten di 390/411, logika tanpa jebakan overwrite/race.

## Slice 1 — Performa fondasi (quick wins, low risk)
1. Audit bundle: jalankan `vite build` dan lihat chunk terbesar (rute + vendor).
2. `src/routes/__root.tsx` — pastikan `<BuildVersionBadge />` dan komponen non-kritis lain **tidak** dieksekusi saat SSR bila menyentuh `window`. Bungkus dengan lazy import + `<Suspense>` sehingga tidak masuk critical bundle.
3. Route berat (`_authenticated.index.tsx` 2285 baris, `_authenticated.gudang.tsx`, `chat.$conversationId.tsx`) — jangan `export` fungsi komponen dari file rute (memblok automatic code splitting TanStack). Perbaiki yang menyimpang.
4. Angkat dialog/dropdown besar (ProductEditDrawer, PhotoEditor, PickChatConversationDialog, QrScanner) jadi `React.lazy` + `<Suspense fallback={null}>` — hanya di-load saat dibuka.
5. QueryClient defaults: naikkan `staleTime` default ke 30 dtk untuk daftar berat, matikan `refetchOnWindowFocus` global (opt-in per query). Kurangi jumlah refetch saat balik ke tab.
6. Ganti listener realtime yang selalu invalidate → debounce 300–500ms + invalidate satu query key, bukan multiple.
7. Hapus dependency yang tak dipakai dari `package.json` (audit cepat via `depcheck`), tanpa mengganggu skrip Android.

**Deliverable:** angka before/after — total JS transferred untuk `/` mobile, waktu TTI di preview, size chunk terbesar. Belum menyentuh visual.

## Slice 2 — Konsistensi mobile 390/411
1. Terapkan `PageContainer` + `PageHeader` (yang sudah ada di `src/components/shell/`) ke semua halaman aplikasi utama: Beranda, Gudang, Ecer, Request, Tugas, Chat list, Catatan, Buku Alamat. Hilangkan header ad-hoc.
2. Audit tiap baris campuran teks + badge/angka mengikuti `docs/responsive-layout-rules.md`: `min-w-0` di container teks, `shrink-0` di badge, `tabular-nums` untuk angka.
3. Tinggi bottom-nav + safe-area diselaraskan; padding bawah `PageContainer` tambah `pb-[calc(env(safe-area-inset-bottom)+72px)]` di mobile agar konten tidak ketutup nav.
4. Snapshot visual di 320/360/390/411/480 untuk halaman yang disentuh — masuk ke `tests/visual/`.

**Deliverable:** semua halaman utama pakai shell yang sama, tidak ada wrap/overflow di 411, tap target ≥ 44px.

## Slice 3 — Logika (race, invariant, realtime)
1. Perbaikan reorder Beranda: pastikan `updated_at` guard (dari slice sebelumnya) juga dipatuhi oleh mutasi lain (edit judul, hide). Tambah test integrasi konflik dua-tab.
2. Send-confirmation contract: audit Ecer / Request / Paket / Beranda bulk — semua path harus lewat RPC record-before-send yang sama (`create_sale_then_send`, dst.). Turunkan cabang forked ke satu helper `useConfirmedSend`.
3. Payment invariant: verifikasi tidak ada default silent `Lunas`; unit tests untuk enum guard.
4. Realtime debounce di slice 1 direview ulang agar tidak menutupi update yang seharusnya instan (mis. pesan chat baru — tetap instan, bukan debounce).

**Deliverable:** satu helper terpakai di 4 surface, test race dua-tab hijau, tidak ada regression di CI existing.

---

### Cara kerja per slice
- Selesai slice → laporkan diff + angka + screenshot 411px.
- Anda approve on-device → lanjut slice berikutnya.
- Kalau mid-slice ada temuan Cloud compute (RLS lambat, dsb.), saya flag terpisah — tidak dicampur ke slice UI.

Mulai dari **Slice 1** karena efeknya paling terasa "enteng" dan risikonya paling rendah (tidak menyentuh tampilan).