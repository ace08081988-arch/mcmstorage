# Upgrade besar fitur Chat

Sumber: jawaban pengguna pada 4 pertanyaan sebelumnya. Dibangun di atas struktur chat yang sudah ada (`conversations`, `conversation_members`, `messages`, Realtime, push lewat `push_subscriptions`).

## 1) Lampiran foto & file
- Bucket privat `chat-attachments` (sudah ada) dipakai untuk foto, file PDF/Doc, dan audio voice note.
- Composer chat dapat tombol "Lampirkan" (paperclip) + tombol kamera (mobile). Maks 10 file, ukuran per file 20 MB.
- Pratinjau thumbnail sebelum kirim, dengan progress upload per file dan tombol batal.
- Render di bubble: gambar (lightbox + pan/zoom dipakai ulang dari modul foto), file generik (ikon + nama + ukuran + tombol unduh), dan player audio inline.
- Lampiran terkirim hanya tersimpan jika pesan berhasil tersimpan (rollback storage saat insert `messages` gagal).

## 2) Pesan suara (voice note)
- Tombol mic di composer: tekan tahan untuk rekam (desktop & mobile), lepas untuk kirim, geser untuk batal. Tap singkat = toggle.
- Rekaman `MediaRecorder` → `audio/webm;codecs=opus` (fallback `audio/mp4` di Safari iOS), unggah ke `chat-attachments`, simpan `attachment_mime="audio/*"`, `attachment_duration_sec`.
- Player bubble: tombol play, waveform sederhana (peaks dari Web Audio), durasi, indikator "diputar" untuk pengirim.

## 3) Reply, reaksi emoji, forward
- Tabel baru `message_reactions(message_id, user_id, emoji)` + RLS: insert/delete oleh user di percakapan yang sama.
- Kolom baru `messages.reply_to_id uuid` (self FK, ON DELETE SET NULL).
- UI:
  - Swipe-kanan / klik tiga titik → "Balas". Bubble menampilkan kutipan teks/atribut lampiran dari pesan dibalas.
  - Long-press / hover → bar reaksi cepat (👍❤️😂😮😢🙏) + tombol "Lainnya".
  - "Teruskan" memunculkan picker percakapan (DM/grup yang user ikut) dan mengirim ulang teks + lampiran ke target terpilih.

## 4) Edit pesan & hapus untuk saya
- Kolom `messages.edited_at` sudah ada → aktifkan UI edit (hanya pengirim, hanya pesan teks, batas 24 jam) dengan badge "diedit".
- Hapus untuk semua (sudah ada). Tambah "Hapus untuk saya":
  - Tabel baru `message_hidden(message_id, user_id)` agar pesan itu tidak muncul di sisi user tapi tetap utuh untuk yang lain. Query messages join LEFT untuk filter.

## 5) Pencarian, pin, arsip
- Pencarian:
  - Search-bar di halaman daftar chat. Mencari teks di `messages.body` (ILIKE, ditambah index trigram `pg_trgm` pada `messages.body`) dibatasi percakapan yang user ikuti, paginated 20 hasil. Klik hasil → buka chat + auto-scroll ke pesan tsb dengan highlight.
  - Search dalam ruang chat: ikon kaca pembesar di header, hasil inline + navigasi prev/next.
- Pin & arsip per user:
  - Tambah kolom `conversation_members.pinned_at timestamptz`, `archived_at timestamptz`.
  - Daftar chat: tab "Aktif | Arsip"; di tab Aktif, chat pinned naik ke atas dengan ikon pin. Aksi pin/arsip via menu kebab di tiap baris.

## 6) Notifikasi: push + suara + badge
- Push web/native (sudah ada) — pastikan event INSERT `messages` memicu push untuk anggota lain yang `notifications_muted_until IS NULL OR < now()`.
- Suara saat foreground: file pendek `notify.mp3` di `public/sounds`, diputar saat menerima pesan dari orang lain (toggle global di pengaturan + per percakapan).
- Badge unread di sidebar `Chat` sudah ada (`useUnreadTotal`) — tambahkan badge di favicon (Notification API) & `navigator.setAppBadge` saat tersedia.
- Mute per percakapan: kolom `conversation_members.notifications_muted_until timestamptz` + UI menu "Bisukan 1 jam / 8 jam / 1 minggu / Selamanya".

## 7) Presence online + last seen
- Realtime Presence channel `presence:user:{user_id}` di-track saat user buka app.
- Tabel `profiles.last_seen_at timestamptz` di-update via RPC `chat_heartbeat()` (rate-limit 30 detik) + saat `beforeunload`.
- UI header DM: titik hijau jika anggota lain online sekarang, atau "terakhir dilihat {fmtAgo}" jika offline. Hormati setting privasi per user (`profiles.show_last_seen boolean default true`) yang bisa dimatikan di Profil.

## Implementasi bertahap
1. Schema migrations (semua tabel/kolom + RLS + GRANT + index trigram + realtime publication tambahan).
2. Library helper:
   - `src/lib/chat-attachments.ts` (upload + signed URL + tipe).
   - `src/lib/chat-voice.ts` (recorder + waveform).
   - `src/lib/chat-presence.ts` (presence + heartbeat + last_seen helper).
   - `src/lib/chat-search.ts` (RPC search + highlight util).
3. UI komponen baru di `src/components/chat/`:
   - `Composer.tsx` (textarea + attach + mic + reply preview).
   - `MessageBubble.tsx` (render teks/lampiran/audio + reactions + menu).
   - `ReactionBar.tsx`, `ForwardDialog.tsx`, `SearchBar.tsx`, `MuteMenu.tsx`.
4. Refactor `src/routes/_authenticated.chat.index.tsx` (tab Aktif/Arsip, pin, search).
5. Refactor `src/routes/_authenticated.chat.$conversationId.tsx` (presence header, reply state, edit mode, search in-room, voice/lampiran integrasi).
6. Push notification: tambah trigger DB / Edge logic agar `messages` INSERT mengirim push (jika belum). Hormati mute.
7. Pengaturan: tambah pengaturan suara + privacy "Tampilkan last seen" di `Profil` / `Pengaturan`.

## Detail teknis (untuk referensi internal)

```text
messages
  + reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL
  + attachment_duration_sec int                (untuk voice note)

message_reactions (message_id, user_id, emoji, created_at)  PK(message_id,user_id,emoji)
message_hidden     (message_id, user_id, hidden_at)         PK(message_id,user_id)

conversation_members
  + pinned_at timestamptz
  + archived_at timestamptz
  + notifications_muted_until timestamptz
  + sound_enabled boolean default true

profiles
  + last_seen_at timestamptz
  + show_last_seen boolean default true
```

- RPC baru: `chat_search_messages(_q text, _limit int, _before timestamptz)`, `chat_set_pin(_conv uuid, _pin bool)`, `chat_set_archive`, `chat_mute(_conv uuid, _until timestamptz|null)`, `chat_heartbeat()`, `message_react(_msg uuid, _emoji text, _on bool)`, `message_hide(_msg uuid)`, `message_edit(_msg uuid, _body text)`, `message_forward(_msg uuid, _to_convs uuid[])`.
- Index: `CREATE INDEX messages_body_trgm ON messages USING gin (body gin_trgm_ops)`.
- Realtime: tambahkan `message_reactions`, `conversation_members` (update events) ke `supabase_realtime`.
- Storage rules: `chat-attachments` tetap privat; signed URL 1 jam untuk preview & unduh. Hapus object di storage saat row `messages` di-hard-delete.

## Pertimbangan & batasan
- Pekerjaan ini ±15 file baru/diubah + 3 migrasi besar; akan saya kerjakan bertahap pada beberapa giliran.
- Belum termasuk: panggilan suara/video, sticker, pesan kadaluwarsa otomatis — bisa ditambah belakangan.
- Asumsi: semua user sudah terhubung lewat tabel `customers/suppliers` agar bisa chat (sudah ada `can_chat`). Forward hanya ke percakapan yang user-nya anggota.

Konfirmasi rencana ini, atau beri tahu fitur mana yang ingin diprioritaskan dulu (misal "1, 2, 7 dulu") supaya saya bangun bertahap.