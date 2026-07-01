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