## Tujuan

Tambah fitur chat antar pengguna terdaftar dengan batasan: hanya owner ↔ akun pelanggan/pemasok miliknya yang boleh saling chat. Mendukung 1‑on‑1, grup otomatis per `order_request`, dan grup manual. Realtime, lampiran gambar/file, tanda dibaca + badge unread, Web Push + notif in‑app.

## Konsep akses

- "Kontak terkait transaksi" = pasangan user (A, B) di mana **salah satu** adalah owner dan **yang lain** adalah akun yang ditautkan ke `customers.user_id` atau `suppliers.user_id` milik owner tsb.
- Tambah kolom opsional `customers.user_id` dan `suppliers.user_id` (FK ke `auth.users`). Owner bisa "menautkan" customer/supplier ke akun lewat email (lookup via fn server `link_contact_account_by_email`). Selama belum ditaut, kontak tsb tetap pakai WhatsApp seperti sekarang — tidak muncul di daftar chat.
- Helper SECURITY DEFINER `public.can_chat(a uuid, b uuid)` → true bila pasangan owner ↔ kontak tertaut ditemukan; dipakai oleh RLS dan saat membuat conversation.

## Skema database

```text
profiles                              (sudah ada; pakai untuk display_name/avatar)
customers   + user_id uuid NULL FK auth.users  (taut akun)
suppliers   + user_id uuid NULL FK auth.users  (taut akun)

conversations
  id uuid PK
  kind text CHECK in ('dm','order','group')
  title text NULL           -- group: nama; dm/order: derive di UI
  owner_user_id uuid NOT NULL FK auth.users   -- pemilik (untuk skoping)
  order_request_id uuid NULL FK order_requests (UNIQUE per order utk kind='order')
  created_by uuid NOT NULL
  last_message_at timestamptz
  created_at/updated_at

conversation_members
  conversation_id uuid FK conversations ON DELETE CASCADE
  user_id uuid FK auth.users
  role text CHECK in ('owner','member')
  last_read_at timestamptz NULL
  joined_at timestamptz
  PK (conversation_id, user_id)

messages
  id uuid PK
  conversation_id uuid FK
  sender_id uuid FK auth.users
  body text NULL
  attachment_path text NULL    -- storage object path di bucket 'chat-attachments'
  attachment_mime text NULL
  attachment_name text NULL
  attachment_size int NULL
  created_at timestamptz
  edited_at timestamptz NULL
  deleted_at timestamptz NULL  -- soft delete
  -- CHECK: body OR attachment_path NOT NULL

push_subscriptions
  id uuid PK
  user_id uuid FK auth.users
  endpoint text UNIQUE
  p256dh text, auth text
  user_agent text, created_at, last_used_at
```

GRANTs lengkap pada setiap tabel + `ALTER PUBLICATION supabase_realtime ADD TABLE messages, conversation_members, conversations`.

### Fungsi/trigger

- `can_chat(a, b)` security definer.
- `start_dm(_partner uuid)` server fn DB: validasi `can_chat`, cari/buat conversation kind='dm' antar (owner_user_id, partner), insert kedua member, return id.
- `ensure_order_conversation(_order uuid)` security definer: idempotent — buat kind='order' bila belum ada, anggota = owner order + semua akun pemilik/staff yang terlibat (saat ini: owner + akun terkait customer order, bila ada).
- Trigger `after insert on order_requests`: panggil `ensure_order_conversation(NEW.id)` (lewati bila gagal can_chat).
- Trigger `after insert on messages`: update `conversations.last_message_at`; panggil server fn `notify_new_message` lewat `pg_notify` ATAU dari server fn pengirim (lebih sederhana — pakai opsi server fn).
- Trigger `after update of user_id on customers/suppliers`: bila baru ditautkan, panggil `ensure_order_conversation` untuk semua order terkait.

### RLS (intisari)

- `conversations`: SELECT bila `user_id ∈ conversation_members`. INSERT lewat server fn saja (policy `USING (false)` untuk INSERT/UPDATE dari klien; gunakan SECURITY DEFINER RPC).
- `conversation_members`: SELECT bila user adalah anggota conversation tsb. INSERT/UPDATE/DELETE lewat RPC.
- `messages`: SELECT bila anggota conversation; INSERT bila anggota & `sender_id = auth.uid()` & passing helper `is_member(conv, auth.uid())`; UPDATE hanya `deleted_at` oleh sender atau owner; DELETE: server fn saja.
- `push_subscriptions`: row‑level oleh `user_id = auth.uid()`.

## Storage

- Bucket privat baru `chat-attachments` (via tool). Path: `{conversation_id}/{message_id}/{filename}`.
- RLS pada `storage.objects`: anggota conversation boleh SELECT/INSERT; UPDATE/DELETE hanya uploader.

## Server functions (TanStack)

Di `src/lib/chat.functions.ts` (semua pakai `requireSupabaseAuth`):

- `listConversations()` → list + unread count (`messages where created_at > member.last_read_at`).
- `getConversation(id)` + `listMessages(id, beforeCursor?)` (pagination).
- `sendMessage({ conversationId, body?, attachment? })` — insert; panggil `dispatchPush` (fire & forget) ke anggota lain.
- `markRead({ conversationId, lastReadAt? })`.
- `startDirectMessage({ partnerUserId })` → RPC `start_dm`.
- `createGroup({ title, memberIds[] })` — validasi tiap memberId `can_chat(owner, member)`.
- `addGroupMembers / removeMember / leaveGroup / renameGroup` — hanya creator/owner_user_id.
- `searchEligibleContacts(q)` → join `customers/suppliers` milik saya yang `user_id IS NOT NULL` → profil (display_name, avatar, email partial).
- `linkContactAccountByEmail({ kind:'customer'|'supplier', id, email })` — admin server‑only lookup user via `auth.admin.listUsers` (atau RPC SECURITY DEFINER), set `user_id`.
- `registerPushSubscription({...})` / `unregisterPushSubscription(endpoint)`.
- `dispatchPush({ conversationId, messageId })` — kirim Web Push via VAPID (lib `web-push` di server fn / atau fetch langsung ke endpoint). Skip self.

## Web Push

- Tambah dependency `web-push` (server‑only).
- Secrets baru: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (di‑request lewat `add_secret`, dengan instruksi generate).
- `public/sw-push.js` (service worker khusus push, terpisah dari skill PWA app‑shell): handler `push` → `showNotification`; `notificationclick` → `clients.openWindow('/chat/{conversationId}')`.
- Registrasi SW + `pushManager.subscribe({ userVisibleOnly:true, applicationServerKey })` di tombol "Aktifkan notifikasi chat" pada Profil; juga di‑prompt setelah membuka chat pertama kali (re‑use `permission-bootstrap`).
- Simpan subscription via `registerPushSubscription`.

## UI

Route baru di bawah `_authenticated`:

- `src/routes/_authenticated.chat.tsx` — layout split: kiri daftar conversation (search + tab "Semua/DM/Grup/Order"), kanan `<Outlet/>`. Badge unread total ditarik ke menu utama (lewat hook `useUnreadTotal`).
- `src/routes/_authenticated.chat.index.tsx` — empty state + tombol "Mulai chat" / "Buat grup".
- `src/routes/_authenticated.chat.$conversationId.tsx` — header (nama+anggota), list pesan (virtualized sederhana / reverse scroll), composer (textarea + tombol lampiran + kirim). Lampiran dipreview inline (gambar) atau sebagai kartu file.
- Komponen: `NewDmDialog` (pilih dari `searchEligibleContacts`), `NewGroupDialog`, `GroupSettingsSheet` (anggota, rename, leave).
- Halaman Pelanggan/Pemasok: tambah aksi "Tautkan akun" (input email) + indikator status taut, tombol "Buka chat" muncul bila tertaut.
- Halaman detail order (jika ada): tombol "Buka chat order".
- Navigasi utama: tambah item "Chat" dengan badge unread.

### Realtime + state

- `useConversationList()` → query + subscribe channel `conversations:user_id={me}` (filter `conversation_members` join → invalidate query).
- `useConversation(id)` → query messages + subscribe `messages:conversation_id=eq.{id}`; mark read pada mount & saat tab focus.
- `useUnreadTotal()` → sum unread per conversation; subscribe `messages` di semua conversation user.
- Cleanup channel di `useEffect` return (sesuai aturan realtime).

### In‑app notif

- Subscriber global di `_authenticated/route.tsx` mendengarkan event `messages` untuk user; saat ada pesan baru & user **tidak** sedang membuka conversation tsb → `sonner` toast + update badge. Pesan tidak ditampilkan bila tab konversasi aktif.

## Pengujian

- Buat 2 akun A (owner) & B; tautkan B ke salah satu customer milik A → cek B muncul di "Mulai chat", chat 1‑on‑1 berjalan dua arah dengan realtime.
- Buat order baru milik A dengan customer tertaut B → conversation kind='order' otomatis muncul untuk keduanya.
- Buat grup manual, tambah/keluarkan anggota, rename.
- Upload gambar & PDF — preview & download bekerja, hanya anggota yang bisa akses (cek dengan akun ketiga).
- Unread badge: kirim dari B saat A tidak buka thread → badge naik, hilang setelah dibuka.
- Web Push: aktifkan di B, kirim dari A saat tab B tertutup → notifikasi muncul, klik membuka `/chat/{id}`.
- RLS: akun C (tidak terkait) gagal SELECT messages/conversations milik A‑B (403).

## Catatan teknis

- Tabel & policy memakai pola `is_member(conv_id, user_id)` SECURITY DEFINER untuk hindari rekursi RLS.
- `messages` realtime memerlukan REPLICA IDENTITY FULL pada conversation_members agar payload `old.last_read_at` ikut terkirim — opsional, cukup query ulang via React Query invalidation.
- Web Push hanya aktif di HTTPS / preview Lovable; di iOS Safari hanya jalan untuk PWA terpasang (sudah di‑handle oleh prompt PWA install yang ada).
- Tidak menyentuh skema `auth/storage/realtime` selain `ALTER PUBLICATION` & policy `storage.objects`.

## Urutan kerja

1. Migrasi: kolom `user_id` di customers/suppliers, tabel chat + push, helper fn, RLS, publication, trigger order.
2. Bucket `chat-attachments` + policy storage.
3. Server fns (`src/lib/chat.functions.ts`, `chat.server.ts`) + `web-push` install + secret VAPID.
4. UI route chat + integrasi link akun di Pelanggan/Pemasok + item menu + badge unread.
5. Service worker push + tombol aktivasi di Profil.
6. Tes manual end‑to‑end sesuai daftar di atas.
