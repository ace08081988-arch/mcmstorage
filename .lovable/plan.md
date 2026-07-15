# Rename Kategori + E2E Konsistensi Beranda ↔ Gudang

## 1. Fitur rename (prasyarat E2E)

Tambahkan rename di baris kategori Beranda, dieksekusi lewat satu **server function** supaya update dua tabel atomik dan aman terhadap RLS.

**Server fn baru** `src/lib/warehouse.functions.ts` — `renameCategory({ oldName, newName })`, pakai `requireSupabaseAuth`:

```text
1. Normalisasi newName (trim, kolaps spasi). Tolak string kosong.
2. Cek duplikat case-insensitive di warehouse_categories
   (lower(btrim(name)) = lower(btrim(newName)) AND name <> oldName)
   → error "Nama kategori sudah dipakai".
3. UPDATE warehouse_categories SET name = newName WHERE user_id = uid AND name = oldName.
4. UPDATE warehouse_items   SET category = newName WHERE user_id = uid AND category ILIKE oldName.
5. Kembalikan { renamedItems: number }.
```

**UI Beranda** (`_authenticated.index.tsx`):
- Baris kategori dapat tombol pensil (icon-only, tidak mengganggu drag handle & tombol hapus).
- Klik → dialog input pre-filled + tombol Simpan; loading state saat pending; toast sukses ("N produk ikut di-rename") / error.
- Rename yang case-only (mis. `kristal` → `Kristal`) diperbolehkan — bandingkan dengan `lower(btrim(...))` terhadap kategori lain, bukan diri sendiri.

Beranda & Gudang auto-refresh via realtime yang sudah ada.

## 2. Test: Vitest integration (`tests/integration/warehouse-categories.test.ts`)

Runner sudah tersedia (`bunx vitest run`). Test fokus pada **kontrak data**, tidak render:

- **rename case-insensitive collision**: seed `kristal` + `Batu`. Panggil `renameCategory({ oldName: 'Batu', newName: 'KRISTAL' })` → throws "sudah dipakai". Row tidak berubah.
- **rename case-only allowed**: seed `kristal`. Rename → `Kristal`. Row ter-update.
- **rename cascades to items**: seed kategori `kristal` + 2 warehouse_items dengan category `Kristal` & `kristal`. Rename → `Kristal Premium`. Kedua items ikut ter-update (ILIKE match).
- **delete blocked when used**: seed kategori + 1 item memakai. `deleteCategory` (query yang sama dengan Beranda) → error, kategori masih ada.
- **delete allowed when unused**: hapus setelah rename item ke kategori lain → sukses.
- **add duplicate case-insensitive**: seed `kristal`, INSERT `KRISTAL` → error unique index.
- **position persists**: insert 3 kategori pos 0/1/2, tukar 0↔2 via UPDATE, SELECT ordered by position → urutan baru.

Setup pakai supabase service-role client via env test-only (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) untuk seed/cleanup; user id fixture disiapkan sekali di `beforeAll` dari auth.admin.createUser lalu delete di `afterAll`. Beri `describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)` supaya lokal tanpa key tidak crash.

## 3. Test: Playwright E2E (`tests/e2e/warehouse-categories.spec.ts`)

Ikuti pola storage-state yang sudah dipakai suite chat-pin (login sekali → `storageState.json`). Runner: `bunx playwright test`.

**Setup**:
- `tests/e2e/fixtures/auth.setup.ts` (kalau belum ada) — login user test → simpan storage.
- `playwright.config.ts` — projects: `setup` + `chromium` viewport 411×915 (device Ace).
- Setiap test bersih: nama kategori random (`kat_${uuid()}`) supaya paralel-safe; `afterEach` bersihkan via API.

**Skenario**:

1. **Tambah muncul di dua halaman**
   - Beranda → klik "Tambah kategori" → isi nama unik → assert chip muncul di list.
   - Buka `/gudang` → assert nama tampil di daftar grup StokTab (walau belum ada item, kategori muncul karena master list).

2. **Rename ikut di label produk Gudang**
   - Seed via API: 1 warehouse_items dengan `category = 'kat_A'`.
   - Beranda → rename `kat_A` → `kat_A_renamed`.
   - `/gudang` → tab Stok → assert grup baru bernama `kat_A_renamed` berisi produk seed; grup lama tidak ada.

3. **Hapus terblokir jika masih dipakai**
   - Seed: 1 item pakai `kat_B`. Beranda → klik hapus → assert toast error muncul, chip kategori tetap ada.
   - Hapus item via API → hapus lagi → sukses, chip hilang.

4. **Urutan (position) konsisten**
   - Beranda: buat 3 kategori C1, C2, C3.
   - Drag C3 ke posisi 1 (pakai `page.locator(...).dragTo(...)` + `hover force`). Assert urutan chip.
   - `/gudang` → assert grup muncul dalam urutan C3, C1, C2.

Waktu tunggu pakai `expect.toHaveText` bukan `waitForTimeout`.

## 4. Package & script

- `bun add -D @playwright/test` bila belum ada; jalankan `bunx playwright install chromium` di CI script.
- `package.json`:
  - `"test:integration": "vitest run tests/integration"`
  - `"test:e2e": "playwright test"`

## 5. Verifikasi

- `bunx tsgo --noEmit` bersih.
- `bunx vitest run tests/integration/warehouse-categories.test.ts` lulus lokal (skip kalau tanpa service key).
- Playwright dijalankan headless di sandbox pakai `LOVABLE_BROWSER_SUPABASE_*` — pastikan `LOVABLE_BROWSER_AUTH_STATUS=injected` sebelum test, bila `signed_out` laporkan dan minta Ace sign-in dulu di preview.

## 6. Catatan

- Rename cascade pakai ILIKE — konsisten dengan validator delete yang sudah ada.
- Server fn tunggal menghindari race UPDATE ganda dari client.
- Tidak ada perubahan schema baru; migrasi position + unique index sudah ada dari refactor sebelumnya.
