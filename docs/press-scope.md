# Reaksi sentuh (`data-press-scope`) & opt-out

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

### Anchor cheat-sheet (klik ke bagian docs)

- PA001 → [`#radix-dialog--sheet--popover`](#radix-dialog--sheet--popover),
  [`#dropdownmenu--select`](#dropdownmenu--select)
- PA002 → [`#shadcn-button-di-scope-press`](#shadcn-button-di-scope-press),
  [`#shadcn-button-di-dalam-motiondiv-framer-motion`](#shadcn-button-di-dalam-motiondiv-framer-motion)
- PA003 → [`#sortable--drag-handle`](#sortable--drag-handle),
  [`#sortable--drag-handle-dnd-kit-react-sortable-dll`](#sortable--drag-handle-dnd-kit-react-sortable-dll)
- PA004 → [`#dropdownmenu--select`](#dropdownmenu--select),
  [`#radix-dropdownmenu--select--contextmenu`](#radix-dropdownmenu--select--contextmenu)

Warning di console juga menyematkan anchor ini di field `docs`, sehingga
`console.warn` bisa langsung diklik untuk melompat ke bagian yang tepat
bila docs dibuka di GitHub/preview markdown.

Format tiap baris warning:

```
[press-audit PA00X] <saran perbaikan> · docs: docs/press-scope.md#<anchor>
  ↳ arg ke-2: elemen DOM asli (klik untuk highlight di Elements panel)
  ↳ arg ke-3: { code, rule, docs, tag, id, testid, role, cls }
```

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