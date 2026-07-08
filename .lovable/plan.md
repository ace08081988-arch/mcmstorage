## Slice E — Request Order workflow: SSOT untuk jenis produk

### Audit temuan (yang SUDAH ada, tak akan disentuh)

Alur end-to-end sudah lengkap dan konsisten — verifikasi cepat:

| Tahap | Sumber kode | Status |
|---|---|---|
| Admin buat Request Order | `src/routes/_authenticated.request.tsx` (TitleEditor) | ada |
| Kirim tugas → pegawai | `src/lib/tugas-share.ts`, RPC `create_prep_task_from_title` | ada |
| Buka via PIN | `src/routes/t.$token.tsx` (share token + PIN gate) | ada |
| Foto kamera/galeri + edit (crop, rotate, panah, lingkaran, kotak, teks, stiker, undo/redo) | `src/components/PhotoEditor.tsx` | ada |
| Lokasi GPS + paste Google Maps link + koord manual | `t.$token.tsx` ln 2382/2947–2985/4156–4219 | ada |
| Selesai → Ready-to-ship | `ready_packages` + `prep_submissions` + `verification_status` (SSOT `deriveRequestStatus`) | ada |
| Status pipeline 11-state | `src/lib/prep-status.ts` (`deriveRequestStatus/deriveEcerStatus`) | ada |
| Belum masuk pembayaran / belum kirim ke customer | Tidak ada trigger auto-payment; `sold_at` di-set manual di flow pembayaran terpisah | benar |

**Kesimpulan**: alur bisnis Request Order sudah komplit. Yang inkonsisten hanyalah **input satuan (unit)** — saat ini `unit_label` bebas ketik teks (`<Input placeholder="gram">`), jadi user bisa mengetik "grm", "Gram", "GR", "kg", "kgs", "karton" campur-baur. Tidak ada SSOT jenis produk.

### Yang akan dibuat/diubah

Buat **SSOT jenis produk & satuan** yang membakukan input di semua surface, tanpa mengubah DB. Kolom `unit_label` (free-text) tetap dipakai sebagai storage; SSOT hanya membakukan nilai yang ditulis + rendering.

#### 1. `src/lib/unit-kinds.ts` (baru)

```ts
export type UnitKind =
  | "mg" | "gr" | "ons" | "kg"   // ECER (berat)
  | "pcs"                          // Hitung satuan
  | "botol"                        // Botol/bottle
  | "karton"                       // Karton/dus
  | "koli"                         // Koli/bal
  | "custom";                      // Bebas ketik (fallback backward-compat)

export const UNIT_GROUPS = [
  { label: "Ecer (berat)", kinds: ["mg","gr","ons","kg"] as const },
  { label: "Hitungan",     kinds: ["pcs","botol"] as const },
  { label: "Bulk",         kinds: ["karton","koli"] as const },
  { label: "Lainnya",      kinds: ["custom"] as const },
];

export const UNIT_LABEL_ID: Record<UnitKind,string>;   // "mg" | "gr" | "ons" | "kg" | "pcs" | "botol" | "karton" | "koli" | "custom"
export function resolveKind(free: string|null|undefined): UnitKind;  // pakai UNIT_SYNONYMS existing
export function canonicalUnitLabel(kind: UnitKind, custom?: string): string; // ditulis ke DB
export function formatQty(qty: number, kind: UnitKind, custom?: string, productName?: string): string;
// weight helpers (hanya untuk berat): toGrams(qty, kind), fromGrams(g, kind)
```

- `resolveKind` sudah dijaga oleh grup sinonim di `unit-label.ts` (extend, bukan ganti).
- `canonicalUnitLabel` memastikan yang ditulis ke DB selalu bentuk pendek konsisten (`"gr"`, `"kg"`, `"pcs"`, `"botol"`, `"karton"`, `"koli"`; `custom` → apa adanya).
- `formatQty` menghormati kasus khusus GS→botol (SSOT `displayUnit` lama).

#### 2. `TitleEditor` di `src/routes/_authenticated.request.tsx`

Ganti `<Input placeholder="gram">` per-baris menjadi:

```
[ produk ▾ ]  [ qty ] [ satuan ▾ ]  ← Select dgn 4 grup (Berat/Hitung/Bulk/Custom)
                        ↳ jika 'custom' → tampilkan Input teks bebas
```

- State baris menyimpan `unit_kind: UnitKind` + `unit_custom: string`.
- Saat submit: `unit_label = canonicalUnitLabel(unit_kind, unit_custom)`.
- Saat load pesanan lama: `unit_kind = resolveKind(row.unit_label); unit_custom = unit_kind==='custom' ? row.unit_label : ""`. Backward-compat 100%.
- Qty input `inputMode="decimal"` untuk `mg/gr/ons/kg`, `inputMode="numeric"` step=1 untuk `pcs/botol/karton/koli`.
- Placeholder qty menyesuaikan kind ("500", "1", "3").

#### 3. Rendering konsisten (audit ringan)

- Ganti `${i.target_grams}${displayUnit(...)}` di file berikut agar melalui `formatQty(qty, resolveKind(unit_label), unit_label, name)` → seragam spasi & label ("500 gr", "3 pcs", bukan "500gram" campur "3 pcs").
  - `src/routes/_authenticated.request.tsx` (4 lokasi)
  - `src/routes/t.$token.tsx` (7 lokasi)
- `displayUnit` tetap ada sebagai thin wrapper — legacy caller lain tidak pecah.

#### 4. Status SSOT (verifikasi, bukan perubahan)

Cek cepat semua `StatusBadge` di halaman Request memakai `lifecycle={deriveRequestStatus(prep, task)}`; jika ada yang masih hardcode string status, ganti. Tidak menambah state baru — pipeline 11-status tetap.

### Yang TIDAK disentuh

- Skema database (tidak ada migrasi). `unit_label` tetap `text`.
- Auth, RLS, route paths, sidebar/navigasi.
- PhotoEditor, share token, PIN gate, GPS/paste-Maps, upload Ready-to-ship.
- Ecer route (`/ecer`) — meski ikut kena `formatQty` via helper, perilaku bisnisnya tidak berubah.
- Payment flow — masih manual (sesuai permintaan "belum masuk pembayaran").

### Verifikasi

- `bunx tsgo --noEmit`.
- Manual: buka `/request` → New title → dropdown satuan berisi 4 grup → pilih `karton` qty 3 → simpan → cek baris tersimpan "3 karton" konsisten di list, kartu, dan halaman `/t/$token`.
- Test `src/lib/prep-active-selector.test.ts` + existing tests tidak boleh regress.
- Load pesanan lama (dengan `unit_label = "gram"` legacy) tetap tampil "N gr" via `resolveKind` — backward-compat.

### File yang disentuh

- **baru**: `src/lib/unit-kinds.ts`
- **edit**: `src/lib/unit-label.ts` (extend, tambah export), `src/routes/_authenticated.request.tsx` (TitleEditor row + renderer helpers), `src/routes/t.$token.tsx` (renderer only)

Setelah plan disetujui, dikerjakan dalam satu edit batch.