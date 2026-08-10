# Audit ACE STORAGE — Alur Foto, Portal Pegawai & Responsivitas Android

Audit dijalankan pada kode yang ada sekarang; belum ada file yang diubah. Setiap klaim di bawah punya bukti file:baris atau hasil query database.

## Ringkasan

Alur bisnis yang disepakati (Request multi-produk → link+PIN → kamera/galeri → editor foto wajib → lokasi → submit → Siap Dikirim/ECER → pembayaran → kirim WA/Ace Chat → Terkirim) sudah ada strukturnya. Yang bermasalah adalah keandalannya di Android: editor foto bisa terlewat diam-diam, draft teks hilang saat portal me-remount, dan syarat "foto + lokasi" tidak seragam antar tiga layar.

Sudah benar dan **tidak akan disentuh**: scoping pemilik (RLS `user_id`/`owner_user_id` pada warehouse_items, prep_tasks, prep_submissions, ecer/request_preparations, debts, sales), penautan `prep_task_request_titles` + trigger auto-repair, pengurangan stok ganda (trigger `apply_*` memakai `FOR UPDATE`, net 1x potong), hapus hutang non-optimistic (`_authenticated.hutang-piutang.tsx:389-404`), oversell Kios (dijaga `apply_sale()` di server), kartu chat tak dikenal (`MessageAttachment.tsx:325-328` fallback `UnknownCardBlock`), sinkronisasi mute ke service worker (`notif-prefs.ts:91-100` ↔ `public/sw-push.js:166-220`), bucket storage (10/10 `public=false`, upload anon digerbangi `prep_upload_allowed`/`prep_worker_upload_allowed` + batas ukuran), dan `search_path` fungsi aplikasi (31 sisa hanya milik ekstensi `pg_trgm`).

---

## Critical

### C1. Editor foto bisa terlewat, dan foto mentah tetap bisa dikirim
Tiga jalur penyebab:
- `src/routes/t.$token.tsx:3064-3080` (`stageGalleryFiles`): semua file di-stage dengan `openEditor=false`, editor lalu dibuka lewat indeks (`tryOpenEditForIdx`). Bila ref belum siap, kode hanya menampilkan toast "Ketuk foto untuk edit" — foto tetap tersimpan dan bisa dikirim tanpa diedit.
- `src/routes/t.$token.tsx:3751-3756`: `onCancel` mengosongkan seluruh antrean edit; foto sisa antrean tetap terlampir tanpa edit.
- `src/routes/_authenticated.request.tsx:3539-3550` dan `PrepFormDialog` di `_authenticated.ecer.tsx`: `setPhoto({blob:f, dataUrl})` dipanggil sebelum editor dibuka sebagai "jaring pengaman", jadi tekan Batal = foto asli ikut tersimpan.
- Gate submit hanya `photos.length > 0` (`t.$token.tsx:3101-3105`); tidak pernah memeriksa apakah foto melewati editor.

Perbaikan:
- Tambah penanda `edited` (+`editedAt`) pada `StagedPhoto`/`photo` di ketiga layar; hanya `onSave` editor yang boleh menyetelnya.
- Submit ditolak selama ada foto `edited=false`; bila memang perlu, satu dialog konfirmasi eksplisit "Pakai foto asli tanpa edit?" (default: tidak boleh).
- Ganti pembukaan editor berbasis indeks menjadi berbasis `photo.id`, sehingga `waitForPhotosRefLength`, retry `queueMicrotask`, dan `setTimeout(...,0)` (`t.$token.tsx:2747-2786`) bisa dihapus.

### C2. Editor gagal dimuat = layar kosong / spinner abadi di APK
`src/components/photo-editor/LazyPhotoEditorV2.tsx:31-36` hanya membungkus `Suspense`, tanpa error boundary. Bila chunk konva gagal diunduh (APK dengan chunk lama, jaringan putus), pengguna melihat "Menyiapkan editor foto…" selamanya atau boundary atas me-remount seluruh portal — persis keluhan "langkah edit foto hilang".
Perbaikan: bungkus dengan error boundary + retry memakai `src/lib/chunk-recovery.ts`, sediakan tombol "Coba lagi" dan "Ambil ulang foto". Satukan juga `use-photo-editor-flow.tsx:3-5` agar memakai wrapper lazy yang sama (kini membuat jalur impor kedua).

### C3. Dua implementasi kembar di portal pegawai
`t.$token.tsx` memuat blok ItemCard (±2670–3780) dan RequestSection (±4407–5384) yang nyaris identik: dua `editorOpen/editorSrc`, dua `stageOne`, dua picker. Setiap perbaikan harus ditulis dua kali dan sudah terbukti menyimpang (gating berbeda).
Perbaikan: ekstrak satu hook `useWorkerPhotoStage` (di atas `usePhotoEditorFlow` yang sudah ada tapi belum dipakai route) dan pakai di kedua blok, tanpa mengubah tampilan atau alur.

---

## High

### H1. Draft teks hilang saat refresh/remount
Foto sudah dipersist (`saveDraftPhotos`/`loadDraftPhotos`, `t.$token.tsx:2870-2894`, `4520-4542`), tetapi `note`, `gps`, `locUrl`, `manualLat/Lng` (`t.$token.tsx:2674-2711`, `4410-4424`) dan baris jumlah `actual_grams` (±`4160-4179`) hanya `useState`. Pemicu kehilangan: tombol "↻ Muat ulang halaman" `window.location.reload()` (`t.$token.tsx:2434`, `2609`), remount `PortalTopBoundary` (`624-649`), dan remount `WorkerSectionBoundary` untuk error non-DOM-race (`514`).
Perbaikan: simpan field tersebut ke draft store yang sama (kunci `itemDraftKey`/`requestDraftKey`), flush sinkron pada `beforeunload` dan sebelum `window.location.reload()`, pulihkan saat mount.

### H2. Soft keyboard menutupi tombol Kirim
Proyek sudah punya `src/hooks/use-visual-viewport-inset.ts` dan variabel `--app-keyboard-inset` (`src/lib/viewport-height.ts`), tetapi `t.$token.tsx` tidak memakainya; footer sticky `t.$token.tsx:5284-5290` hanya mengompensasi safe-area bawah.
Perbaikan: tambahkan inset keyboard pada footer sticky dan `scrollIntoView({block:"center"})` saat input catatan/jumlah difokuskan.

### H3. Syarat "foto + lokasi" tidak seragam
- Portal `t.$token.tsx:3176-3192`: GPS boleh `null`.
- `_authenticated.request.tsx:3594,3625`: foto wajib, GPS boleh `null`.
- `_authenticated.ecer.tsx:3277-3282,3313-3316`: lokasi wajib, foto justru opsional.
Sesuai langkah 5 alur yang disepakati, ketiganya harus: foto sudah diedit **dan** lokasi tersedia, baru boleh submit. Disamakan lewat satu helper validasi bersama.

### H4. Kolom jumlah per item tidak jelas
`t.$token.tsx:4918-4939`: input `type="number"` untuk `actual_grams` di grid `grid-cols-12` (8/3/1) tanpa `<label>`/`aria-label`; pada 360px kolom satuan tinggal ±30px dan target sentuh input sempit.
Perbaikan: label eksplisit "Jumlah (satuan)" per baris, `aria-label` berisi nama produk, grid responsif (menumpuk di bawah 400px), `inputMode="decimal"`, dan tampilkan target vs terisi.

### H5. Pencabutan sesi hanya ditegakkan di klien (PARTIAL)
`src/lib/device-sessions.ts` memeriksa `revoked_at` saat mount/focus/polling 60 detik; query `pg_policies` tidak menemukan policy mana pun yang merujuk `device_sessions`. JWT yang sudah dicabut masih bisa membaca/menulis sampai polling berikutnya.
Perbaikan menyentuh database (fungsi `is_session_revoked(auth.uid())` + kondisi tambahan pada policy tabel sensitif), jadi diajukan **terpisah untuk persetujuan** dan tidak dikerjakan pada batch kode ini.

---

## Medium

- **M1. Editor belum bisa menggabungkan foto lain.** `PhotoEditorV2.tsx` sudah mendukung pilih/geser, coret (pen/highlighter/brush/eraser), teks, stiker/emoji (`STICKER_PRESETS:79-130`), panah/garis/kotak/lingkaran/oval/segitiga, crop, rotate/flip (`431-433`), undo/redo (`419-428`), hapus/ubah ukuran/duplikat layer, Simpan/Batal (`doSave:450-468`). Yang belum ada: menambah/menggabung foto kedua. Tambahkan tool "Tambah foto" sebagai layer gambar (dari kamera/galeri) yang bisa digeser, diubah ukuran, dan dihapus seperti layer lain.
- **M2. Verifikasi 360/411px.** Jalankan Playwright pada `/t/$token` dan editor di lebar 360 dan 411 untuk memastikan toolbar, panel stiker, dan footer tidak terpotong.
- **M3. Editor lama.** `src/components/PhotoEditor.tsx` (2013 baris) kini hanya dipakai harness `src/routes/lovable.visual.photo-editor.tsx:13`. Arahkan harness ke V2 dan tandai file lama deprecated tanpa menghapusnya dulu.

---

## Urutan pengerjaan

1. Batch 1 (Critical): C2 → C1 → C3.
2. Batch 2 (High): H1, H2, H3, H4.
3. Batch 3 (Medium): M1, M2, M3.
4. H5 diajukan sebagai rencana migrasi terpisah untuk disetujui pemilik.

## Uji penerimaan

- Galeri pilih 3 foto → editor terbuka 3× berurutan; membatalkan pada foto ke-2 tidak menyisakan foto tak teredit yang bisa dikirim.
- Kamera → editor selalu terbuka; tekan Batal → tombol Kirim terkunci dengan pesan "Foto harus diedit dulu".
- Chunk editor gagal dimuat (mock `import()` reject) → muncul tombol "Coba lagi", bukan spinner abadi.
- Isi catatan + jumlah + lokasi, tekan "Muat ulang halaman" → semuanya kembali utuh setelah reload.
- Fokus input jumlah pada viewport 360×640 dengan keyboard aktif → tombol Kirim tetap terlihat.
- Submit tanpa lokasi ditolak di portal, Request, dan ECER; submit tanpa foto ditolak di ECER.
- Tekan Kirim dua kali cepat → hanya satu submission (kunci idempotensi `getSubmitKey` tetap dipakai).
- Editor: tambah foto kedua, geser, ubah ukuran, hapus, undo/redo, Simpan menghasilkan satu Blob gabungan.

## Strategi build & tes

- Unit/komponen (vitest + happy-dom): gating `edited`, antrean editor berbasis id, error boundary lazy editor, persistensi draft field, helper validasi foto+lokasi bersama.
- Uji sumber agar ketiga layar memakai helper validasi yang sama dan tidak ada lagi `setPhoto` pra-editor.
- Playwright 360px & 411px untuk toolbar editor, footer sticky, dan inset keyboard.
- Gate wajib sebelum selesai: `bunx vitest run` (kini 2514 lulus), `bunx tsgo --noEmit`, dan `bun run build`. Artefak `public/data/dependency-trend.json` serta benchmark tidak ikut diubah.
- Tanpa migrasi database, tanpa publish/deploy, tanpa perubahan alur bisnis; brand tetap ACE STORAGE dan appId `biz.mcmstorage.app`.