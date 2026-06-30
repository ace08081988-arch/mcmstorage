## Apa yang akan dibangun

Mirip screenshot WhatsApp Business: tekan-tahan gelembung pesan → masuk **mode pilih**, lalu muncul toolbar di header dengan ikon ⇦ jumlah ↶ ⓘ 🗑 📋 ➡ ⋮. Menu ⋮ berisi: Verifikasi kode keamanan, Beri bintang, Sematkan, Tambah ke Catatan, Tambah balas cepat, Terjemahkan.

---

## Bagian 1 — Selection mode & toolbar

- State `selectedIds: Set<string>` di `_authenticated.chat.$conversationId.tsx`.
- Tekan-tahan 500 ms pertama → masuk selection mode + pilih pesan itu. Ketuk pesan berikutnya = toggle pilih. Ketuk pesan saat selection mode mati = kelakuan normal.
- Header berubah jadi **SelectionToolbar**: tombol X (keluar), jumlah, lalu aksi:
  - **Balas** (aktif hanya jika 1 dipilih)
  - **Info** (aktif hanya jika 1 dipilih) → dialog: pengirim, dikirim, dibaca, status (sent/read), checksum
  - **Hapus** → pakai dialog hapus yang sudah ada (massal: untuk-saya / untuk-semua bila semua milik sendiri)
  - **Salin** → gabungkan body terpilih (urut waktu) ke clipboard
  - **Teruskan via WhatsApp** → gabung jadi 1 teks lalu `shareToWhatsApp`
  - Menu ⋮ → 6 item di bawah
- Tap pesan tanpa selection mode tetap normal; long-press di luar selection mode aktifkan selection mode (gantikan AlertDialog hapus lama; dialog hapus dipindah jadi aksi toolbar).

## Bagian 2 — Beri bintang & Sematkan (per pesan)

Migration: tambah kolom `messages.starred_by uuid[] default '{}'` dan `messages.pinned_at timestamptz`, plus RPC:
- `message_star(_id uuid, _on bool)` — toggle keanggotaan `auth.uid()` di `starred_by`.
- `message_pin(_id uuid, _on bool)` — set/kosongkan `pinned_at` (hanya member percakapan).

UI:
- Bintang kuning kecil di sudut pesan saat user sudah membintangi.
- Banner "📌 Pesan disematkan" di atas daftar (klik = scroll ke pesan), maksimum 3 pin per percakapan (validasi di RPC).
- Halaman baru `/_authenticated/chat/$conversationId/starred` — daftar pesan berbintang.

## Bagian 3 — Catatan pribadi & Balas cepat

Tabel baru (RLS per user):
- `chat_notes(id, user_id, title text, body text, source_message_id uuid null, conversation_id uuid null, created_at, updated_at)`
- `chat_quick_replies(id, user_id, shortcut text, body text, created_at, updated_at)` — `unique(user_id, shortcut)`.

UI:
- Aksi toolbar "Tambah ke Catatan" → dialog isi judul (prefilled = potongan body), simpan.
- Aksi "Tambah balas cepat" → dialog isi shortcut + body (prefilled = body pesan).
- Halaman `/_authenticated/catatan` (list + tambah/edit/hapus) dan `/_authenticated/balas-cepat`.
- Di composer: ketik `/` → muncul popover daftar quick reply, pilih → isi `body`.

## Bagian 4 — Terjemahkan + Verifikasi keamanan

- Server function `translateMessage` (TanStack `createServerFn`, `requireSupabaseAuth`) → panggil Lovable AI Gateway model `google/gemini-3-flash-preview`, deteksi bahasa & terjemahkan ke ID. Aksi toolbar "Terjemahkan" memunculkan dialog hasil + tombol "Salin terjemahan".
- "Verifikasi kode keamanan" → dialog yang menampilkan SHA-256 60-digit dari `conversationId + members.sort()` (dibagi 12 grup × 5 digit, mirip WA) + QR (pakai komponen QR yang sudah ada). Ini representasi stabil per percakapan; bukan E2E kripto, tapi format & UX-nya identik dengan WhatsApp untuk verifikasi manual antar-pihak.

---

## Detail teknis (ringkas)

- Hooks baru di `src/lib/chat.ts`: `useStarMessage`, `usePinMessage`, `usePinnedMessages`, `useStarredMessages`.
- Hooks baru di `src/lib/chat-notes.ts` & `src/lib/chat-quick-replies.ts` (CRUD + react-query).
- Server fn `src/lib/chat-ai.functions.ts` → `translateMessage({ text, target?: 'id'|'en' })`.
- Komponen baru:
  - `src/components/chat/SelectionToolbar.tsx`
  - `src/components/chat/MessageInfoDialog.tsx`
  - `src/components/chat/SecurityCodeDialog.tsx`
  - `src/components/chat/TranslateDialog.tsx`
  - `src/components/chat/SaveAsNoteDialog.tsx`, `SaveAsQuickReplyDialog.tsx`
  - `src/components/chat/QuickReplyPopover.tsx` (untuk `/` di composer)
- Migrations (1 file): kolom `starred_by`, `pinned_at` di `messages`; tabel `chat_notes`, `chat_quick_replies` + GRANT + RLS + policies; RPC `message_star`, `message_pin`.
- Sidebar: tambah link "Catatan" & "Balas cepat" pada grup yang sudah ada.

## Yang TIDAK akan disentuh

- Logika kirim/edit/hapus existing, attachment menu, presence/typing.
- Cara enkripsi backend (verifikasi keamanan hanya fingerprint deterministik, bukan ganti skema kripto).
