# Skema payload `mcm.appearance-settings`

Dokumen ini adalah **kontrak antar rilis** untuk file ekspor/impor
pengaturan tampilan MCM Storage (`/pengaturan-tampilan`). Setiap perubahan
bentuk payload wajib memperbarui bagian yang relevan di sini SEBELUM naik
versi.

Sumber kebenaran kode:

- Migrator: [`src/lib/appearance-migrator.ts`](../src/lib/appearance-migrator.ts)
- Fixture: [`src/lib/appearance-migrator.fixtures.ts`](../src/lib/appearance-migrator.fixtures.ts)
- Telemetri: [`src/lib/appearance-migrator.telemetry.ts`](../src/lib/appearance-migrator.telemetry.ts)
- Halaman: [`src/routes/_authenticated.pengaturan-tampilan.tsx`](../src/routes/_authenticated.pengaturan-tampilan.tsx)
- Harness E2E: [`src/routes/lovable.visual.appearance-import.tsx`](../src/routes/lovable.visual.appearance-import.tsx)

## Prinsip

1. **Backward-compatible selalu.** Rilis N+1 wajib menerima file dari rilis
   ≤N. Menaikkan `EXPORT_SCHEMA_VERSION` tanpa mempertahankan pembacaan
   versi lama adalah *breaking change* — dilarang.
2. **Forward-tolerant.** Payload dari rilis lebih baru boleh masuk. Field
   yang belum dikenal **diabaikan**; field yang dikenal tetap dimuat.
   Importer wajib menandai hasil sebagai `forward: true` dan menampilkan
   peringatan lembut.
3. **Satu migrator, satu jalur.** Semua sumber (upload / paste / URL)
   HARUS melewati `migrateImportedAppearance` melalui helper terpusat
   `runImportFromText`. Tidak boleh ada `JSON.parse` payload appearance
   di jalur lain — dijaga oleh
   `src/lib/appearance-migrator.single-source.test.ts`.
4. **Setiap migrasi menghasilkan telemetri.** `logAppearanceMigration`
   memancarkan event dengan `fromVersion` dan `toVersion` supaya regresi
   inkompatibilitas terdeteksi di rilis berikutnya.

## Format amplop (semua versi)

Payload adalah objek JSON tingkat atas dengan amplop bersama:

| field           | tipe     | wajib | catatan                                                                 |
| --------------- | -------- | ----- | ----------------------------------------------------------------------- |
| `__type`        | string   | ya    | Harus persis `"mcm.appearance-settings"`. Nilai lain → `unknown_type`.  |
| `schemaVersion` | number   | ≥ v2  | Sumber utama versi skema.                                               |
| `version`       | number   | v1    | Alias legacy — dibaca hanya jika `schemaVersion` tidak ada.             |
| `app`           | string   | tidak | Informasi, tidak divalidasi. Ekspor menulis `"mcm-storage"`.            |
| `exportedAt`    | string   | tidak | ISO timestamp untuk keperluan diagnostik.                               |

Urutan resolusi versi (implementasi):

```text
fromVersion = Number(raw.schemaVersion ?? raw.version ?? 1)
forward     = Number.isFinite(fromVersion) && fromVersion > EXPORT_SCHEMA_VERSION
```

Jika hasil bukan angka valid, importer melanjutkan tetapi menandai
`forward=false` — versi tidak dikenal tidak boleh menghentikan impor
field yang cukup jelas.

## Skema per versi

### v1 (rilis awal)

Field appearance ADA DI ROOT payload. Beberapa nilai numerik dulu ditulis
sebagai string (`"0.875"`). Migrator mengonversinya dengan `Number(...)`.

```json
{
  "__type": "mcm.appearance-settings",
  "version": 1,
  "theme": "dark",
  "font": "serif",
  "size": "lg",
  "accent": "emerald",
  "radius": "0.875",
  "bgImage": "https://example.com/bg.jpg",
  "bgOverlay": "0.6",
  "bgBlur": "12",
  "compact": true,
  "fontScale": 1.1,
  "highContrast": true,
  "reduceMotion": false
}
```

`version` boleh hilang sepenuhnya → default ke `1`.

### v2 (aktif)

`EXPORT_SCHEMA_VERSION = 2`. Field appearance dipindah ke `appearance`,
field aksesibilitas dipindah ke `appPrefs`. `compact` tetap di root karena
konsumennya adalah utilitas layout global. `version` dipertahankan sebagai
alias untuk importer lama.

```json
{
  "__type": "mcm.appearance-settings",
  "schemaVersion": 2,
  "version": 2,
  "app": "mcm-storage",
  "exportedAt": "2026-07-01T09:00:00.000Z",
  "appearance": {
    "theme": "light",
    "font": "display",
    "size": "xl",
    "accent": "rose",
    "radius": "1.25",
    "bgImage": "https://example.com/bg.jpg",
    "bgOverlay": "0.5",
    "bgBlur": "20"
  },
  "compact": true,
  "appPrefs": {
    "fontScale": 1.25,
    "highContrast": true,
    "reduceMotion": true
  }
}
```

Aturan pembacaan v2: untuk tiap field, migrator mencoba
`raw.appearance.X` / `raw.appPrefs.X` DULU, lalu jatuh ke `raw.X` di root
(menutup file v1), lalu jatuh ke nilai `current` (draft aktif).

### v3+ (masa depan)

Rilis berikutnya boleh menambah:

- field baru di `appearance` / `appPrefs`
- section root baru (mis. `motionProfile: {...}`)
- nilai enum baru (`theme: "sepia"`) — tapi lihat bagian "Menambah enum"

Importer rilis SEKARANG akan:

- menandai hasil `forward: true`
- memuat field yang dikenal
- **mengabaikan** field baru tanpa error
- menampilkan toast `warning` yang menyebutkan `fromVersion` vs target

Contoh payload v3 hipotetis:

```json
{
  "__type": "mcm.appearance-settings",
  "schemaVersion": 3,
  "version": 3,
  "appearance": {
    "theme": "dark",
    "font": "sans",
    "size": "md",
    "accent": "violet",
    "radius": "0.75",
    "animatedGradient": true,
    "glassMorphism": { "strength": 3 }
  },
  "appPrefs": { "fontScale": 1.05, "dyslexiaFriendly": true },
  "motionProfile": { "style": "reduced-fancy" }
}
```

## Field appearance (v2, dengan clamping)

Kolom **Fallback** adalah nilai `current[X]` di draft aktif — bukan konstanta
hardcoded. Ini membuat impor yang parsial tidak "me-reset" field yang tidak
disebut file.

| field          | tipe    | validator                                | rentang       | fallback                |
| -------------- | ------- | ---------------------------------------- | ------------- | ----------------------- |
| `theme`        | enum    | `light` \| `dark` \| `system`            | —             | `current.theme`         |
| `font`         | enum    | `sans` \| `serif` \| `mono` \| `display` | —             | `current.font`          |
| `size`         | enum    | `sm` \| `md` \| `lg` \| `xl`             | —             | `current.size`          |
| `accent`       | string  | string bebas                             | —             | `current.accent`        |
| `radius`       | number  | `Number(x)`, clamp                       | `[0, 2]`      | `current.radius`        |
| `bgImage`      | string  | string bebas (URL / dataURL)             | —             | `current.bgImage`       |
| `bgOverlay`    | number  | `Number(x)`, clamp                       | `[0, 1]`      | `current.bgOverlay`     |
| `bgBlur`       | number  | `Number(x)`, clamp                       | `[0, 40]`     | `current.bgBlur`        |
| `compact`      | boolean | `typeof === "boolean"`                   | —             | `current.compact`       |
| `fontScale`    | number  | `Number(x)`, clamp                       | `[0.8, 1.5]`  | `current.fontScale`     |
| `highContrast` | boolean | `typeof === "boolean"`                   | —             | `current.highContrast`  |
| `reduceMotion` | boolean | `typeof === "boolean"`                   | —             | `current.reduceMotion`  |

Ringkasan aturan validator:

- **`pickEnum`** — nilai wajib string DAN termasuk daftar `allowed`, jika
  tidak → fallback ke `current`.
- **`pickNumber`** — `Number(x)` diperiksa `Number.isFinite`. Jika tidak
  finite → fallback. Jika finite tapi di luar `[min,max]` → dijepit ke
  batas terdekat.
- **`pickBool`** — hanya menerima `true` / `false` literal; string
  `"true"` bukan boolean dan akan jatuh ke fallback.
- **`pickString`** — hanya menerima `typeof === "string"`.

Field root yang tidak berbentuk objek (`appearance`, `appPrefs`) diabaikan
tanpa error — dianggap kosong.

## Hasil migrator (`MigrateResult`)

```ts
type MigrateResult =
  | { ok: true; patch: ImportedPatch; forward: boolean; fromVersion: number }
  | { ok: false; reason: "unknown_type" | "invalid" };
```

- `unknown_type` → `__type` bukan `"mcm.appearance-settings"`.
- `invalid` → payload bukan objek non-null non-array (mis. string, array,
  `null`), atau JSON gagal di-parse di jalur `runImportFromText`.
- `patch` — SELALU berisi 12 kunci `ImportedPatch` (dijaga oleh test).

## Telemetri

Setiap kali importer dipanggil (sukses ataupun ditolak) ia mengirim:

```ts
{
  source: "file" | "paste" | "url",
  outcome: "ok" | "unknown_type" | "invalid",
  fromVersion: number | null,
  toVersion: EXPORT_SCHEMA_VERSION,
  forward: boolean,
  at: ISO-timestamp
}
```

Saluran:

- `console.info("[appearance-migrator] …JSON…")`
- `window.dispatchEvent(new CustomEvent("mcm:appearance-migrated", { detail }))`

Gunakan event untuk memasang dashboard sederhana (mis. tren jumlah
`forward: true` naik → indikator ada rilis lebih baru di alam liar).

## Checklist menaikkan EXPORT_SCHEMA_VERSION

Sebelum bump versi di rilis N+1, kerjakan semua item berikut agar
kompatibilitas tidak terputus:

1. **Update dokumen ini** dengan section skema baru + contoh payload minimal.
2. **Tambah fixture** `FIXTURE_V{n}` di `appearance-migrator.fixtures.ts`
   dan **jangan hapus** fixture versi lama.
3. **Tambah test v(n)** di `appearance-migrator.test.ts` (loading + forward
   detection) — biarkan test v1/v2 tetap ada, mereka menjaga backward compat.
4. **Tambah test E2E** di `tests/e2e/appearance-import-migrator.spec.ts`
   untuk payload v(n) via harness publik.
5. **Update `migrateImportedAppearance`** hanya untuk menambah pembacaan
   sumber baru. Jangan hilangkan fallback dari root (v1) — masih banyak
   file lama beredar.
6. **Update `exportSettings`** untuk menulis `schemaVersion: n`. Pertahankan
   `version: n` sebagai alias — importer versi rilis <=Q3-2026 masih
   membacanya.
7. **Jangan pernah** mengubah arti field yang sudah ada. Untuk perubahan
   semantik, buat NAMA field baru dan biarkan yang lama tetap bekerja
   sebagai fallback.
8. Jalankan `bunx vitest run src/lib/appearance-migrator` — semua suite
   harus lulus tanpa perubahan.

### Menambah enum

Menambah `theme: "sepia"` di v(n) aman untuk rilis N+, tapi rilis lama akan
jatuh ke `current.theme` (fallback), bukan error. Yang **dilarang**:

- Menghapus nilai enum yang pernah ada — file lama yang berisi nilai
  tersebut akan ter-fallback ke `current` diam-diam (tampak seperti file
  "tidak berpengaruh"). Jika benar-benar harus dihapus, tulis migrasi
  eksplisit yang memetakan nilai lama ke nilai baru sebelum `pickEnum`.

## Uji regresi yang menjaga kontrak ini

- `src/lib/appearance-migrator.test.ts` — unit fixture v1/v2/v3-future,
  clamping, fallback, invarian anti-mutasi.
- `src/lib/appearance-migrator.single-source.test.ts` — static-source guard
  bahwa hanya ada satu migrator + satu `JSON.parse` payload appearance.
- `src/lib/appearance-migrator.telemetry.test.ts` — bentuk event telemetri.
- `tests/e2e/appearance-import-migrator.spec.ts` — E2E harness impor via UI.

Kalau salah satu suite di atas gagal setelah bump versi, itu berarti kontrak
backward compat pecah. Perbaiki migrator, jangan longgarkan test.

## FAQ

**Kenapa `radius`/`bgOverlay`/`bgBlur` disimpan sebagai string di v1?**
Warisan dari `localStorage` yang hanya menyimpan string. Ekspor v1 langsung
meneruskan nilai LS mentah. `pickNumber` mengonversi lewat `Number(x)`,
jadi baik string maupun number diterima di semua versi.

**Kenapa `compact` tetap di root pada v2?**
`compact` juga dipublikasikan sebagai event global (`COMPACT_MODE_EVENT`)
dan dibaca oleh layout non-settings. Menyimpannya di root memperjelas
bahwa nilainya adalah preferensi aplikasi, bukan hanya "tampilan".

**Kenapa importer tidak menolak file `forward`?**
Menolak akan menjebak pengguna yang men-downgrade aplikasi (mis. rollback
setelah update bermasalah). Memuat field yang dikenal + memberi peringatan
lebih ramah dan sesuai prinsip "backward-compatible selalu".
