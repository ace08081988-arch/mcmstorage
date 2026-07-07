## Masalah

Tombol WA/Chat di alur penjualan tidak konsisten:

| Surface | Ukuran | Style | Label WA | Label Chat | Disabled |
|---|---|---|---|---|---|
| `/tugas` Siapkan Sendiri (per kartu) | `h-8` | Soft outline (hijau/primary tint) | "Kirim WA" | (icon only) | `!sold_at` |
| `/ecer` Ready per kartu | `h-8` | Solid `#25D366` + `bg-primary` | "WA" | "Chat" | `busy` |
| `/ecer` bulk toolbar | `h-7` | Solid | "WA" | "Chat" | `count===0` |
| `ReadyPackagesPanel` | `h-9` | Solid + emoji 💬 | "💬 Kirim WA" | — | `sharing` |

Akibatnya: label & tinggi tombol beda-beda, semantik disabled beda (hanya `/tugas` yang mensyaratkan sudah terjual), dan caption dibangun ad-hoc di tiap file — mudah drift.

## Solusi (SSOT)

Satu primitive tombol + satu builder caption, dipakai semua surface penjualan.

### 1. Primitive `src/components/share/SaleShareButtons.tsx` (baru)

```tsx
<WaShareButton size="sm|md" variant="soft|solid" disabled reason={...} onClick />
<ChatShareButton size="sm|md" variant="soft|solid" disabled reason={...} onClick />
```

Kontrak:
- **Warna WA**: selalu `#25D366` (solid) atau `#25D366/10 + #1ea952 text` (soft). Chat: `primary` / `primary/10 + primary text`.
- **Ukuran**: `sm` = `h-7 text-[11px]`, `md` = `h-9 text-xs`. Tidak ada `h-8` lagi.
- **Label**: "Kirim WA" (varian `md`) / "WA" (varian `sm`). "Kirim Chat" / "Chat".
- **Disabled + reason**: kalau `disabled` dan `reason` diisi, `title` tooltip = reason, cursor `not-allowed`, opacity 50. Tidak ada emoji di label; ikon Lucide `Send` / `MessageCircle`.
- **aria-label** otomatis: "Kirim ke WhatsApp" / "Kirim ke MCM Chat".

### 2. Helper `saleShareGate(row)` di `src/lib/sale-share-gate.ts` (baru)

Satu tempat untuk aturan "boleh kirim atau belum":

```ts
type SaleShareState =
  | { enabled: true }
  | { enabled: false; reason: string };

saleShareGate({ sold_at, hasPhoto, hasLocation })
// → { enabled: false, reason: "Catat penjualan dulu (tombol Jual)" }
// → { enabled: false, reason: "Foto paket belum ada" } (ecer)
// → { enabled: true }
```

Semua surface memanggil helper ini; tidak ada lagi ternary `!sold_at ? … : …` inline.

### 3. Caption builder `buildSaleShareCaption(row, kind)` di `src/lib/sale-share-caption.ts` (baru)

Konsolidasi blok `💰 Penjualan` + `📍 Lokasi` + catatan hutang yang sekarang tersebar di 3 tempat. Format identik untuk WA & Chat (Chat hanya menambah metadata attachment).

### 4. Retrofit callsites (audit)

- `src/components/SiapkanSendiriSection.tsx`: ganti `<button>` WA/Chat per kartu → `<WaShareButton size="sm" variant="soft" …>` + `saleShareGate({ sold_at })`. Hilangkan class hex hard-coded.
- `src/components/ReadyPackagesPanel.tsx`: ganti tombol "💬 Kirim WA" → `<WaShareButton size="md" variant="solid" …>`. Emoji hilang, label "Kirim WA".
- `src/components/ReadyEcerSection.tsx`:
  - Bulk toolbar → `<WaShareButton size="sm" variant="solid">` + `<ChatShareButton size="sm" variant="solid">`.
  - Kartu individu (per prep) → primitive yang sama, `variant="soft"`.
- Caption di `sendWA` (ecer) dan `onSendWA` (tugas) pakai `buildSaleShareCaption`.

Tidak menyentuh: halaman `/chat` composer (bukan alur penjualan), `/pos-kasir` (sudah punya UX sendiri), tombol WA di kontak/buku alamat (bukan share penjualan).

### 5. Verifikasi

1. `bun run typecheck` hijau.
2. Buka `/tugas` → tombol WA & Chat pada kartu Siapkan Sendiri: `h-7`, warna hijau/primary soft, disabled dengan tooltip "Catat penjualan dulu" saat `sold_at` null. Setelah Jual sukses → keduanya nyala, label "WA" / "Chat".
3. Buka `/ecer` (detail judul) → bulk toolbar & kartu Ready pakai tombol yang sama; caption WA berisi blok `💰 Penjualan` + `📍 Lokasi` konsisten dengan `/tugas`.
4. `ReadyPackagesPanel` (context lain yang pakai) → tombol WA jadi label "Kirim WA" tanpa emoji, ukuran seragam.
5. ESLint guardrail (opsional lanjutan, tidak di plan ini): larang `wa\.me` / `#25D366` di luar `src/components/share/`.

## Detail teknis

- Tidak ada perubahan DB / RLS — murni UI + helper.
- Tidak mengubah kontrak `shareToWhatsApp` / `shareToChat` / `PickChatConversationDialog`.
- Tidak mengubah semantik `sold_at IS NULL` (SSOT aktif tetap di `prep-active-selector`).
- Tidak menyentuh `AutoSendConfirmDialog` (dialog konfirmasi ecer) — itu bukan tombol WA/Chat, hanya gerbang.

## File terdampak

Baru:
- `src/components/share/SaleShareButtons.tsx`
- `src/lib/sale-share-gate.ts`
- `src/lib/sale-share-caption.ts`

Diedit:
- `src/components/SiapkanSendiriSection.tsx`
- `src/components/ReadyPackagesPanel.tsx`
- `src/components/ReadyEcerSection.tsx`
