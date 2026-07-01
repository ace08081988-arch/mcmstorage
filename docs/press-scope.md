# Reaksi sentuh (`data-press-scope`) & opt-out

## Daftar isi kode `PA00X`

Loncat cepat dari kode di console ke bagian docs yang relevan. Tiap
kode punya tiga anchor kanonis: **baris tabel ringkasan**, **cheat-sheet
anchor**, dan **checklist implementasi** (bila ada).

| Kode  | Rule                           | Ringkasan                                                                 | Cheat-sheet                                                                                              | Checklist / bacaan lain                                                                                       |
| ----- | ------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [PA001](#ringkasan-cepat) | `radix-animated-surface`         | [row tabel](#ringkasan-cepat)                                              | [`#radix-dialog--sheet--popover`](#radix-dialog--sheet--popover) · [`#dropdownmenu--select`](#dropdownmenu--select) | [Checklist Radix Dialog](#radix-dialog--sheet--alertdialog--popover) · [Checklist DropdownMenu](#radix-dropdownmenu--select--contextmenu) |
| [PA002](#ringkasan-cepat) | `motion-whiletap-wraps-button`   | [row tabel](#ringkasan-cepat)                                              | [`#shadcn-button-di-scope-press`](#shadcn-button-di-scope-press) · [`#shadcn-button-di-dalam-motiondiv-framer-motion`](#shadcn-button-di-dalam-motiondiv-framer-motion) | [Checklist Button + motion](#shadcn-button-di-dalam-motiondiv-framer-motion)                                   |
| [PA003](#ringkasan-cepat) | `sortable-handle`                | [row tabel](#ringkasan-cepat)                                              | [`#sortable--drag-handle`](#sortable--drag-handle) · [`#sortable--drag-handle-dnd-kit-react-sortable-dll`](#sortable--drag-handle-dnd-kit-react-sortable-dll) | [Checklist Sortable](#sortable--drag-handle-dnd-kit-react-sortable-dll)                                        |
| [PA004](#ringkasan-cepat) | `destructive-menuitem`           | [row tabel](#ringkasan-cepat)                                              | [`#dropdownmenu--select`](#dropdownmenu--select) · [`#radix-dropdownmenu--select--contextmenu`](#radix-dropdownmenu--select--contextmenu) | [Checklist DropdownMenu](#radix-dropdownmenu--select--contextmenu)                                             |
| PA005+ | *belum dialokasikan*             | —                                                                          | —                                                                                                        | [Menambahkan rule baru (PA005+)](#menambahkan-rule-baru-pa005)                                                 |
| [PA000](#kode-error-press-audit) | `unknown-rule` *(fallback)*     | [Kode error press-audit](#kode-error-press-audit)                          | —                                                                                                        | [Menambahkan rule baru (PA005+)](#menambahkan-rule-baru-pa005)                                                 |

> Bagian pendukung: [Ringkasan cepat](#ringkasan-cepat) ·
> [Anchor cheat-sheet](#anchor-cheat-sheet-klik-ke-bagian-docs) ·
> [Format warning console](#kode-error-press-audit) ·
> [Tuning per section](#tuning-per-section-allowlistdenylist--mode) ·
> [Mode `suggest`](#mode-suggest-auto-usul-perbaikan-per-section).

---

## Cheat-sheet atribut: `data-press-audit-skip` & `data-press-audit`

Ringkasan terpisah supaya bisa disalin cepat tanpa membaca seluruh
dokumen. Referensi lengkap tetap di
[Opt-out via atribut DOM (per section)](#opt-out-via-atribut-dom-per-section)
dan [Prioritas evaluasi](#prioritas-evaluasi-satu-section-banyak-atribut).

### `data-press-audit-skip` — tolak rule tertentu di sub-pohon

Nilai: satu atau beberapa kode `PA00X` (dipisah spasi/koma). Efek: **union**
dengan skip dari parent (aditif — tidak bisa "unskip"). Kode tak dikenal
memicu `console.warn` `PA000`.

```tsx
// 1) Satu rule di satu section — matikan warning Radix animated surface saja.
<section data-press-audit-skip="PA001">
  <Dialog>…</Dialog>
</section>

// 2) Beberapa rule sekaligus (spasi atau koma sama-sama valid).
<main data-press-audit-skip="PA001 PA003">
  <SortableList />
  <SettingsDialog />
</main>

// 3) Nested — child menambah tolakan tanpa menghapus milik parent.
<div data-press-audit-skip="PA002">        {/* parent: skip PA002 */}
  <div data-press-audit-skip="PA004">      {/* efektif: {PA002, PA004} */}
    <DangerMenu />
  </div>
</div>

// 4) Kombinasi dengan mode `suggest`: tetap suggest, kecuali PA003 di list ini.
<ul data-press-audit="suggest" data-press-audit-skip="PA003">
  <SortableRow />
</ul>
```

**Anti-pola:**

```tsx
// ❌ Format non-PA### → warning PA000 "invalid token".
<div data-press-audit-skip="pa1, radix" />

// ❌ Kode belum dialokasikan (PA005+) → warning PA000 "unknown code".
<div data-press-audit-skip="PA042" />

// ❌ "Unskip" tidak didukung — parent PA001 tetap aktif di child.
<div data-press-audit-skip="PA001">
  <div data-press-audit-skip="">…</div>
</div>
```

### `data-press-audit` — mode per section

Nilai: `off` | `log` | `suggest` | `on` (alias `log`). Mengoverride
`window.__pressAuditConfig.mode` untuk sub-pohon. Tidak menghapus skip
yang diwarisi dari parent.

```tsx
// 1) Matikan audit sepenuhnya di satu section (mis. iframe preview / sandbox).
<section data-press-audit="off">
  <PreviewFrame />
</section>

// 2) Paksa mode `log` walau global di `off` — dipakai saat investigasi lokal.
<div data-press-audit="log">
  <ChatComposer />
</div>

// 3) Mode `suggest` — console + saran fix per rule (lihat mapping di docs).
<div data-press-audit="suggest">
  <UpdatesCarousel />
</div>

// 4) Kombinasi: suggest global untuk section, kecuali PA001 (Radix) & PA004.
<article data-press-audit="suggest" data-press-audit-skip="PA001 PA004">
  <ProductSettings />
</article>

// 5) Nested override — child mematikan audit di dalam parent yang `suggest`.
<div data-press-audit="suggest">
  <Sandbox data-press-audit="off" />
</div>
```

### Tabel keputusan cepat

| Tujuan                                              | Atribut yang dipakai                                              |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| Matikan **satu rule** di sub-pohon                  | `data-press-audit-skip="PA00X"`                                   |
| Matikan **beberapa rule** di sub-pohon              | `data-press-audit-skip="PA001 PA003"` (spasi/koma)                |
| Matikan **audit total** di sub-pohon                | `data-press-audit="off"`                                          |
| Paksa mode berbeda dari global                      | `data-press-audit="log"` / `"suggest"`                            |
| Suggest global, tapi tolak rule tertentu di section | `data-press-audit="suggest"` + `data-press-audit-skip="PA00X"`    |
| Nonaktifkan permanen di komponen                    | Gunakan `data-no-press` (bukan skip audit) — lihat [Opt-out per elemen](#opt-out-per-elemen-data-no-press) |

> Prioritas lengkap kalau atribut bertumpuk (parent vs child, DOM vs global
> config) ada di [Prioritas evaluasi](#prioritas-evaluasi-satu-section-banyak-atribut).

### Verifikasi otomatis contoh HTML (halaman demo)

Semua contoh HTML di dokumen ini bisa dijalankan otomatis di halaman dev
**`/dev/press-audit-demo`**. Halaman itu memasang setiap kombinasi
`data-press-audit` / `-skip` / `-allow` / `-deny` ke sub-pohon contoh,
memanggil helper publik `scanPressAuditFindings(root)`, lalu
membandingkan finding aktual vs yang diharapkan.

Snippet JavaScript minimum untuk melakukan hal yang sama di console
devtools (atau di E2E) — tanpa membuka halaman demo:

```js
// 1) Import helper (di kode aplikasi):
//    import { scanPressAuditFindings } from "@/lib/press-audit";
// 2) Atau di devtools, panggil audit manual:
window.__pressAudit?.();

// 3) Toggle aturan pada satu section secara programatik:
const host = document.querySelector('[data-testid="pa-demo-destructive-menuitem"]');

// Matikan seluruh audit di section ini:
host.setAttribute("data-press-audit", "off");

// Atau: matikan hanya PA004 (destructive-menuitem):
host.setAttribute("data-press-audit-skip", "PA004");

// Verifikasi hasilnya — expect [] (kosong) setelah skip dipasang:
import("@/lib/press-audit").then(({ scanPressAuditFindings }) => {
  const codes = scanPressAuditFindings(host).map((f) => f.code);
  console.assert(codes.length === 0, "harus kosong setelah skip PA004", codes);
});

// Nyalakan lagi (hapus atribut):
host.removeAttribute("data-press-audit");
host.removeAttribute("data-press-audit-skip");
```

Halaman demo mengekspos `window.__pressAuditDemoVerify()` untuk memicu
tombol **“Verifikasi semua preset”** di setiap kartu — cocok untuk
Playwright: navigasi ke `/dev/press-audit-demo`, panggil helper, lalu
cek atribut `data-pass="1"` pada tiap baris hasil.

---

Utilitas press MCM memberi feedback taktil (skala + shading) untuk elemen
interaktif. Ada dua cara aktivasi:

1. **Manual** — pasang kelas `press`, `press-card`, `press-row`, atau
   `press-fab` di elemen yang ingin bereaksi.
2. **Otomatis (scoped)** — pasang `data-press-scope="on"` di container.
   Semua elemen interaktif di dalamnya otomatis mendapat reaksi.

Elemen yang otomatis dicakup dalam scope:

- `button`, `a[href]`, `summary`, `label[for]`, `select`
- `input[type="button"|"submit"|"reset"|"checkbox"|"radio"|"file"|"image"|"color"|"range"]`
- `[role="button"|"link"|"menuitem"|"menuitemcheckbox"|"menuitemradio"|"tab"|"option"|"switch"|"checkbox"|"radio"|"treeitem"|"gridcell"|"combobox"]`

Sengaja **tidak** dicakup: `input[type="text|email|password|number|search|tel|url|date|…"]`
dan `textarea` — reaksi skala saat mengetik terasa mengganggu dan bisa
memicu shift caret.

`prefers-reduced-motion: reduce` (atau override manual `html.reduce-motion` /
`html[data-reduce-motion="on"]`) otomatis menonaktifkan skala + shading;
focus-ring tetap ada demi aksesibilitas keyboard.

## Opt-out per elemen: `data-no-press`

Tambahkan atribut `data-no-press` di elemen yang tidak boleh ikut bereaksi.
Cocok untuk:

- Kontrol dengan animasinya sendiri (Radix, Framer Motion).
- Drag handle atau sortable item — skala saat drag memicu jitter.
- Toggle label multi-langkah yang harus statis.
- Tombol di dalam kontainer yang sudah punya press variant lain (mencegah
  reaksi ganda).

### Contoh dasar

```tsx
<div data-press-scope="on" className="grid gap-2">
  <button>Simpan</button>                {/* ikut bereaksi */}
  <button data-no-press>Drag handle</button>  {/* dilewati */}
</div>
```

### Radix Dialog / Sheet / Popover

Komponen Radix punya animasi masuk-keluar sendiri lewat `data-state`
(`open` / `closed`). Menumpuk skala press di trigger atau tombol close
akan menabrak animasinya. Opt-out di kedua tempat:

```tsx
import * as Dialog from "@radix-ui/react-dialog";

<div data-press-scope="on">
  <Dialog.Root>
    {/* Trigger boleh tetap ikut press (feedback tap sebelum modal muncul).
        Kalau bentrok dengan animasi, opt-out: */}
    <Dialog.Trigger asChild>
      <button data-no-press>Buka</button>
    </Dialog.Trigger>

    <Dialog.Portal>
      {/* Overlay & content Radix punya keyframes sendiri — WAJIB opt-out.
          Portal me-render di luar scope, jadi biasanya aman, tapi bila
          ada scope global (mis. di `__root`), tetap tambahkan. */}
      <Dialog.Overlay data-no-press />
      <Dialog.Content data-no-press>
        …
        <Dialog.Close asChild>
          <button data-no-press>Tutup</button>
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
</div>
```

### DropdownMenu / Select

Item menu Radix ber-`role="menuitem"` **ikut** press scope. Reaksi ini
biasanya cocok, tapi kalau item punya highlight `data-highlighted` khusus
yang terlihat bertabrakan (mis. background berubah drastis), matikan:

```tsx
<DropdownMenu.Item data-no-press onSelect={…}>
  Hapus permanen
</DropdownMenu.Item>
```

### shadcn Button di scope press

shadcn `Button` sudah membawa `transition-colors` sendiri. Di dalam
`data-press-scope="on"` skala tetap muncul karena Radix tidak mengelola
transformasi. Ini sengaja dan aman — biarkan default. Opt-out hanya bila
tombol dipakai sebagai bagian dari animasi lain (mis. sedang `motion.div`
dengan `whileTap`).

```tsx
<motion.div whileTap={{ scale: 0.9 }}>
  <Button data-no-press>Custom animasi</Button>
</motion.div>
```

### Sortable / drag handle

```tsx
<li {...sortable.listeners} data-no-press>
  <GripVertical />
</li>
```

## Opt-out satu region

`data-no-press` hanya efektif pada elemen langsung yang match selector
press. Untuk mematikan seluruh sub-tree, cabut scope-nya:

```tsx
<section data-press-scope="on">
  … tombol biasa …
  <div data-press-scope="off">
    {/* Nested scope=off — child tetap tidak bereaksi karena selector
        hanya cocok saat data-press-scope="on". */}
    <SortableCanvas />
  </div>
</section>
```

> Selector CSS mencocokkan `[data-press-scope="on"]` secara literal, jadi
> `data-press-scope="off"` cukup untuk membatalkan scope di sub-tree tanpa
> perlu menempel `data-no-press` di setiap tombol.

## Debugging cepat

### Auditor otomatis (dev-mode)

`src/lib/press-audit.ts` dipasang otomatis saat `import.meta.env.DEV`.
Auditor memindai DOM (idle + `MutationObserver`) dan menulis peringatan
`[press-audit]` di console bila menemukan:

- Radix Overlay/Content bersuara `data-state` di dalam `data-press-scope="on"`.
- Elemen `motion.*` dengan `whileTap` (marker `data-whiletap="1"`) yang
  membungkus `<button>` tanpa `data-no-press`.
- Sortable/drag handle (`[data-dnd-handle]` atau
  `aria-roledescription*="sortable"`) tanpa `data-no-press`.
- Menu item destruktif (Hapus / Logout) tanpa `data-no-press`.

Panggil ulang manual dari console: `window.__pressAudit()`. Peringatan
di-dedupe per elemen — perbaiki dengan menambahkan atribut sesuai
checklist di atas.

> Tandai `motion.div` / `motion.button` yang punya `whileTap` dengan
> `data-whiletap="1"` supaya auditor bisa mendeteksinya (Framer Motion
> tidak mengekspos prop tsb ke DOM secara default).

- Tekan tombol, tapi tidak ada skala? Cek `getComputedStyle(el).transitionDuration`
  di DevTools — kalau `0s`, kemungkinan elemen ber-`disabled`, `aria-disabled="true"`,
  `data-no-press`, atau bukan salah satu tag/role yang dicakup.
- Skala muncul dua kali (kartu **dan** tombol di dalamnya bereaksi
  bersamaan)? Tambahkan `data-no-press` di kartu luar, biarkan tombol
  dalam yang bereaksi — atau sebaliknya, sesuai UX yang diinginkan.
- `prefers-reduced-motion` aktif tapi skala tetap muncul? Periksa
  `<html>`: pastikan tidak ada CSS override yang men-set `transform` di
  style inline dengan `!important`.

## Checklist implementasi per komponen

Checklist ringkas untuk memasang `data-no-press` secara konsisten. Terapkan
urut dari atas ke bawah; centang tiap baris saat komponen baru dibuat atau
di-refactor.

### Radix Dialog / Sheet / AlertDialog / Popover

- [ ] `Dialog.Overlay` → `data-no-press` (WAJIB — punya keyframes fade sendiri).
- [ ] `Dialog.Content` → `data-no-press` (WAJIB — punya keyframes zoom/slide).
- [ ] `Dialog.Close` (tombol X + tombol batal) → `data-no-press`.
- [ ] `Dialog.Trigger` → `data-no-press` **hanya** bila tombol terasa
      "dobel-animasi" saat modal terbuka; default biarkan ikut press.
- [ ] Jangan pasang `data-press-scope="on"` di dalam `Dialog.Content`
      kecuali seluruh isi form memang ingin bereaksi.

### Radix DropdownMenu / Select / ContextMenu

- [ ] `Menu.Content` → `data-no-press` (animasi masuk-keluar sendiri).
- [ ] `Menu.Item` destruktif (Hapus, Logout) → `data-no-press` supaya
      highlight `data-highlighted` tidak tabrakan dengan skala.
- [ ] `Menu.Item` biasa → biarkan default (ikut press).
- [ ] `Select.Trigger` → biarkan default; opt-out hanya bila dibungkus
      `motion.div`.

### shadcn `Button` di dalam `motion.div` (Framer Motion)

- [ ] `motion.div` yang punya `whileTap` / `whileHover` scale → child
      `Button` **wajib** `data-no-press` supaya skala tidak ditumpuk.
- [ ] `motion.button` langsung (tanpa wrapper) → `data-no-press` di
      elemen `motion.button` itu sendiri.
- [ ] `motion.div` tanpa `whileTap` → tidak perlu opt-out.
- [ ] Verifikasi cepat: `getComputedStyle(btn).transform` saat ditekan
      harus menunjukkan **satu** matrix, bukan dua transform bertumpuk.

### Sortable / drag handle (`@dnd-kit`, `react-sortable`, dll.)

- [ ] Elemen yang menerima `{...listeners}` / `{...attributes}` →
      `data-no-press` (skala saat drag = jitter + offset pointer salah).
- [ ] Container item yang men-transform saat drag (`transform: CSS.Transform.toString(...)`)
      → `data-no-press` di root item.
- [ ] Tombol aksi **di dalam** item (edit, hapus) → biarkan default;
      hanya handle-nya yang opt-out.
- [ ] Untuk canvas sortable kompleks, cabut scope: bungkus dengan
      `<div data-press-scope="off">` sekali saja.

### Snippet template

```tsx
// Radix Dialog
<Dialog.Overlay data-no-press />
<Dialog.Content data-no-press>
  <Dialog.Close data-no-press>×</Dialog.Close>
</Dialog.Content>

// DropdownMenu destruktif
<DropdownMenu.Content data-no-press>
  <DropdownMenu.Item data-no-press onSelect={onDelete}>Hapus</DropdownMenu.Item>
</DropdownMenu.Content>

// Button dalam motion.div dengan whileTap
<motion.div whileTap={{ scale: 0.94 }}>
  <Button data-no-press>Kirim</Button>
</motion.div>

// Sortable handle
<li ref={setNodeRef} style={style} data-no-press>
  <button {...listeners} {...attributes} data-no-press aria-label="Geser">
    <GripVertical />
  </button>
  <Button size="sm">Edit</Button>  {/* tetap ikut press */}
</li>
```

## Kode error press-audit

Setiap warning dari `src/lib/press-audit.ts` diawali kode stabil supaya
mudah difilter di devtools (ketik `PA00` di panel Console) dan
dijadikan tautan langsung ke bagian dokumentasi ini.

### Ringkasan cepat

| Kode  | Rule                        | Apa yang dideteksi                                                                 | Saran singkat                                                          | Bacaan lengkap |
| ----- | --------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------- |
| PA001 | `radix-animated-surface`    | Radix `Dialog`/`Sheet`/`Popover`/`DropdownMenu` trigger/content di dalam scope press tanpa `data-no-press`. Skala press menabrak animasi `data-state=open/closed`. | Pasang `data-no-press` di **Trigger** dan **Content** Radix.            | [Radix Dialog / Sheet / Popover](#radix-dialog--sheet--popover) · [DropdownMenu / Select](#dropdownmenu--select) |
| PA002 | `motion-whiletap-wraps-button` | `motion.div whileTap={{ scale }}` membungkus `<button>` / `shadcn Button` — skala tap ganda (Framer Motion + press-scope). | Hapus `whileTap` **atau** `data-no-press` di child button (pilih satu). | [shadcn Button di scope press](#shadcn-button-di-scope-press) · [Checklist](#shadcn-button-di-dalam-motiondiv-framer-motion) |
| PA003 | `sortable-handle`           | Drag handle (`@dnd-kit`, `react-sortable`, dst.) tanpa `data-no-press` — skala saat drag memicu jitter/mismatch pointer. | `data-no-press` **pada handle-nya**, bukan container sortable-nya.      | [Sortable / drag handle](#sortable--drag-handle) · [Checklist](#sortable--drag-handle-dnd-kit-react-sortable-dll) |
| PA004 | `destructive-menuitem`      | `DropdownMenu.Item` / `ContextMenu.Item` bergaya destruktif (`text-destructive`, `variant="destructive"`) di scope press. Radix sudah punya highlight sendiri. | `data-no-press` di `MenuItem` destruktif tsb.                          | [DropdownMenu / Select](#dropdownmenu--select) · [Checklist](#radix-dropdownmenu--select--contextmenu) |
| PA000 | `unknown-rule` *(fallback)* | Auditor pihak ketiga / kode lama yang belum register `code` → dilempar ke fallback. Muncul hanya kalau ada rule custom yang belum diberi ID stabil. | Tambahkan entri di `RULE_META` (`src/lib/press-audit.ts`) dengan kode `PA00X` unik + anchor docs. | [Menambahkan rule baru](#menambahkan-rule-baru-pa005) |

> **Status registry PA00X.** Kode aktif saat ini: `PA001`–`PA004`.
> `PA005` dan seterusnya **belum dialokasikan** — sengaja kosong supaya
> next rule dapat kode berurutan tanpa gap. Jangan mengarang kode di
> luar tabel ini; auditor tidak akan mengenalinya dan akan jatuh ke
> `PA000`. Untuk menambah rule baru, lihat panduan di bawah.

### Anchor cheat-sheet (klik ke bagian docs)

- PA001 → [`#radix-dialog--sheet--popover`](#radix-dialog--sheet--popover),
  [`#dropdownmenu--select`](#dropdownmenu--select)
- PA002 → [`#shadcn-button-di-scope-press`](#shadcn-button-di-scope-press),
  [`#shadcn-button-di-dalam-motiondiv-framer-motion`](#shadcn-button-di-dalam-motiondiv-framer-motion)
- PA003 → [`#sortable--drag-handle`](#sortable--drag-handle),
  [`#sortable--drag-handle-dnd-kit-react-sortable-dll`](#sortable--drag-handle-dnd-kit-react-sortable-dll)
- PA004 → [`#dropdownmenu--select`](#dropdownmenu--select),
  [`#radix-dropdownmenu--select--contextmenu`](#radix-dropdownmenu--select--contextmenu)
- PA005+ → *belum dialokasikan* (lihat [Menambahkan rule baru](#menambahkan-rule-baru-pa005))
- PA000 → fallback tanpa anchor spesifik → [Kode error press-audit](#kode-error-press-audit)

Warning di console juga menyematkan anchor ini di field `docs`, sehingga
`console.warn` bisa langsung diklik untuk melompat ke bagian yang tepat
bila docs dibuka di GitHub/preview markdown.

Format tiap baris warning:

```
[press-audit PA00X] <saran perbaikan> · docs: docs/press-scope.md#<anchor>
  ↳ arg ke-2: elemen DOM asli (klik untuk highlight di Elements panel)
  ↳ arg ke-3: { code, rule, docs, tag, id, testid, role, cls }
```

### Menambahkan rule baru (PA005+)

Alur baku supaya kode PA00X tetap stabil & terdokumentasi:

1. Pilih kode berikutnya yang berurutan (`PA005`, lalu `PA006`, dst.) —
   **jangan menggunakan ulang** kode yang sudah pernah dipakai walau
   rule-nya dihapus.
2. Daftarkan di `RULE_META` pada `src/lib/press-audit.ts`:

   ```ts
   const RULE_META: Record<string, { code: string; docs: string }> = {
     // ...existing...
     "nama-rule-baru": {
       code: "PA005",
       docs: `${DOCS_BASE}#anchor-heading-baru`,
     },
   };
   ```
3. Tambahkan heading `### Anchor heading baru` di dokumen ini (slug
   GitHub: lowercase, spasi → `-`, tanda baca dihilangkan) dan
   masukkan barisnya ke tabel [Ringkasan cepat](#ringkasan-cepat)
   sekaligus [Anchor cheat-sheet](#anchor-cheat-sheet-klik-ke-bagian-docs).
4. Update string `PA001-PA004` di `src/lib/press-audit.ts` (baris
   filter devtools) menjadi range terbaru.
5. Jalankan sekali di preview: `window.__pressAudit()` — pastikan
   warning baru muncul dengan `code: "PA005"` dan tautan docs valid.

## Tuning per section (allowlist/denylist & mode)

Auditor bisa disetel runtime tanpa reload. Konfigurasi disimpan di
`localStorage["press-audit:config"]`.

```ts
// Panggil dari devtools console
window.__pressAuditConfig.get();      // baca konfigurasi aktif
window.__pressAuditConfig.set({ mode: "off" });          // matikan
window.__pressAuditConfig.set({ mode: "suggest" });      // + marker DOM
window.__pressAuditConfig.set({
  rules: { allow: ["PA002", "sortable-handle"] },        // whitelist
});
window.__pressAuditConfig.set({
  rules: { deny: ["destructive-menuitem"] },             // blacklist
});
window.__pressAuditConfig.set({
  scope: { allow: ["main"], deny: ['[data-lovable-preview]'] },
});
window.__pressAuditConfig.reset();    // kembali ke default
```

### Mode

| Mode      | Efek                                                                 |
| --------- | -------------------------------------------------------------------- |
| `off`     | Tidak scan, tidak log — biaya nol.                                   |
| `log`     | Default. Hanya `console.warn` terstruktur, tidak menyentuh DOM.      |
| `suggest` | Selain log, memasang `data-press-audit-suggest="<PA00X>"` pada tiap  |
|           | elemen yang bermasalah — memudahkan filter visual di Elements panel. |

### Opt-out via atribut DOM (per section)

Selain konfigurasi global, section tertentu bisa mematikan auditor
tanpa menyentuh `localStorage`:

```tsx
// Skip semua rule di dalam subtree ini
<section data-press-audit="off"> ... </section>

// Skip rule tertentu (nama rule atau kode PA00X, dipisah koma/spasi)
<section data-press-audit-skip="PA001, motion-whiletap-wraps-button">
  ...
</section>
```

**Validasi token.** Auditor memeriksa isi `data-press-audit-skip`,
`data-press-audit-allow`, dan `data-press-audit-deny` saat dievaluasi
dan menulis `console.warn` sekali per host + (atribut, token) unik bila
menemukan:

- Format tidak cocok pola `PA###` — contoh: `PA01`, `pa-002`, `PA1`.
  Pesan: `token dengan format salah: "PA01". Pakai pola PA### (tiga
  digit, mis. PA001) atau nama rule terdaftar.`
- Kode `PA###` yang valid formatnya tetapi belum dialokasikan — contoh:
  `PA042`. Pesan menyertakan daftar kode yang dikenal saat ini.
- Nama rule yang tidak terdaftar — contoh: `radix-animatd-surface`
  (salah ketik). Pesan menyertakan daftar rule terdaftar.

Semua warning memakai kode `PA000` supaya bisa difilter di devtools dan
tetap membawa link ke bagian docs yang relevan
([kode error](#kode-error-press-audit) · [menambahkan rule baru](#menambahkan-rule-baru-pa005)).

Pesan warning selalu mencantumkan nama atribut sumbernya, jadi salah
ketik di `-allow`/`-deny` tidak menyamar sebagai warning `-skip`. Contoh:

```
[press-audit PA000] data-press-audit-allow="PA042" merujuk kode PA### yang
belum dialokasikan: "PA042". Kode yang dikenal: PA001, PA002, PA003, PA004.
```

**Dedup warning.** Kunci dedup adalah tuple **(host element, atribut,
raw value atribut, token)**. Konsekuensinya:

- Dua host berbeda dengan token salah yang sama → masing-masing di-warn
  sekali (WeakMap per host tidak dipakai bersama).
- Host yang sama dengan dua token berbeda pada satu atribut (mis.
  `data-press-audit-skip="PA01 PA02"`) → dua warning terpisah.
- Isi atribut diubah saat dev/HMR (mis. `"PA01"` → `"PA02"`) → warning
  baru muncul karena raw value ikut sebagai kunci, walau host-nya sama.
- Atribut berbeda dengan token sama (mis. `-allow="PA042"` dan
  `-deny="PA042"` pada host yang sama) → tetap dua warning, karena nama
  atribut jadi bagian kunci dedup.

### Prioritas evaluasi (satu section, banyak atribut)

Kalau satu subtree memasang lebih dari satu mekanisme (mis. `data-press-audit="on"`
di root section, `data-press-audit-skip="PA002"` di list-nya, plus
`allow/deny` dari `window.__pressAuditConfig`), auditor mengevaluasi dari
**paling spesifik ke paling umum** dan **berhenti pada keputusan pertama**.

Urutan pasti (tertinggi menang):

1. **`data-press-audit="off"` terdekat** — mematikan seluruh audit di subtree.
   Nilai `"on"` di ancestor tidak bisa meng-override `"off"` yang lebih dekat
   ke node. `"on"` hanya berguna untuk *menyalakan kembali* di dalam scope
   yang sebelumnya `"off"`.
2. **`data-press-audit-skip="PA00X"` gabungan** — semua atribut skip dari
   node target sampai root **di-union**. Nested skip menambah, tidak
   menimpa. Contoh: parent `skip="PA001"` + child `skip="PA002"` → child
   melewati `PA001` DAN `PA002`.
3. **Global `denyRules` (`window.__pressAuditConfig`)** — kode/nama rule di
   `denyRules` selalu diabaikan, walaupun ada di `allowRules`.
4. **Global `allowRules`** — kalau `allowRules` ter-set (non-empty), hanya
   rule di daftar itu yang dievaluasi; sisanya di-skip. Kosong = semua rule
   aktif (kecuali yang di-deny).
5. **Global `denyScopes` / `allowScopes`** — filter berbasis selector CSS,
   diuji terhadap `element.closest(selector)`. Aturan sama seperti
   rule: `deny` menang atas `allow`.
6. **Mode (`off` / `log` / `suggest`)** — kalau semua filter di atas
   meloloskan rule, mode menentukan efek akhir (senyap, `console.warn`, atau
   `console.warn` + atribut `data-press-audit-suggest`/`-fix`).

Tabel keputusan cepat:

| Situasi                                                                                     | Hasil                                                                             |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Parent `data-press-audit="off"`, child `data-press-audit-skip="PA002"`                      | Semua rule OFF (langkah 1 menang, skip tak dipakai)                               |
| Parent `data-press-audit="off"`, child `data-press-audit="on"`                              | Child audit ON kembali; skip/allow/deny berlaku                                   |
| `denyRules: ["PA002"]` + `data-press-audit-skip="PA001"` di section                         | Section skip PA001 & PA002; rule lain jalan                                       |
| `allowRules: ["PA001"]` + section tanpa atribut                                             | Hanya PA001 diaudit                                                               |
| `allowRules: ["PA001"]` + `denyRules: ["PA001"]`                                            | PA001 di-skip (deny menang)                                                       |
| `data-press-audit-skip="PA001"` di parent + child punya `skip="PA002"`                      | Child skip PA001 + PA002 (union, bukan override)                                  |
| `data-press-audit-allow="PA001"` di section, tanpa atribut lain                             | Di subtree hanya PA001 lolos; PA002/PA003/PA004 di-skip                           |
| `data-press-audit-allow="PA001 PA002"` + `data-press-audit-deny="PA001"` di section yg sama | PA001 di-skip (deny menang), hanya PA002 lolos                                    |
| `data-press-audit-allow="PA001 PA002"` + `data-press-audit-skip="PA001"` di section yg sama | Sama seperti di atas — `skip` diperlakukan setara `deny` (union) → PA001 di-skip  |
| Parent `data-press-audit-allow="PA001 PA002"` + child `data-press-audit-allow="PA002"`      | Union whitelist = {PA001, PA002}. Child TIDAK mempersempit (allow bersifat aditif) |
| Parent `data-press-audit-allow="PA001"` + child `data-press-audit-deny="PA001"`             | PA001 di-skip di subtree child (deny menang di path), tak ada rule lain yg lolos  |
| Parent `data-press-audit-deny="PA002"` + child `data-press-audit-allow="PA002"`             | PA002 tetap di-skip (deny ancestor menang atas allow lokal)                       |
| `data-press-audit-allow="PA001"` di section + global `allowRules: ["PA002"]`                | Rule harus lolos DUA gerbang: hanya PA002 yg lolos global TAPI PA002 di luar allow DOM → **tidak ada** rule terpicu di section |
| `data-press-audit-deny="PA001"` di section + global `allowRules: ["PA001"]`                 | Section senyap (PA001 di-deny DOM; rule lain di luar allow global)                |
| `mode: "off"` global                                                                        | Semua langkah di atas tetap dievaluasi, tapi tanpa efek konsol/DOM                |

> `data-press-audit-allow` dan `data-press-audit-deny` mengikuti aturan
> yang sama dengan padanan globalnya: **deny ∪ skip menang atas allow**,
> dan **semua atribut di sepanjang ancestor path di-union** (tidak ada
> override / unskip / unallow). Untuk lolos, sebuah rule harus:
> (a) tidak muncul di deny/skip mana pun di path, dan
> (b) muncul di semua whitelist yang aktif (DOM allow + global `allowRules`).

> Ringkas: **atribut DOM > konfigurasi global**, dan dalam masing-masing
> tingkatan **`deny`/`off`/`skip` > `allow`/`on`**. `skip` bersifat aditif,
> tidak pernah menghapus skip dari ancestor.

#### Contoh HTML lengkap untuk tiap kombinasi prioritas

Semua contoh di bawah bisa disalin apa adanya ke DevTools > Elements
untuk memverifikasi urutan prioritas. Setiap blok menyertakan komentar
`efektif:` yang menyimpulkan hasil audit pada elemen target.

##### Tabel ringkasan prioritas (A–J)

Tabel ini memetakan tiap konflik ke contoh yang mendemonstrasikannya.
Baca kolom kiri → kanan sebagai urutan evaluasi: **atribut DOM
terdekat** dulu (off/on, skip, deny, allow), baru **konfigurasi
global** (`__pressAuditConfig`), baru **scope selectors**. Dalam tiap
tingkat, `deny`/`off`/`skip` selalu menang atas `allow`/`on`; `skip`
bersifat aditif dan tidak pernah dihapus oleh child.

| Konflik                                              | Yang menang                          | Hasil ringkas                                    | Contoh |
| ---------------------------------------------------- | ------------------------------------ | ------------------------------------------------ | ------ |
| `data-press-audit="off"` (parent) vs `-skip` (child) | DOM `off` terdekat                   | Semua rule di sub-pohon dimatikan                | (A)    |
| `off` (parent) vs `on` (child)                       | DOM `on` terdekat (child membalik)   | Audit menyala lagi di sub-pohon child            | (B)    |
| `-skip` parent vs `-skip` child                      | Aditif (union), tak ada unskip       | Gabungan token skip diwariskan ke child          | (C)    |
| `allowRules` vs `denyRules` (global)                 | `denyRules`                          | Kode yang di-deny dibuang meski di allowlist     | (D)    |
| Atribut DOM `-skip` vs `allowRules` global           | DOM `-skip`                          | Skip DOM memotong allowlist global               | (E)    |
| `allowScopes` vs `denyScopes` (selector CSS)         | `denyScopes` untuk ancestor cocok    | Sub-pohon deny senyap, sisanya ikut allowScopes  | (F)    |
| `mode="suggest"` global vs `-skip` per section       | `-skip` untuk kode yg didaftarkan    | Rule di-skip senyap; sisanya tetap `suggest`     | (G)    |
| `-skip` (parent) vs `data-press-audit="on"` (child)  | `-skip` tetap diwariskan             | `on` hanya membalik `off`, bukan `skip`          | (H)    |
| `mode="off"` global vs atribut DOM                   | `mode` global (tanpa output)         | Evaluasi tetap berjalan, tapi tak ada log/DOM    | (I)    |
| Kombinasi penuh: `off→on`, `skip`, `deny`, `allow`   | Urutan 1→6 (lihat kolom "Hasil")     | 1) off/on 2) skip 3) deny 4) allow 5) scope 6) mode | (J) |

> Contoh (A)–(J) ada di blok HTML tepat di bawah tabel ini. Setiap blok
> membawa komentar `efektif:` yang menyebut kode PA00X final yang
> muncul. Halaman demo `/dev/press-audit-demo` menjalankan verifikasi
> otomatis untuk sebagian besar kombinasi ini.

```html
<!-- (A) off terdekat menang atas skip di child -->
<!-- Global: mode="log", allowRules=[], denyRules=[] -->
<section data-press-audit="off">
  <div data-press-audit-skip="PA002">
    <button class="press">Simpan</button>
    <!-- efektif: SEMUA rule OFF (langkah 1). skip PA002 tak dievaluasi. -->
  </div>
</section>
```

```html
<!-- (B) child menyalakan ulang audit di dalam parent off -->
<section data-press-audit="off">
  <aside data-press-audit="on" data-press-audit-skip="PA001">
    <div role="dialog">…</div>
    <!-- efektif: audit ON, skip={PA001}. PA002/PA003/PA004 tetap jalan. -->
  </aside>
</section>
```

```html
<!-- (C) skip aditif (union) antara parent dan child, tanpa unskip -->
<div data-press-audit-skip="PA001">
  <div data-press-audit-skip="PA002 PA004">
    <div data-press-audit-skip="">
      <button class="press">Hapus</button>
      <!-- efektif: skip={PA001, PA002, PA004}. String kosong TIDAK meng-unskip. -->
    </div>
  </div>
</div>
```

```html
<!-- (D) denyRules global menang atas allowRules global -->
<script>
  window.__pressAuditConfig?.set({
    mode: "log",
    allowRules: ["PA001", "PA002"],
    denyRules:  ["PA001"],
  });
</script>
<main>
  <div role="dialog">…</div>
  <!-- efektif: hanya PA002 diaudit. PA001 di-deny, PA003/PA004 di luar allow. -->
</main>
```

```html
<!-- (E) atribut DOM menang atas allowRules global -->
<script>
  window.__pressAuditConfig?.set({ mode: "log", allowRules: ["PA001"] });
</script>
<section data-press-audit-skip="PA001">
  <div role="dialog">…</div>
  <!-- efektif: skip PA001 (DOM) + allow hanya PA001 (global)
       → tidak ada rule yang lolos. Section senyap. -->
</section>
```

```html
<!-- (F) allowScopes + denyScopes (selector CSS) -->
<script>
  window.__pressAuditConfig?.set({
    mode: "log",
    allowScopes: ["main[data-page='chat']"],
    denyScopes:  ["[data-preview-frame]"],
  });
</script>
<main data-page="chat">
  <div role="dialog">…</div>              <!-- diaudit (masuk allowScope) -->
  <iframe data-preview-frame>
    <div role="dialog">…</div>            <!-- di-skip (denyScope menang) -->
  </iframe>
</main>
<main data-page="settings">
  <div role="dialog">…</div>              <!-- di-skip (di luar allowScope) -->
</main>
```

```html
<!-- (G) suggest global + skip per section (mempertahankan saran fix untuk sisanya) -->
<script>
  window.__pressAuditConfig?.set({ mode: "suggest" });
</script>
<article data-press-audit-skip="PA001 PA004">
  <div role="dialog">…</div>              <!-- PA001 di-skip; sisanya suggest -->
  <div role="menu">
    <div role="menuitem" class="text-destructive">Hapus akun</div>
    <!-- PA004 di-skip; PA002/PA003 tetap menghasilkan console.warn + saran -->
  </div>
</article>
```

```html
<!-- (H) on di child tidak meng-unskip ancestor; hanya membalik "off" -->
<div data-press-audit-skip="PA001">
  <div data-press-audit="on">
    <div role="dialog">…</div>
    <!-- efektif: audit ON, tapi PA001 tetap di-skip (skip diwariskan). -->
  </div>
</div>
```

```html
<!-- (I) mode=off global — atribut DOM tetap dievaluasi tapi tanpa efek -->
<script>
  window.__pressAuditConfig?.set({ mode: "off" });
</script>
<section data-press-audit="on" data-press-audit-skip="PA002">
  <div role="dialog">…</div>
  <!-- efektif: keputusan filter berjalan, tapi mode=off ⇒ tak ada console/DOM output. -->
</section>
```

```html
<!-- (J) prioritas penuh: off (parent) → on (child) → skip → deny → allow → mode -->
<script>
  window.__pressAuditConfig?.set({
    mode: "suggest",
    allowRules: ["PA001","PA002","PA003","PA004"],
    denyRules:  ["PA003"],
  });
</script>
<section data-press-audit="off">                          <!-- (1) OFF -->
  <div data-press-audit="on" data-press-audit-skip="PA002"><!-- (1) ON kembali, (2) skip PA002 -->
    <div>
      <!-- (3) denyRules → PA003 dibuang -->
      <!-- (4) allowRules → sisanya (PA001, PA004) lolos -->
      <!-- (6) mode=suggest → warn + data-press-audit-suggest -->
      <div role="dialog">…</div>
      <!-- efektif: hanya PA001 & PA004 yang muncul sebagai suggest. -->
    </div>
  </div>
</section>
```

> Verifikasi cepat: buka DevTools > Console, filter `PA00`, lalu hover
> tiap contoh. Jumlah warning yang muncul harus sesuai komentar
> `efektif:` di setiap blok.

### Resep per section (siap salin)

Skenario nyata di aplikasi + kombinasi atribut DOM dan
`window.__pressAuditConfig.set(...)` yang direkomendasikan.

#### 1. Halaman Chat — banyak Radix Dialog & motion overlay

Radix Content di Dialog attachment picker dan Sheet media viewer sering
memicu `PA001`. Overlay-nya sudah punya animasi sendiri, jadi audit
cukup dinonaktifkan di subtree tersebut, sementara rule lain tetap
jalan untuk seluruh halaman.

```tsx
// src/routes/_authenticated.chat.$conversationId.tsx
<main>
  <ChatHeader />
  <MessageList />
  {/* Skip hanya di subtree picker; halaman lain tetap diaudit */}
  <section data-press-audit-skip="PA001, PA004">
    <AttachmentPickerDialog />
    <MediaViewerSheet />
  </section>
</main>
```

#### 2. Halaman Pembaruan — carousel status pakai Framer Motion

Setiap card di carousel dibungkus `motion.div` dengan `whileTap` +
Button di dalamnya. Semua sudah punya `data-no-press`, tapi kalau nanti
ada card baru yang lupa, matikan `PA002` khusus di section itu supaya
dev tidak digangu peringatan berulang.

```tsx
// src/routes/_authenticated.pembaruan.tsx
<section aria-label="Status" data-press-audit-skip="PA002">
  <StatusCarousel />
</section>
```

#### 3. Halaman Produk — daftar sortable (dnd-kit)

Handle sortable secara sengaja tidak punya reaksi press. `PA003` masih
berguna sebagai reminder saat menambah handle baru, jadi biarkan aktif —
tapi kalau list panjang dan console berisik, batasi audit ke root
kontainer saja lewat `scope.allow`.

```ts
// Panggil sekali dari devtools untuk sesi debug halaman produk
window.__pressAuditConfig.set({
  scope: { allow: ["#produk-list"] },   // hanya scan subtree ini
  rules: { allow: ["PA003"] },          // fokus ke sortable handle
});
```

```tsx
// src/routes/_authenticated.produk.tsx
<main>
  <ProdukFilter />
  <ul id="produk-list">{/* dnd-kit sortable rows */}</ul>
</main>
```

#### 4. Halaman Pengaturan — banyak DropdownMenu destruktif

Menu "Hapus akun / Logout" memicu `PA004`. Kalau sudah dipastikan aman
dengan review manual, matikan aturan itu global tanpa menyentuh kode:

```ts
window.__pressAuditConfig.set({
  rules: { deny: ["PA004"] },
});
```

#### 5. Preview iframe Lovable — matikan audit di sandbox

Editor Lovable membungkus app di iframe dengan atribut khusus.
Skip domain itu supaya audit tidak jalan saat preview di editor,
tapi tetap aktif di build production/preview publik:

```ts
window.__pressAuditConfig.set({
  scope: { deny: ["[data-lovable-preview]", "[data-lovable-editor]"] },
});
```

#### 6. Investigasi fokus — hanya satu rule di satu section

Kombinasi atribut + config untuk sesi debugging singkat:

```tsx
<section id="qa-target" data-press-audit-skip="PA001,PA004">
  <ComponentUnderTest />
</section>
```

```ts
window.__pressAuditConfig.set({
  mode: "suggest",                       // pasang marker DOM
  rules: { allow: ["PA002"] },           // fokus 1 rule
  scope: { allow: ["#qa-target"] },      // fokus 1 subtree
});
window.__pressAudit();                   // trigger sweep manual
// Elements panel → filter attribute `data-press-audit-suggest="PA002"`
```

> Tip: jalankan `window.__pressAuditConfig.reset()` setelah selesai
> supaya sesi berikutnya kembali ke default (`mode: "log"`, tanpa
> allow/deny). Konfigurasi persist di `localStorage`, jadi tanpa reset
> pengaturan debug bisa kebawa ke sesi normal.

> **Update:** konfigurasi `__pressAuditConfig` **tidak lagi ditulis ke
> `localStorage`**. Default-nya `persist: "memory"` — hanya bertahan di
> halaman saat ini, ikut hangus saat refresh atau navigasi SPA. Jejak
> `localStorage` lama otomatis dibersihkan saat modul di-mount.
>
> Opsi tambahan pada `set(patch, opts)`:
>
> ```ts
> // hanya untuk halaman ini (default) — refresh = kembali default
> __pressAuditConfig.set({ mode: "suggest" });
>
> // bertahan selama tab masih terbuka (survive refresh, hilang saat close tab)
> __pressAuditConfig.set({ mode: "suggest" }, { persist: "session" });
>
> // TTL manual (default 30 menit) — auto reset setelahnya
> __pressAuditConfig.set({ mode: "suggest" }, { ttlMs: 5 * 60_000 });
>
> // matikan TTL & auto-reset saat navigasi
> __pressAuditConfig.set(
>   { mode: "suggest" },
>   { ttlMs: 0, resetOnNavigate: false },
> );
> ```
>
> Auto-reset dipicu oleh: (1) refresh / hard reload, (2) navigasi SPA
> (`pushState` / `replaceState` / `popstate`) kecuali
> `resetOnNavigate: false`, (3) TTL habis, (4) `close tab` untuk mode
> `session`.

### Cheat sheet allowlist / denylist

Kedua daftar menerima **nama rule** (`sortable-handle`) maupun **kode
error** (`PA003`) — dievaluasi case-insensitive untuk kode. Bila
`rules.allow` diisi, HANYA rule yang tercantum yang dilaporkan; setelah
itu `rules.deny` mengeliminasi lagi. Kombinasi keduanya = intersect.

#### Global (semua section)

```ts
// Hanya lapor sortable-handle di seluruh app
window.__pressAuditConfig.set({ rules: { allow: ["PA003"] } });

// Diam-kan destructive-menuitem & radix-animated-surface tanpa sentuh yg lain
window.__pressAuditConfig.set({ rules: { deny: ["PA001", "PA004"] } });

// Kombinasi: fokus ke motion + sortable, tapi kecualikan sortable di 1 subtree
window.__pressAuditConfig.set({
  rules: { allow: ["PA002", "PA003"] },
  scope: { deny: ["#legacy-sortable"] },
});
```

#### Per section via atribut DOM

`data-press-audit-skip` menerima daftar dipisah koma/spasi dan
mencampur nama rule dengan kode `PA00X`. Ancestor terdekat berlaku;
atribut dapat dipasang di elemen mana pun (`<section>`, `<div>`,
`<main>`, wrapper Radix, dst).

```tsx
// Tolak PA001 (radix-animated-surface) di dropdown filter
<div data-press-audit-skip="PA001">
  <DropdownMenu.Content>…</DropdownMenu.Content>
</div>

// Tolak PA002 & PA004 sekaligus di header
<header data-press-audit-skip="PA002, PA004">
  <motion.div whileTap={{ scale: 0.96 }}><Button>Menu</Button></motion.div>
  <DropdownMenu.Item className="text-destructive">Logout</DropdownMenu.Item>
</header>

// Nama rule + kode boleh dicampur
<section data-press-audit-skip="sortable-handle, PA001">
  <SortableList />
  <Dialog>…</Dialog>
</section>

// Matikan SEMUA rule di subtree
<aside data-press-audit="off">
  <ThirdPartyWidget />
</aside>
```

#### Kombinasi tipikal per halaman

| Halaman            | Global config                                   | Atribut DOM di section                                    |
| ------------------ | ----------------------------------------------- | --------------------------------------------------------- |
| Chat               | *(default)*                                     | `data-press-audit-skip="PA001, PA004"` di picker & sheet  |
| Pembaruan          | *(default)*                                     | `data-press-audit-skip="PA002"` di carousel status         |
| Produk (sortable)  | `rules: { allow: ["PA003"] }`                   | `data-press-audit="off"` di panel filter (tidak relevan)   |
| Pengaturan         | `rules: { deny: ["PA004"] }`                    | —                                                          |
| Preview iframe     | `scope: { deny: ["[data-lovable-preview]"] }`   | —                                                          |
| Sesi debug fokus   | `mode: "suggest", rules: { allow: ["PA002"] }`  | `data-press-audit-skip="PA001,PA004"` di area investigasi  |

> Aturan urutan evaluasi: `data-press-audit="off"` ▶ `scope.deny` ▶
> `scope.allow` (bila diisi) ▶ `rules.allow` (bila diisi) ▶ `rules.deny`
> ▶ `data-press-audit-skip`. Temuan hanya lolos bila lulus semua tahap.

### Mode `suggest`: auto-usul perbaikan per section

`mode: "suggest"` memperluas `mode: "log"`: audit tetap menulis
`console.warn` terstruktur, TAPI juga menempelkan atribut
`data-press-audit-suggest="PA00X"` dan `data-press-audit-fix="…"` di
node yang match. Nilai `fix` diturunkan dari rule yang cocok pada
section tersebut, jadi tiap section hanya menerima saran untuk rule
yang RELEVAN — rule yang di-deny atau di-skip via
`data-press-audit-skip` tidak dijadikan saran.

#### Aktivasi

```ts
window.__pressAuditConfig.set({ mode: "suggest" });
window.__pressAudit();               // trigger sweep manual
// DevTools → Elements → Ctrl/⌘+F: cari `data-press-audit-suggest`
// atau di Console:
document.querySelectorAll("[data-press-audit-suggest]")
  .forEach(el => console.log(
    el.getAttribute("data-press-audit-suggest"),
    el.getAttribute("data-press-audit-fix"),
    el,
  ));
```

#### Mapping rule → saran fix

| Kode  | Rule                     | Saran otomatis yang ditempel                                    |
| ----- | ------------------------ | --------------------------------------------------------------- |
| PA001 | radix-animated-surface   | `add data-no-press pada trigger + Content`                      |
| PA002 | motion-whileTap          | `hapus whileTap ATAU data-no-press di child button`             |
| PA003 | sortable-handle          | `data-no-press pada handle (jangan di container sortable)`      |
| PA004 | destructive-menuitem     | `data-no-press pada MenuItem (Radix sudah punya highlight)`     |

#### Menyempitkan saran ke satu section

Gabungkan `mode: "suggest"` dengan `scope.allow` atau
`rules.allow` — hanya rule yang lolos filter yang menghasilkan
atribut saran. Rule lain tetap dilewatkan diam-diam.

```ts
// Section produk (sortable) — hanya usulkan fix PA003
window.__pressAuditConfig.set({
  mode: "suggest",
  scope: { allow: ["[data-page='produk']"] },
  rules: { allow: ["PA003"] },
});

// Section chat — usulkan PA001 & PA004, abaikan motion di composer
window.__pressAuditConfig.set({
  mode: "suggest",
  scope: { allow: ["[data-page='chat']"] },
  rules: { allow: ["PA001", "PA004"], deny: ["PA002"] },
});

// Section pengaturan — usul semua kecuali destructive-menuitem
window.__pressAuditConfig.set({
  mode: "suggest",
  scope: { allow: ["[data-page='pengaturan']"] },
  rules: { deny: ["PA004"] },
});
```

#### Pola pemakaian di markup

Tandai section supaya `scope.allow` di atas mengunci sweep, dan pakai
`data-press-audit-skip` untuk subtree yang tidak perlu disarankan
meski rule-nya diizinkan secara global.

```tsx
<section data-page="chat">
  {/* Composer motion di sini SENGAJA — jangan disarankan */}
  <div data-press-audit-skip="PA002">
    <motion.div whileTap={{ scale: 0.97 }}>
      <Button>Kirim</Button>
    </motion.div>
  </div>

  {/* Sisa halaman: PA001/PA004 tetap dapat saran otomatis */}
  <MessageList />
  <ContextMenu />
</section>
```

#### Alur kerja yang direkomendasikan

1. Set `mode: "suggest"` + `scope.allow` untuk section yang sedang
   dikerjakan.
2. Jalankan `window.__pressAudit()` (atau reload dengan flag
   `?pressAudit=1`).
3. Di DevTools filter `data-press-audit-suggest` — tiap node punya
   `data-press-audit-fix` berisi instruksi copy-paste.
4. Terapkan fix, jalankan audit ulang. Node yang sudah benar akan
   kehilangan atribut sarannya secara otomatis pada sweep berikutnya.
5. Selesai: `window.__pressAuditConfig.reset()` untuk membersihkan
   konfigurasi dari `localStorage`.

#### Menolak rekomendasi rule tertentu per section (`data-press-audit-skip="PA00X"`)

Saat berjalan di `mode: "suggest"`, `data-press-audit-skip` bertindak
sebagai **filter saran per subtree**: rule yang tercantum tidak akan
menempelkan `data-press-audit-suggest` / `data-press-audit-fix` di node
anak, dan tidak akan muncul di `console.warn` untuk elemen di dalam
subtree tsb — sekaligus di section lain rule yang sama tetap
disarankan.

Nilai atribut menerima **kode `PA00X`**, **nama rule**, atau campuran
keduanya, dipisah koma/spasi. Case-insensitive untuk kode.

##### Aktifkan suggest global, tolak rule per section

```ts
// devtools console — aktifkan sekali di awal investigasi
window.__pressAuditConfig.set({ mode: "suggest" });
```

```tsx
{/* Chat: composer memang perlu whileTap → tolak PA002 di sini saja */}
<section data-page="chat" data-press-audit-skip="PA002">
  <MessageList />                       {/* PA001/PA004 tetap diusulkan */}
  <motion.div whileTap={{ scale: 0.97 }}>
    <Button>Kirim</Button>              {/* PA002 tidak diusulkan */}
  </motion.div>
</section>

{/* Produk: sortable disengaja pakai handle native → tolak PA003 */}
<section data-page="produk" data-press-audit-skip="PA003">
  <SortableList />
</section>

{/* Pengaturan: DropdownMenu destruktif adalah pola resmi → tolak PA004 */}
<section data-page="pengaturan" data-press-audit-skip="PA004">
  <DangerZoneMenu />                    {/* PA001 tetap diusulkan */}
</section>
```

##### Kombinasi beberapa kode dalam satu section

```tsx
{/* Preview builder: banyak overlay Radix + motion — tolak PA001 & PA002,
    tapi PA003/PA004 tetap disarankan bila muncul. */}
<section data-page="builder" data-press-audit-skip="PA001, PA002">
  <DesignCanvas />
</section>

{/* Setara — nama rule boleh dicampur dengan kode */}
<section data-press-audit-skip="radix-animated-surface PA002">
  <DesignCanvas />
</section>
```

##### Nested skip: parent luas, child menambah tolakan

`data-press-audit-skip` di ancestor terdekat berlaku kumulatif dari
atas ke bawah. Child boleh **menambah** rule yang ditolak, tapi tidak
bisa meng-*undo* skip parent — untuk itu pakai `data-press-audit="on"`
eksplisit di child (mengaktifkan kembali audit di subtree tsb, lalu
skip ulang selektif).

```tsx
<main data-press-audit-skip="PA001">     {/* seluruh halaman tolak PA001 */}
  <ProfileHeader />

  <section data-press-audit-skip="PA004">
    {/* subtree ini tolak PA001 + PA004 */}
    <DangerMenu />
  </section>

  <section data-press-audit="on" data-press-audit-skip="PA002">
    {/* audit aktif kembali di sini; hanya PA002 yang ditolak */}
    <ExperimentalArea />
  </section>
</main>
```

##### Verifikasi cepat di DevTools

Setelah sweep, jalankan di Console:

```js
// Node yang MASIH menerima saran (skip berhasil = tidak muncul di sini)
document.querySelectorAll("[data-press-audit-suggest]")
  .forEach(el => console.log(
    el.getAttribute("data-press-audit-suggest"), el,
  ));

// Cek ancestor terdekat yang men-skip sebuah node
$0?.closest("[data-press-audit-skip]")?.getAttribute("data-press-audit-skip");
```

> Aturan penting: `data-press-audit-skip` **tidak** menonaktifkan
> reaksi press-scope — hanya menekan saran auditor. Untuk mematikan
> reaksi press-nya, tetap pakai `data-no-press` di elemen target.