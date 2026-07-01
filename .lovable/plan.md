# Fungsikan semua fitur Chat

Cakupan besar. Saya pecah jadi 4 langkah, dikerjakan berurutan supaya bisa diverifikasi satu-per-satu. Tiap langkah selesai baru lanjut yang berikutnya.

## 1. Root-cause "Gagal hapus pesan" (prioritas)

Symptom: setiap kali tombol Hapus ditekan → toast "Gagal menghapus pesan". RPC `message_hide_for_me` / `message_delete_for_all` sebenarnya ada dan GRANT + RLS di `message_hidden` sudah benar (sudah saya verifikasi via DB). Jadi kegagalan ada di sisi client atau kondisi runtime.

Yang akan saya periksa & perbaiki:
- Reproduksi via Playwright headless: login → buka `/chat/<id>` → long-press pesan → tekan "Hapus untuk saya" — capture `network` request ke `rpc/message_hide_for_me` beserta response body & console error persis.
- Kalau server error → perbaiki RPC/RLS pada migration.
- Kalau client error (mis. `scheduleUndo` men-commit lebih dari sekali, `optimisticDeleteMessages` throw, atau `logChatDelete` throw sebelum RPC) → perbaiki di `src/lib/chat.ts` / `_authenticated.chat.$conversationId.tsx`.
- Tambahkan E2E regresi `tests/e2e/chat-delete-happy-path.spec.ts` supaya bug ini tidak balik.

## 2. Audit menyeluruh tombol/menu di `/chat`

Iterasi semua control di halaman chat & bubble message. Untuk tiap yang tidak ada handler / handler no-op, saya isi kontrak fungsionalnya:

| Kontrol | Kontrak |
| --- | --- |
| Bubble long-press: Balas | Set `replyTo` state → composer tampil quote → kirim isi `reply_to` |
| Bubble long-press: Forward | Dialog pilih conversation → panggil `sendMessage` per target |
| Bubble long-press: Salin | `navigator.clipboard.writeText(body)` + toast |
| Bubble long-press: Info | Buka `MessageInfoDialog` (sudah ada, cek wiring) |
| Bubble long-press: Reaksi emoji | `message_reactions` upsert + realtime |
| Toolbar bulk: Hapus / Forward / Salin | Sama seperti single, versi array |
| Header: Cari di percakapan | Filter input + highlight |
| Composer: attach foto/dokumen | Upload ke bucket `chat-attachments` + preview thumb |
| Composer: sticker picker | Buka dialog (sudah ada di `StickerPickerDialog`) → kirim sebagai attachment |

Yang sudah bekerja saya biarkan; yang no-op/rusak saya kabelkan ke logic yang sudah ada.

## 3. Panggilan suara + video (WebRTC)

Skema kecil, minimal viable, mengikuti rencana yang sudah disepakati sebelumnya:

- Migration: tabel `chat_calls (id, conversation_id, caller_id, callee_id, kind text 'audio'|'video', status text 'ringing'|'answered'|'declined'|'missed'|'ended', started_at, ended_at, duration_s)` + RLS scoped ke member percakapan + ADD ke `supabase_realtime`.
- Signaling: Supabase Realtime broadcast channel `call:{conversationId}` untuk offer/answer/ice/hangup. STUN publik Google, TURN opsional nanti.
- UI:
  - Tombol 📞 & 🎥 di header `_authenticated.chat.$conversationId.tsx`.
  - Overlay incoming-call global di `__root.tsx` (subscribe user-scoped channel `call-invite:{uid}`).
  - Route aktif `src/routes/_authenticated.call.$callId.tsx` (mute/kamera/hangup).
- Native permission: pakai `getUserMedia` biasa; di Capacitor Android manifest sudah punya izin RECORD_AUDIO/CAMERA.
- Riwayat: system-bubble di chat ("📞 Panggilan suara · 1m 23s") saat status `ended`/`missed`.

## 4. Stiker & lampiran, reaksi/balas/forward/salin

Digabung dengan langkah 2 karena banyak yang sudah ada helper-nya (StickerPickerDialog, sticker-library, share-chat). Saya hanya perlu:
- Pastikan tombol sticker di composer memanggil `StickerPickerDialog` dan pilihan stiker menghasilkan message attachment.
- Pastikan attach foto/dokumen tampil di bubble (bukan cuma link).
- Menu long-press konsisten di single & bulk.

## Verifikasi tiap langkah

- Langkah 1: Playwright login → hapus 1 pesan → refresh → pesan tetap hilang. Toast sukses, bukan gagal.
- Langkah 2: Manual walkthrough via Playwright pada tiap tombol; screenshot state before/after.
- Langkah 3: Dua tab Playwright (caller & callee) — assert `pc.iceConnectionState === "connected"` di kedua sisi lalu hangup.
- Langkah 4: Kirim stiker & foto lalu assert bubble merender image.

## Pertanyaan konfirmasi

Fitur langkah 3 (panggilan) berat & bikin migration tabel baru. Sebelum saya mulai, boleh saya:
1) Kerjakan **langkah 1 dulu** (root-cause + fix delete) dan tunjukkan hasil sebelum lanjut audit + panggilan? Ini paling aman karena delete-pesan adalah blocker sekarang.
2) Atau saya kerjakan semua langsung dalam satu batch besar (lebih lama, lebih banyak perubahan sekaligus).

Balas "1" atau "2" — default saya "1" kalau tidak dijawab.
