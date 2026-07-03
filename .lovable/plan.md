## Fitur Daftar (Chat Lists) ala WhatsApp

Membangun sistem "Daftar" agar owner bisa memfilter tab Chat berdasarkan preset (Belum dibaca, Grup, Favorit) dan **daftar custom** buatan sendiri (mis. "Ditanggapi AI", "Handoff AI", "Maps") berisi kumpulan kontak/grup pilihan.

### 1. Database (Lovable Cloud)

Migration baru:

- `chat_lists` — daftar milik user
  - `id uuid pk`, `user_id uuid`, `name text`, `color text` (hex), `icon text` (nama lucide), `sort_order int`, `created_at`, `updated_at`
- `chat_list_members` — anggota daftar (conversation refs)
  - `list_id uuid fk`, `conversation_id uuid fk`, `added_at`
  - PK `(list_id, conversation_id)`

RLS: user hanya bisa CRUD daftar & anggotanya sendiri (`user_id = auth.uid()`). GRANT `SELECT/INSERT/UPDATE/DELETE` ke `authenticated`, `ALL` ke `service_role`.

### 2. Data layer

`src/lib/chat-lists.ts`:
- `useChatLists()` — query semua daftar user + count anggota
- `useChatList(id)` — detail + daftar `conversation_id`
- `useCreateChatList`, `useUpdateChatList`, `useDeleteChatList`
- `useAddToList`, `useRemoveFromList`, `useReorderChatLists`

### 3. Halaman Daftar `/daftar`

Route baru `src/routes/_authenticated.daftar.tsx`:
- Header "Daftar" + tombol pensil (edit urutan) + back
- Tombol "+ Daftar baru" → dialog create (nama + pilih warna + icon + pilih conversations)
- Section "Daftar Anda": preset (Belum dibaca, Favorit, Grup) yang selalu ada + daftar custom user
- Tap daftar → buka editor (rename, ubah warna/icon, tambah/hapus anggota, hapus daftar)
- Section "Preset yang tersedia" (info)

Menu **Daftar** di dropdown chat sekarang menuju `/daftar` (bukan `/buku-alamat`).

### 4. Integrasi ke tab Chat

Di `_authenticated.chat.index.tsx`:
- Filter chip dinamis: preset default + daftar custom user (dengan dot warna & icon)
- State `filter` diperluas: `"all" | "unread" | "group" | "favorite" | { listId: string }`
- Klik chip custom → filter `active` berdasarkan `conversation_id ∈ list.members`
- Long-press chat item → sudah ada mode select; tambah aksi "Tambah ke daftar…" di bulk toolbar dan di menu per-chat

### 5. UX detail

- Preset tidak bisa dihapus, tapi bisa disembunyikan dari chip bar (setting per user, disimpan di localStorage untuk sederhana)
- Warna & icon konsisten dengan tokens (tidak hardcode; pilihan warna dari palette semantik)
- Empty state: ikon domain-spesifik, bukan Sparkles

### Teknis (untuk referensi)

```text
src/routes/_authenticated.daftar.tsx       (halaman utama)
src/components/chat/ChatListEditor.tsx     (dialog create/edit)
src/components/chat/AddToListMenu.tsx      (aksi tambah ke daftar)
src/lib/chat-lists.ts                      (hooks + RPC helpers)
supabase migration: chat_lists + chat_list_members + RLS + GRANT
```

Perubahan minimal di file existing: `_authenticated.chat.index.tsx` (chip bar & bulk action), dropdown "Daftar" diarahkan ke `/daftar`.

### Yang TIDAK termasuk

- Sharing daftar antar user
- Sinkronisasi ke WhatsApp asli
- Auto-tagging berbasis AI (bisa jadi fase berikut untuk daftar "Ditanggapi AI"/"Handoff AI" — sekarang manual assign dulu)

Setuju lanjut implementasi?
