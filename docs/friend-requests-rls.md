# `friend_requests` — Aturan RLS, Trigger, dan RPC

Dokumen ini adalah **sumber kebenaran tunggal** untuk siapa boleh melakukan apa
pada `public.friend_requests`. Setiap perubahan pada policy, trigger
`tg_friend_requests_guard`, atau RPC terkait **wajib** ikut memperbarui tabel di
bawah ini agar audit CI (`supabase/tests/audit_friend_requests.sql`) dan uji
integrasi (`supabase/tests/security_rls_authz.sql` blok 8–13) tetap sejalan.

## 1. Model peran

| Peran   | Definisi                                    |
|---------|---------------------------------------------|
| sender  | user yang membuat request (`from_user`)     |
| recipient | user yang menerima request (`to_user`)    |
| third party | user selain sender & recipient          |
| anon    | belum sign-in (`auth.uid() IS NULL`)        |
| service_role | backend / migration (bypass RLS + trigger sebagian) |

## 2. Status lifecycle

```text
                 respond_friend_request (recipient)
                 ┌──────────► accepted (terminal)
                 │
 pending ────────┤
                 │           respond_friend_request (recipient)
                 └──────────► rejected (terminal, dapat dihapus recipient)

 pending ─── cancel_friend_request (sender) ──► cancelled
                                                (dapat dihapus sender atau recipient)
```

`accepted` bersifat terminal: tidak ada transisi keluar dan tidak ada DELETE via RLS.

## 3. Matriks izin

### 3.1 SELECT — policy `fr_select_self`

Predikat: `from_user = auth.uid() OR to_user = auth.uid()`.

| Aktor        | Baris terlihat                          |
|--------------|------------------------------------------|
| sender       | semua baris `from_user = self`           |
| recipient    | semua baris `to_user = self`             |
| third party  | **tidak ada**                            |
| anon         | **tidak ada** (tidak ada `GRANT SELECT`) |

### 3.2 INSERT

Tidak ada grant/policy INSERT untuk `authenticated` atau `anon`.
Satu-satunya jalur pembuatan: RPC `send_friend_request` (SECURITY DEFINER)
yang memaksa `from_user = auth.uid()` dan `status = 'pending'`.

### 3.3 UPDATE

Dua policy yang saling melengkapi. Trigger `tg_friend_requests_guard`
adalah pertahanan berlapis (defense-in-depth) — semua invarian tetap dipaksa
meskipun policy dilonggarkan tanpa sengaja.

| Transisi                     | Aktor sah   | Policy                              | RPC              |
|-------------------------------|-------------|--------------------------------------|------------------|
| `pending → accepted`          | recipient   | `fr_update_recipient`                | `respond_friend_request(id, true)`  |
| `pending → rejected`          | recipient   | `fr_update_recipient`                | `respond_friend_request(id, false)` |
| `pending → cancelled`         | sender      | `fr_update_sender_cancel_only`       | `cancel_friend_request(id)`         |
| transisi lain                 | —           | ditolak trigger                      | —                |
| ubah `from_user` / `to_user`  | —           | ditolak trigger (participants immutable) | —            |

Prasyarat tambahan yang di-enforce oleh trigger:

- `auth.uid() IS NOT NULL` (tolak `insufficient_privilege` bila tidak).
- Status sumber harus tepat `pending`.
- Status target harus tepat `accepted`, `rejected`, atau `cancelled`.

### 3.4 DELETE

| Status baris | Aktor sah                | Policy                    |
|--------------|---------------------------|---------------------------|
| `pending`    | sender                    | `fr_delete_from_self`     |
| `cancelled`  | sender **atau** recipient | `fr_delete_from_self` + `fr_delete_to_self` |
| `rejected`   | recipient                 | `fr_delete_to_self`       |
| `accepted`   | — (tidak boleh via RLS)  | —                         |

Third party dan anon selalu ditolak (silent no-op karena USING RLS
menyaring baris keluar).

## 4. Kontrak error trigger (untuk log CI)

Setiap RAISE dari `tg_friend_requests_guard` menyertakan `DETAIL` berisi
`req_id / actor / role / from_user / to_user / old_status / new_status`
dan `HINT` yang menunjukkan RPC yang seharusnya dipakai.

| Skenario                        | SQLSTATE | MESSAGE_TEXT (regex)                                | HINT mencantumkan          |
|---------------------------------|----------|------------------------------------------------------|----------------------------|
| Sender mencoba set accepted/rejected | 42501 | `only the recipient may set status=(accepted\|rejected)` | `respond_friend_request`   |
| Recipient/aktor lain cancel     | 42501    | `only the sender may cancel`                         | `cancel_friend_request`    |
| Swap `from_user` / `to_user`    | 23514    | `participants are immutable`                         | `cannot be changed after INSERT` |
| Transisi dari status non-pending| 23514    | `cannot transition status from … to …`               | `Status transitions are one-way from pending` |
| Status target di luar allowlist | 23514    | `invalid status transition to …`                     | daftar status sah          |
| UPDATE tanpa `auth.uid()`       | 42501    | `unauthenticated UPDATE denied`                      | perlu sign-in              |

## 5. Jalur RPC (SECURITY DEFINER)

Semua mutasi dari klien **harus** melewati salah satu RPC berikut. Klien
tidak punya grant langsung terhadap tabel.

| RPC                          | Prasyarat                                           | Efek                                 |
|-------------------------------|-----------------------------------------------------|--------------------------------------|
| `send_friend_request(to)`     | signed-in, `to <> auth.uid()`                       | INSERT baris `pending`               |
| `respond_friend_request(id, accept)` | signed-in, `row.to_user = auth.uid()`, status `pending` | UPDATE ke `accepted` atau `rejected` |
| `cancel_friend_request(id)`   | signed-in, `row.from_user = auth.uid()`, status `pending` | UPDATE ke `cancelled`         |
| `start_dm(partner)`           | signed-in, `can_chat(self, partner)` (mensyaratkan `accepted`) | membuka DM                |

## 6. Referensi kode & uji

- Trigger: `public.tg_friend_requests_guard` (lihat `pg_get_functiondef`).
- Policy: `fr_select_self`, `fr_update_recipient`, `fr_update_sender_cancel_only`,
  `fr_delete_from_self`, `fr_delete_to_self`.
- Uji SQL: `supabase/tests/security_rls_authz.sql` blok **8–13**.
- Audit CI: `supabase/tests/audit_friend_requests.sql`
  (workflow `.github/workflows/audit-friend-requests.yml`, `bun run audit:friend-requests`).
- Uji integrasi HTTP: `tests/integration/security-rls.test.ts`.

> **Perubahan pada policy/trigger/RPC di atas WAJIB disertai pembaruan tabel
> matriks pada dokumen ini dalam commit yang sama.**

## 7. Checklist otomatis (dijaga CI)

Setiap PR yang mengubah `supabase/migrations/**` dan menyentuh permukaan
`friend_requests` (regex: `friend_requests`, `tg_friend_requests_guard`,
`send_/respond_/cancel_friend_request`, `fr_(select|update|delete|insert)_*`)
**wajib** menyertakan pembaruan pada 3 file di bawah — jika tidak, workflow
`friend-requests-doc-sync` menggagalkan PR:

- [ ] `docs/friend-requests-rls.md` (dokumen ini)
- [ ] `supabase/tests/security_rls_authz.sql` (blok 8–13)
- [ ] `supabase/tests/audit_friend_requests.sql`

Verifikasi lokal sebelum push:

```bash
bun run check:friend-requests-docs        # guard sinkronisasi dokumen + uji
bun run audit:friend-requests             # audit policy/trigger/grant
bun run test:security:sql                 # jalankan blok 8–13
```

Guard hanya menuntut file ikut disentuh — bila migrasi hanya menyentuh
komentar/whitespace, catat itu di bagian **6. Referensi kode & uji** agar
ada perubahan yang tercatat.