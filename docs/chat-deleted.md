# `chat-deleted` util & placeholder rules

Lokasi: `src/lib/chat-deleted.tsx`

Util ini adalah **satu-satunya sumber kebenaran** untuk menampilkan pesan
chat yang sudah dihapus. Semua surface (bubble pesan, reply preview di
komposer, `PinnedBanner`, `MessageInfoDialog`, daftar percakapan, copy/
forward, share WA, push notification, AI translate, notes, quick replies)
wajib memakai helper di sini — jangan menulis literal `"(pesan dihapus)"`
atau `"(lampiran dihapus)"` di tempat lain.

## API

| Export | Tipe | Kegunaan |
| --- | --- | --- |
| `DELETED_PLACEHOLDER` | `"(pesan dihapus)"` | Konstanta string. |
| `DELETED_ATTACHMENT_PLACEHOLDER` | `"(lampiran dihapus)"` | Konstanta string. |
| `ATTACHMENT_FALLBACK` | `"(lampiran)"` | Fallback saat ada lampiran tanpa nama & body kosong. |
| `hasAttachment(m)` | `boolean` | True jika ada `attachment_path`/`mime`/`name`. |
| `isDeleted(m)` | `boolean` | True jika `deleted_at` terisi. |
| `messagePreviewText(m)` | `string` | Plain-text untuk list / clipboard / WA / push. |
| `<DeletedPreview message />` | `ReactNode` | Render kaya (ikon `Ban` + italic) untuk pesan terhapus. |
| `<MessagePreview message />` | `ReactNode` | Auto-pilih: `DeletedPreview` jika terhapus, plain text jika tidak. |

## Aturan placeholder

1. **`deleted_at` menang atas semuanya.** Saat `isDeleted(m) === true`,
   `body`, `attachment_name`, thumbnail, dan metadata lain **tidak boleh**
   muncul di UI mana pun — termasuk preview historis, reply preview di
   composer, info dialog, daftar percakapan, dan teks yang di-share/copy.
2. **Format gabungan** saat ada lampiran:
   `"(pesan dihapus) · (lampiran dihapus)"`. Pemisahnya selalu ` · `
   (spasi · spasi) — jangan koma, jangan newline.
3. **Indikator lampiran terhapus** memakai ikon `Ban` dari `lucide-react`,
   bukan ikon paperclip/file/thumbnail.
4. **Plain-text vs rich.** Pakai `messagePreviewText` untuk konteks yang
   bukan JSX (clipboard, share WA, notifikasi, notes, quick replies).
   Pakai `<MessagePreview>` / `<DeletedPreview>` di JSX agar mendapat ikon
   + styling italic.
5. **Waktu** yang ditampilkan untuk pesan terhapus harus `deleted_at`,
   bukan `created_at`/`edited_at`.
6. **Audit log** wajib dicatat lewat `logChatDelete` (lihat
   `src/lib/chat-delete-audit.ts`) untuk aksi "hapus untuk saya" dan
   "hapus untuk semua".
7. **Realtime.** Tabel `messages` memiliki `REPLICA IDENTITY FULL`,
   sehingga `UPDATE` event Realtime sudah membawa `deleted_at` —
   client hanya perlu re-render saat baris ter-update.

## Test suite

Tiga file test mengunci perilaku ini:

| File | Cakupan | Catatan |
| --- | --- | --- |
| `src/lib/chat-deleted.test.tsx` | Unit: `hasAttachment`, `isDeleted`, `messagePreviewText` untuk semua kombinasi body/lampiran/deleted. | 22 tes. |
| `src/lib/chat-deleted-ui.test.tsx` | UI-level: bubble, composer reply, baris `MessageInfoDialog`, baris list. | 11 tes, pakai `renderToStaticMarkup`. |
| `src/lib/chat-deleted-snapshots.test.tsx` | Snapshot: `DeletedPreview`, `MessagePreview`, `PinnedBanner`, `MessageInfoDialog`, conversation list row + 13 kombinasi ekstrem (body 2000 char, 0/1/multi lampiran, metadata kosong, `null`/`undefined`). | 27 tes / 27 snapshot. |
| `tests/visual/chat-deleted.public.spec.ts` | Visual regression (Playwright) via harness `/lovable/visual/chat-deleted?part=...`. | Project `mobile-public`. |

Workflow `.github/workflows/chat-deleted-snapshots.yml` menjalankan script
`bun run test:chat-deleted` (unit + UI + snapshot) di setiap PR & push ke
`main`, dan mengunggah snapshot sebagai artifact ketika gagal.

## Cara update snapshot dengan aman

Snapshot gagal = ada yang berubah dari aturan di atas. Selalu mulai
dengan asumsi snapshot benar dan kode salah.

### 1. Reproduksi diff

```bash
bun run test:chat-deleted
```

Baca diff dari output Vitest. Untuk visual regression:

```bash
bun run test:visual
# buka playwright-report/index.html → bandingkan expected vs actual
```

### 2. Audit perubahan

- Apakah teks placeholder berubah dari `"(pesan dihapus)"` /
  `"(lampiran dihapus)"`? **Jangan update snapshot** — perbaiki kode.
- Apakah ikon berubah dari `Ban`? Diskusikan dulu sebelum update.
- Apakah pemisah `·` berubah? **Jangan update** — itu kontrak format.
- Apakah body / nama file asli bocor ke output meski `deleted_at` terisi?
  **Bug keamanan — perbaiki kode.**
- Apakah perubahan hanya kosmetik yang disengaja (mis. styling
  italic/ukuran ikon)? Lanjut ke langkah 3.

### 3. Update snapshot (hanya jika perubahan disengaja)

Unit + UI + snapshot Vitest:

```bash
bunx vitest run src/lib/chat-deleted-snapshots.test.tsx -u
# atau, untuk seluruh suite chat-deleted:
bunx vitest run "src/lib/chat-deleted*.test.tsx" -u
```

Visual regression Playwright:

```bash
bun run test:visual:update
```

### 4. Review baseline

- Buka file `__snapshots__/*.snap` dan `tests/visual/__screenshots__/*.png`
  yang berubah, pastikan placeholder & ikon masih sesuai aturan di atas.
- Commit baseline baru bersamaan dengan perubahan kode pemicunya — jangan
  pernah update snapshot di commit terpisah dari perubahan UI.
- Di PR, sebutkan alasan perubahan visual + screenshot before/after.

### 5. Jika ada placeholder baru

- Tambahkan konstanta di `src/lib/chat-deleted.tsx` (jangan literal di
  call site).
- Tambahkan kasus unit di `chat-deleted.test.tsx`.
- Tambahkan snapshot di `chat-deleted-snapshots.test.tsx`.
- Tambahkan section di harness `src/routes/lovable.visual.chat-deleted.tsx`
  + entri di `chat-deleted.public.spec.ts`.
- Update dokumen ini.