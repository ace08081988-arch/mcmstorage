# Permintaan pertemanan (friend request) sebelum chat & call

Saat ini invite via PIN langsung menyimpan kontak dan DM bisa dibuka. Aturan baru: setelah invite, sisi lawan harus **menerima** permintaan dulu. Sebelum diterima → tidak bisa chat, voice, atau video call.

## Model data

Tabel baru `public.friend_requests`:
- `from_user` (uuid, pengundang)
- `to_user` (uuid, target PIN)
- `status`: `pending` | `accepted` | `rejected` | `cancelled`
- `responded_at` (nullable)
- unik per pasangan arah `(from_user, to_user)` supaya tidak double-request

RLS: kedua pihak boleh SELECT baris terkait dirinya; hanya `to_user` yang boleh UPDATE `status`; hanya `from_user` yang boleh cancel/hapus.

## RPC

- `send_friend_request(_invite_code)` — pengganti perilaku "add + auto-connect" pada `add_contact_by_invite_code`. Membuat baris `pending`, atau kembalikan status baris eksisting (idempoten). Tidak lagi otomatis membuat address_book "accepted".
- `respond_friend_request(_request_id, _accept boolean)` — hanya boleh untuk `to_user`. Kalau accept: set `accepted`, buat entri `address_book` dua arah, boleh buat conversation DM.
- `cancel_friend_request(_request_id)` — hanya `from_user`, ubah ke `cancelled`.
- `list_friend_requests(_direction)` — `incoming` / `outgoing` / `all`, hanya pending untuk badge.

## Gate chat & call

- `start_dm` / `useStartDm`: tolak dengan pesan "Belum berteman — kirim permintaan dulu" bila belum ada `accepted` di kedua arah.
- Tombol Panggilan suara / video di header DM: disabled + tooltip yang sama saat belum accepted (guard di UI + guard di RPC signaling).
- Halaman kontak: badge "Menunggu diterima" untuk outgoing pending; "Permintaan masuk" untuk incoming pending.

## UI

Rute baru `/kontak/permintaan`:
- Tab **Masuk** — daftar `incoming` pending dengan tombol *Terima* / *Tolak*.
- Tab **Terkirim** — daftar `outgoing` pending dengan tombol *Batalkan*.
- Badge angka di sidebar item "Kontak" untuk incoming pending.

Dialog "Chat baru" & flow undang via PIN:
- Setelah kirim invite: toast "Permintaan terkirim — menunggu diterima".
- Kalau target sudah accepted sebelumnya → langsung buka DM (backward-compatible).
- Kalau ada pending incoming dari target ini → shortcut "Terima permintaan" alih-alih tombol Undang.

## Migrasi data eksisting

Semua pasangan `address_book` yang saat ini sudah linked → seed baris `friend_requests` dengan `status='accepted'` supaya user lama tidak kehilangan akses chat setelah rilis.

## File yang tersentuh (ringkas)

```text
supabase migration: friend_requests + RPC + seed accepted
src/lib/chat.ts                              # start_dm gate + tipe
src/lib/friends.functions.ts (baru)          # server fn send/respond/list/cancel
src/components/chat/NewDmDialog.tsx          # copy & aksi
src/components/chat/CallButtons.tsx          # disable saat belum accepted
src/routes/_authenticated.kontak.permintaan.tsx (baru)
src/routes/_authenticated.chat.$conversationId.tsx  # guard header call buttons
src/components/AppSidebar.tsx                # badge pending
tests/e2e/friend-request-gate.spec.ts (baru) # invite → belum bisa chat → accept → bisa chat
```

## Verifikasi

- Migrasi seed jalan → user existing tetap bisa chat tanpa aksi apa pun.
- E2E: dua akun test A & B — A invite B, B belum terima → A tidak bisa buka DM (RPC 403). B terima → A langsung dapat DM aktif, tombol call enabled.
- Integration test RLS `friend_requests`: user lain tidak bisa SELECT/UPDATE baris orang lain.

Setuju dengan arah ini? Kalau ada bagian yang ingin diubah (mis. rejected boleh re-request setelah X jam, atau invite via PIN otomatis auto-accept dari sisi pengundang saja), sampaikan sekarang sebelum saya mulai migrasi.
