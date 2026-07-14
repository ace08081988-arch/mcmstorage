## Latar

Editor foto saat ini (`src/components/PhotoEditor.tsx`, ±2010 baris) pakai kanvas 2D manual: rotasi hanya 90°, tanpa crop / filter / pinch-zoom modern, dan lag di HP low-end karena tiap gerakan re-draw seluruh layer.

Di repo sudah ada rangka `PhotoEditorV2` (react-konva) di `src/components/photo-editor/PhotoEditorV2.tsx` — sudah punya undo/redo, layer, sticker Lucide, dan autosave scene, tapi **hanya dipakai di route visual preview**. Tombol Crop di sana masih `disabled`, dan filter/brightness belum ada. Route asli yang dipakai pegawai/pemilik (`/t/$token`, `_authenticated.request`, `_authenticated.ecer`) semua masih pakai editor lama.

Rombakan total = **pindah semua pemakaian ke V2**, tuntaskan fitur yang belum jadi di V2, lalu hapus editor lama. Empat prioritas Anda (interaksi lambat, toolbar kuno, crop/rotate terbatas, belum ada filter) langsung tercakup karena V2 pakai engine react-konva (GPU-cached layer, gesture bawaan Konva) dan strukturnya siap ditambahi crop + filter.

## Rencana per slice (auditable)

### Slice 1 · Toolbar & interaksi modern (aman, tanpa hilang fitur)
Tujuan: rasa "jadul" hilang meski fitur belum bertambah.

- Redesain toolbar V2 jadi bar bawah glass gelap (semi-transparan `bg-background/70 backdrop-blur-xl`) + tombol besar tap-target 44px, ikon Lucide konsisten. Tetap pakai token semantik, bukan warna hardcode.
- Panel warna & slider dipindah ke bottom-sheet yang muncul saat tool aktif — sekali swipe untuk sembunyikan, tidak menutupi kanvas.
- Pinch zoom & pan dua jari: pakai `Konva.Stage` gesture (sudah didukung), tambah batas zoom 0.5×–4×, snap ke 1× saat mendekati, dan momentum pan.
- Perf: aktifkan `Konva.Layer.cache()` untuk foto dasar + `hitGraphEnabled=false` pada layer overlay saat menggambar → tidak ada full re-raster saat pointermove.
- Undo/redo per-stroke tetap; tambah tombol "Reset" di header.
- Ganti panggilan `PhotoEditor` → `PhotoEditorV2` di 3 route asli (`t.$token`, `_authenticated.request`, `_authenticated.ecer`) + route preview visual, kirim `autosaveKey` yang stabil per konteks (mis. `prep:${itemId}`) supaya draft edit tetap aman.

Tes cepat: buka `/t/$token` di preview 411px, coba coret + rotate + save → foto ter-upload sama seperti dulu.

### Slice 2 · Filter & auto-enhance
Tujuan: foto barang gudang cepat cerah/jelas.

- Tambah state `adjust` di scene: `{ brightness: 0, contrast: 0, saturation: 0 }` (semua −1..+1, default 0). Terapkan lewat `Konva.Filters.Brighten` + `HueSaturation` di layer foto dasar (perlu `image.cache()` + `image.filters([...])`).
- Preset filter (satu tap):
  - **Asli** (0/0/0)
  - **Terang** (+0.15 / +0.1 / 0) — foto gudang gelap
  - **Toko** (+0.05 / +0.15 / +0.15) — warna produk pop
  - **Auto** — hitung dari histogram luminance (mean → target 0.5) di worker kecil offscreen
  - **B/W** — saturation −1
- Panel adjust modal bottom-sheet: 3 slider + bar preset di atas. Live preview via Konva filter (bukan CSS `filter:` — supaya konsisten dengan hasil export).
- Simpan `adjust` & preset ke scene JSON (autosave tetap jalan). Compat: scene lama tanpa field ini di-treat sebagai default.
- Ekspor tetap lewat `stage.toCanvas()` → filter sudah baked in.

### Slice 3 · Crop preset + rotate halus + flip
Tujuan: framing foto beres tanpa app luar.

- Aktifkan tool `crop`: tampilkan overlay grid rule-of-thirds di atas foto dasar, sudut+sisi handle drag.
- Aspect ratio chips: **Bebas · 1:1 · 4:5 · 4:3 · 16:9** (Toko biasanya 1:1 & 4:5 untuk katalog). Saat preset dipilih, box crop di-constrain proporsional.
- Rotate slider −45°..+45° (halus) selain tombol ±90° yang sudah ada. Preview real-time; commit saat lepas.
- Flip H / Flip V tombol terpisah (tidak lewat scale negatif — pakai field `flipH/flipV` yang sudah ada di scene).
- Commit crop: update `scene.width/height` & offset semua object supaya koordinat tetap benar (translate). Reversible via undo.

### Slice 4 · Anotasi finishing
Tujuan: anotasi terasa halus, bukan MSPaint.

- Panah baru: kepala anak-panah tapered (bukan segitiga polos), shadow tipis untuk kontras di foto terang.
- Teks: chip background opsional (rounded-lg, semi-transparan) supaya terbaca di foto ramai — toggle di panel teks.
- Blur/mosaic brush kecil (Konva `Filter.Blur` di path draw) untuk sensor plat/nomor pelanggan.
- Semua stroke di-render dengan `lineCap: round, lineJoin: round, tension: 0.4` (sudah default) — pastikan tetap konsisten di crop.

### Slice 5 · Bersih-bersih
- Hapus `src/components/PhotoEditor.tsx` + `PhotoEditor.hittest.test.ts` setelah 4 slice pertama Anda approve di HP 411px.
- Tulis test unit tipis untuk `adjust` preset & crop coord math di `photo-editor/engine`.
- Update dokumen `docs/` kalau ada referensi ke editor lama.

## Cakupan yang **tidak** disentuh
- Alur upload / kompresi (`src/lib/prep.ts`, `prep-image-compress.ts`) — tetap. Blob yang keluar dari V2 format sama.
- Kontrak `onSave(blob, dataUrl, sceneJson?)` — tetap. Semua pemanggil existing tidak berubah.
- Server function / RPC / storage bucket — tidak berubah.

## Verifikasi

Setelah tiap slice:
1. `bunx tsgo --noEmit` — hard build gate.
2. Manual di preview 411px CSS px: coret + rotate + crop + save → foto muncul di dashboard pemilik dengan hasil identik yang di-preview.
3. Setelah slice 2 & 3: bandingkan foto sebelum/sesudah preset "Terang" di 3 foto contoh gudang.
4. Anda uji di HP fisik (411 & 390) sebelum saya lanjut ke slice berikutnya — tidak self-approve.

## Estimasi ukuran

- Slice 1: ±200 baris edit V2 + 4 route swap (±20 baris/route).
- Slice 2: ±150 baris (adjust panel + filter pipe).
- Slice 3: ±250 baris (crop overlay + math).
- Slice 4: ±120 baris.
- Slice 5: hapus ~2010 baris editor lama.

Total tambah bersih ≈ −1200 baris (editor lama lebih besar dari V2 baru gabungan).

## Setelah Anda setujui
Saya mulai **Slice 1 saja**. Setelah Anda cek di HP dan bilang OK, baru lanjut Slice 2. Tidak ada slice yang saya kerjakan di depan.