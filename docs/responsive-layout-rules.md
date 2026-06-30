# Aturan Layout Responsif — Daftar Produk

Dokumen ini mengunci pola layout yang dipakai bersama oleh
`src/components/ReadyEcerSection.tsx` (kartu produk siap kirim) dan
`src/routes/_authenticated.gudang.tsx` (daftar stok per kategori),
plus harness visual `src/routes/lovable.visual.produk-list.tsx`.

Sasaran: tidak ada wrap/overflow/badge tergencet di 320 / 360 / 411 /
480 px maupun saat font scaling Android tinggi (130–200%).

---

## 1. Tiga aturan dasar untuk baris campuran teks + badge

Setiap baris yang berisi teks variabel **dan** widget berukuran tetap
(badge, ikon, avatar, chip jumlah, status) harus mengikuti pola
`flex` / `grid` dengan tiga primitif:

1. Container baris: `flex min-w-0` atau
   `grid grid-cols-[minmax(0,1fr)_auto]` bila benar-benar dua kolom.
2. Anak teks yang harus menyusut: `min-w-0 flex-1 truncate`.
3. Anak ukuran tetap: `shrink-0` + (jika berteks) `whitespace-nowrap`.

Tanpa `min-w-0` pada container teks, `truncate` tidak pernah aktif —
flex item default `min-width: auto` sehingga teks memaksa container
melebar dan menggencet badge tetangga.

---

## 2. Token tipografi tetap

Skala dikunci: `base → sm → xs → [11px]`, `leading-snug` untuk
paragraf dan `leading-none` untuk badge satu baris. Jangan menambah
ukuran ad-hoc (`text-[13px]`, `text-[10px]`, dst).

- Heading kartu: `text-base font-bold leading-snug`
- Label kolom / `EcerLabel`: `text-[11px] uppercase leading-none`
- Nilai utama: `text-sm font-semibold leading-snug tabular-nums`
- Subteks / `EcerMeta`: `text-[11px] leading-none text-muted-foreground`
- Badge / chip: `text-[11px] font-medium leading-none`

Angka di kolom kanan **selalu** `tabular-nums`.

---

## 3. Pola badge kanonik

`src/components/StatusBadge.tsx` untuk semua badge status. Badge
non-status (chip jumlah, "Aktif", "Target", "Cocok", dll.) mengikuti
bentuk yang sama:

```tsx
<span
  className="inline-flex h-5 max-w-[7rem] shrink-0 items-center
             rounded-full border bg-background px-1.5
             text-[11px] font-medium leading-none
             text-muted-foreground tabular-nums"
  title={fullText}
>
  <span className="min-w-0 truncate whitespace-nowrap">{label}</span>
</span>
```

Tetapan wajib:

- Tinggi tetap: `h-5` (chip kompak) atau `h-6` (badge utama hero).
- `leading-none`, bukan `leading-snug` — tinggi visual = tinggi kotak.
- `shrink-0` selalu, kecuali badge "isi kartu" (lihat §4a).
- `max-w-[7rem]` + `truncate` di anak span untuk membatasi label
  panjang saat font scaling 200%.
- `whitespace-nowrap` di anak span supaya tidak pernah wrap walau
  parent `flex-wrap`.
- `title={fullText}` agar isi penuh tetap terbaca via tooltip /
  long-press.

---

## 4. Pola spesifik yang sudah ditegakkan

### a. Pill "Cocok: produk + {n}{unit}" (`ReadyEcerSection.tsx`)

Chip "isi kartu" — boleh menyusut karena ada di kolom sempit:

```tsx
<button
  className="flex w-fit min-w-0 max-w-full items-center gap-1
             rounded-full bg-muted px-1.5 py-0.5
             text-[11px] font-medium leading-none text-muted-foreground"
  title={`Cocok: produk + ${target}${unit}`}
>
  <span className="h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
  <span className="min-w-0 flex-1 truncate whitespace-nowrap">
    Cocok: produk + {target}{unit}
  </span>
</button>
```

Beda dari §3: `flex min-w-0 max-w-full` (bukan `inline-flex shrink-0`),
tetapi anak span tetap `min-w-0 flex-1 truncate whitespace-nowrap`.

### b. Chip "{n} item" di header kategori (`_authenticated.gudang.tsx`)

Header = judul panjang + chip jumlah + nilai rupiah + caret. Judul
`min-w-0 flex-1 truncate`, chip mengikuti §3, kolom kanan `shrink-0`:

```tsx
<div className="flex min-w-0 flex-1 items-center gap-2">
  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-primary" />
  <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug">
    {cat}
  </h3>
  <span
    className="inline-flex h-5 max-w-[7rem] shrink-0 items-center
               rounded-full border bg-background px-1.5
               text-[11px] font-medium leading-none
               text-muted-foreground tabular-nums"
    title={`${list.length} item`}
  >
    <span className="min-w-0 truncate whitespace-nowrap">{list.length} item</span>
  </span>
</div>
```

Jangan pernah biarkan kolom kanan ikut `flex-1` — itu yang membuat
chip "{n} item" tergencet di desain lama.

### c. Hero card di `lovable.visual.produk-list.tsx`

Tingkat luar `grid grid-cols-[minmax(0,1fr)_auto]`, barisan badge
`flex flex-wrap`. Setiap badge ikut §3 (`h-6 shrink-0 whitespace-nowrap`),
kecuali chip nama produk yang boleh menyusut
(`min-w-0 max-w-full truncate`).

### d. `DetailRow` di kolom Keterangan

`grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center min-h-[40px] py-2`.
Label kiri `leading-none` + ikon `shrink-0`. Nilai kanan
`leading-snug [overflow-wrap:anywhere]` agar nama produk panjang tanpa
spasi tetap aman; sub-teks inline dengan separator " · " + `truncate`
supaya tinggi baris seragam.

---

## 5. Yang dilarang

- `text-[Xpx]` di luar token resmi (`11px` saja yang diizinkan).
- `flex` campur teks + badge tanpa `min-w-0` pada container teks.
- `truncate` pada elemen tanpa lebar terbatas (`min-w-0` / `max-w-*`).
- Badge tanpa `shrink-0` di baris campuran.
- `leading-snug` di badge satu baris (tidak seragam dengan tetangga
  `leading-none`).
- Membuat utility CSS baru untuk kasus tunggal — pakai class utility
  Tailwind langsung agar pola terbaca di JSX.

---

## 6. Verifikasi sebelum merge

1. Buka harness `/lovable/visual/produk-list` di 320 / 360 / 411 /
   480 px (manual atau via workflow `produk-list-visual.yml`).
2. Periksa kolom kanan header kategori & kartu produk: nilai rupiah
   dan chip jumlah tetap satu baris; judul panjang ter-truncate
   dengan elipsis, **bukan** memaksa wrap.
3. Set font scaling Android ke 200% (Display & touch → Font size).
   Tidak boleh ada badge lebih tinggi dari satu baris teks utama.
4. Tambah snapshot di `tests/visual/produk-list.public.spec.ts` jika
   menambah badge / kolom baru. Fixture stres harus mencakup nama
   produk tanpa spasi >= 40 karakter.
