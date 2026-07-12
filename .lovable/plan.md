# Hardening 4 gejala chat — sequenced

4 gejala berbeda, 4 root cause potensial. Digabung dalam 1 patch = risiko regresi. Setiap slice: **diagnosa (baca file + reproduksi) → tunjukkan akar → fix → verifikasi**, lalu tunggu approval sebelum lanjut.

## Urutan slice

### Slice 1 — Composer chat tidak stabil saat menulis (411/390px + APK)
Kandidat akar:
- Textarea auto-resize memicu reflow parent → keyboard hide/show loop di Capacitor.
- `visualViewport` / `resize` listener men-toggle sticky footer.
- Focus-trap dialog atau `PromptInput` mengambil focus balik.

Diagnosa: baca `src/components/chat/*` (composer, PromptInput wrapper), cek listener `resize`/`visualViewport`, cek dynamic `height`/`maxHeight` pada composer. Reproduksi via Playwright headless 411px + inspeksi APK behavior lewat log.

### Slice 2 — ProductSharePopover menutup sendiri saat mengetik/scroll
Kandidat akar:
- Radix `Popover` `modal={false}` + `onInteractOutside` menutup saat klik input di popover.
- Re-render parent (query invalidation / realtime tick) meng-unmount popover.
- Focus keluar ke keyboard virtual → `onOpenChange(false)`.

Diagnosa: baca komponen popover product-share + parent-nya, cek `open`/`onOpenChange`, cek apakah state disimpan di parent yang di-invalidate oleh React Query realtime.

### Slice 3 — Dialog invite (AddContact) buka-tutup sendiri
Kandidat akar:
- Optimistic UI + reconciling poll (dari sprint sebelumnya) reset `open` state saat data refresh.
- FAB re-mount karena parent list re-render.
- `useEffect` yang men-set `open` dari server state.

Diagnosa: baca `AddContactFab` + hook friend-request, cari `setOpen` dalam `useEffect` yang bergantung ke query data.

### Slice 4 — List teman flicker / dialog konfirmasi reopen saat hapus/reject
Kandidat akar:
- Optimistic remove tanpa `keepPreviousData`, item hilang lalu muncul lagi saat realtime echo tiba.
- Konfirmasi dialog `open` didorong oleh item id yang berubah referensi setelah refetch.
- Race: mutation `onSuccess` invalidate → refetch → item lama sempat kembali sebelum server echo.

Diagnosa: baca hook friend-list + reject/remove mutation, cek pola invalidate vs `setQueryData`.

## Cara kerja per slice

Per slice saya akan:
1. Baca file terkait & tulis **temuan akar** singkat (bukan tebakan).
2. Tunjukkan patch minimal.
3. Verifikasi: build/typecheck + Playwright 411px reproduksi bila memungkinkan.
4. Berhenti, tunggu Anda uji di APK 411/390px sebelum lanjut ke slice berikutnya.

## Yang **tidak** akan saya lakukan
- Menyentuh business logic ecer / warehouse / payment gating.
- Refactor besar composer ke AI Elements (kecuali Slice 1 memang butuh, dan itu akan saya angkat lagi untuk approval terpisah).
- Publish. Tetap ditahan sampai Anda smoke-test on-device.

## Konfirmasi
Setuju urutan **Slice 1 → 2 → 3 → 4**? Atau Anda mau mulai dari slice lain dulu (mis. Slice 3 kalau invite dialog paling mengganggu hari ini)?
