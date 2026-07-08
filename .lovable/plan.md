# Refactor Photo Editor → Engine react-konva (Iterasi 1)

## Konteks penting

Editor lama: `src/components/PhotoEditor.tsx` (2010 baris, canvas manual). Dipakai di 4 tempat:
- `src/routes/t.$token.tsx` (2 titik — pegawai siap kirim & request)
- `src/routes/_authenticated.request.tsx` (admin preview)
- `src/routes/_authenticated.ecer.tsx` (ecer)
- `src/routes/lovable.visual.photo-editor.tsx` (harness QA)

Ada 6+ e2e test yang lock ke selector toolbar lama (`worker-portal-panel-photoedit`, `photo-editor-touch-android`, `photo-editor-toolbar-viewports`, `photo-editor-keyboard-safe-area`, `worker-portal-pick-photo`, `worker-portal-camera-no-reload`). Test-test itu mengunci workflow bisnis — harus tetap hijau.

## Strategi: engine baru side-by-side, bukan patch in-place

Buat `PhotoEditorV2` di komponen baru. Caller tetap import `PhotoEditor` — export dari `PhotoEditor.tsx` di-alias ke V2 setelah fondasi stabil. Ini menjaga API dan mempermudah rollback.

## Iterasi 1 (deliverable batch ini)

### A. Engine
- Tambah dependency: `konva`, `react-konva`, `use-image` (~150KB gz).
- File baru `src/components/photo-editor/` (folder):
  - `PhotoEditorV2.tsx` — shell, canvas Stage, state root
  - `engine/scene.ts` — tipe `Scene`, `SceneObject` (image | draw | shape | text | sticker), serialize/deserialize `sceneJson`
  - `engine/history.ts` — undo/redo unlimited via patch stack
  - `engine/gestures.ts` — pinch zoom, pan, double-tap-fit (native Konva + pointer events)
  - `hooks/useAutosaveScene.ts` — debounced simpan ke IndexedDB via `prep-draft-store` (kunci baru `photo-editor-scene:<key>`)

### B. Tools (semua di iterasi 1)
1. Crop: free / 1:1 / 4:5 / 16:9 + Rotate 90° + Flip H/V (crop layer non-destruktif; final commit saat Selesai)
2. Draw: Pen, Highlighter (multiply blend), Brush, Eraser — size 1–40, opacity 10–100, color picker HSV + palette preset MCM
3. Shapes: Arrow, Line, Circle, Rectangle, Triangle, Oval — resize handle, rotate handle, stroke width, opacity, color
4. Text: font (system + Inter + Poppins), size, bold, italic, outline, shadow, background, alignment, emoji (native picker)
5. Undo/Redo unlimited + tombol reset
6. Zoom: pinch + double-tap toggle 1×↔2× + fit button + slider (100/200/400)
7. Layer panel (bottom sheet): list objek, bring-to-front, send-to-back, duplicate, hide, delete, lock
8. Autosave scene ke IndexedDB tiap 500ms debounce; restore saat re-open

### C. API kompat
```ts
type PhotoEditorProps = {
  src: string;                       // existing
  onCancel: () => void;              // existing
  onSave: (blob, dataUrl, sceneJson?: string) => void;  // sceneJson OPSIONAL
  initialSceneJson?: string;         // opsional; jika ada → restore objek editable
  autosaveKey?: string;              // opsional; enable IndexedDB draft
};
```
Caller lama (tanpa `initialSceneJson`) tetap jalan — signature backward compat.

### D. Sticker (iterasi 1: minimum set pakai Lucide)
Pack 8 sticker paling penting via Lucide render-to-SVG: Check, X, AlertTriangle, MapPin, Package, DollarSign (Paid), Clock (Pending), BadgeCheck (Verified). Semua bisa resize/rotate/warna/opacity. Sticker sisanya (Fragile SVG custom, DP, Hutang, dsb) ditunda ke iterasi 2 sesuai persetujuan tadi ("fondasi dulu").

### E. UI
- Floating bottom toolbar ikon (44px tap target), aktif tool di-highlight
- Bottom sheet options per tool (size/opacity/color)
- Top bar: Batal / Undo / Redo / Selesai
- Dark mode via token existing (`bg-background`, `text-foreground`)
- Mobile-first 411px; tetap responsif ke desktop
- Animasi via `framer-motion` (sudah terpasang)

### F. Yang ditunda ke iterasi 2 (persetujuan sudah dicatat)
Sticker Pack lengkap (SVG custom 20+), Blur/Pixelate/Mosaic brush, Export quality picker (PNG/JPEG/WEBP + kompres tier), Smart guides/grid/snap, Custom PNG sticker upload.

## Kompatibilitas tes

Toolbar lama diuji lewat selector seperti `data-testid="pe-tool-*"`. Saya akan:
1. Baca semua spec e2e photo-editor dulu, catat testid yang harus dipertahankan.
2. Terapkan testid yang sama di V2 (Crop, Rotate, Draw, Text, Save, Cancel, Undo).
3. Jalankan `bunx vitest run` untuk unit test hittest lama — jika logic hittest lama tidak relevan lagi, ganti test-nya (bukan skip) dengan test hittest V2.

## File yang berubah

Baru:
- `src/components/photo-editor/PhotoEditorV2.tsx`
- `src/components/photo-editor/engine/scene.ts`
- `src/components/photo-editor/engine/history.ts`
- `src/components/photo-editor/engine/gestures.ts`
- `src/components/photo-editor/tools/*.tsx` (Crop, Draw, Shapes, Text, Sticker, Layers, Zoom)
- `src/components/photo-editor/hooks/useAutosaveScene.ts`
- Unit test: `src/components/photo-editor/engine/scene.test.ts`, `history.test.ts`

Edited:
- `src/components/PhotoEditor.tsx` → thin re-export dari V2 (menjaga import path lama)
- Tidak ada perubahan di caller (`t.$token.tsx`, `request.tsx`, `ecer.tsx`, harness)
- Tidak ada perubahan DB, RLS, route, auth, atau workflow bisnis

## Risiko + mitigasi

1. Bundle +150KB → lazy-load `PhotoEditorV2` via `React.lazy` di re-export shim. Editor cuma dibuka on-demand, tidak masuk critical path.
2. E2E test lama bergantung selector spesifik → mirror testid yang identik.
3. HEIC/kompresi existing → tetap dipakai apa adanya (input file staging tak berubah).
4. Autosave menyimpan scene ke IndexedDB → key bersih otomatis saat pegawai klik Selesai (sama pola `prep-draft-store`).

Perkiraan: implementasi + verifikasi ~1 batch besar. Setelah plan ini disetujui, saya kerjakan sampai `tsgo` + build + smoke test harness hijau, lalu lapor untuk iterasi 2 (sticker pack lengkap + blur + export quality).
