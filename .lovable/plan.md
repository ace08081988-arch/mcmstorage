
## Ringkasan Audit

203 file di `src/` (di luar `routeTree.gen.ts`, `src/integrations/**`, `src/components/ui/**`) memakai kelas typography/spacing lama.

Total kejadian yang akan diganti:

```text
Typography px (bypass font-scale — prioritas tinggi)
  text-[10px]     426
  text-[11px]     874
  text-[12px]      45
  text-[13px]      12
  text-[15px]       6
Typography Tailwind (aman, mapping 1:1 ke --ms-*)
  text-xs  981   text-sm  724   text-base 146
  text-lg   83   text-xl   33   text-2xl   35
  text-3xl  16   text-4xl   6
Spacing (mapping 1:1)
  space-y-{1..6}, gap-{1..6}, p/px/py-{2..6}   ~5 800
```

## Mapping yang Diterapkan

Text (px → token, semua rem-based sehingga ikut `--app-font-size`):
```text
text-[10px] text-[11px]        → text-ms-2xs   (0.6875rem/11px)
text-[12px]                    → text-ms-xs
text-[13px]                    → text-ms-sm
text-[15px]                    → text-ms-base
text-xs  → text-ms-xs          text-sm → text-ms-sm
text-base→ text-ms-base        text-lg → text-ms-lg
text-xl  → text-ms-xl          text-2xl→ text-ms-2xl
text-3xl → text-ms-3xl         text-4xl→ text-ms-4xl
```

Spacing (mapping 1:1; utility hanya tersedia untuk `p/px/py`, `gap`, `space-y`, tidak untuk `pt/pb/pl/pr/mt/mb` — arahan itu **tidak diubah**):
```text
space-y-N  → space-ms-N   (N ∈ 2..6; space-y-1 dilewati — tidak ada token)
gap-N      → gap-ms-N     (N ∈ 1..6)
p-N        → p-ms-N       (N ∈ 1..6)
px-N       → px-ms-N      (N ∈ 2..6)
py-N       → py-ms-N      (N ∈ 2..6)
```

## Pengaman

1. Regex word-boundary: `text-muted-foreground`, `bg-primary/50`, `gap-x-2`, `space-y-reverse`, dll. tidak akan ikut terganti.
2. Direktori yang **dilewati**: `src/routeTree.gen.ts`, `src/integrations/**` (auto-gen Cloud), `src/components/ui/**` (shadcn primitives — biarkan generic).
3. `text-[14px]`, `text-[16px]`, `text-[18px]`, `text-[20px]` tidak ada di codebase → tidak ada mapping tebakan.
4. Ukuran px non-standar (mis. `text-[9px]`, `text-[17px]`) — akan dilaporkan setelah run tanpa diubah, untuk keputusan manual.
5. Setelah migrasi: `tsgo --noEmit` untuk memastikan tidak ada regresi tipe/import.

## Yang Sengaja Tidak Diubah

- Directional padding/margin (`pt-*`, `pb-*`, `pl-*`, `pr-*`, `mt-*`, `mb-*`) — tidak ada token utility yang cocok; menambahkannya akan menambah scope. Sebutkan bila ingin dibuatkan `pt-ms-*` dst. sekaligus.
- `space-y-1` (221x) — tidak ada `space-ms-1`; dibiarkan.
- Nilai `rem` custom (`text-[0.6875rem]`) dari migrasi sebelumnya — sudah setara token; tidak diusik.
- Kelas di dalam `src/components/ui/**` (shadcn) — di-freeze agar update shadcn tetap smooth.

## Rencana Eksekusi

1. Jalankan sed word-boundary sekali jalan untuk seluruh mapping di atas (satu file per pass agar diff kecil-per-file).
2. Jalankan `bunx tsgo --noEmit`.
3. Laporkan: jumlah file berubah, sisa `text-[Npx]` non-standar, dan file-file dengan volume perubahan terbesar untuk pemeriksaan on-device 411/390px prioritas.

## Yang Perlu Konfirmasi

Migrasi ini menyentuh ~203 file dan ~10 000 kelas — cakupan besar dan visual dari **semua halaman** akan bergantung pada token `--ms-*`. Konfirmasi:

- **Setujui mapping di atas** → saya jalankan otomatis dan laporkan hasilnya.
- Atau minta saya **tambahkan token directional (`pt-ms-*` dst.) dulu** supaya `pt-3`, `mb-4`, dll. ikut termigrasi dalam pass yang sama.
- Atau minta saya **mulai dari subset prioritas** (mis. hanya `text-[10px]` / `text-[11px]` yang bypass font-scale, lalu sisanya di pass berikutnya).
