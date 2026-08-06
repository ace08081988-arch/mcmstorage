# SECURITY DEFINER Inventory (public schema)

Dokumen ini memetakan **setiap** `SECURITY DEFINER` di schema `public` yang
dipakai Ace Storage / Ace Chat, cara masing-masing memvalidasi pemanggil,
dan hubungannya dengan warning Supabase linter
(`function_search_path_mutable`, `security_definer_view`, `rls_disabled_in_public`).

Snapshot: 110 fungsi `prosecdef=true` di `public` (query di § 1).
Semua fungsi **wajib** memenuhi tiga syarat:

1. `SET search_path` eksplisit (lihat § 2).
2. Mem-validasi pemanggil sebelum menulis (lihat § 3).
3. Return type dibatasi — tidak pernah membocorkan kolom sensitif
   (mis. `auth.users.email` mentah; harus lewat wrapper mis. `admin_list_users`).

Jika salah satu poin bocor, linter akan warn dan itu **bukan false positive** —
harus diperbaiki, bukan di-ignore.

---

## 1. Query rujukan

```sql
SELECT n.nspname||'.'||p.proname AS fn,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid)             AS ret,
       p.provolatile                             AS vol,   -- i/s/v
       p.proconfig                               AS cfg,   -- search_path & extras
       l.lanname                                 AS lang
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language  l ON l.oid = p.prolang
 WHERE n.nspname = 'public'
   AND p.prosecdef = true
 ORDER BY p.proname;
```

Fungsi yang **mem-validasi caller lewat `auth.uid()` / `has_role`**:

```sql
SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef=true
   AND pg_get_functiondef(p.oid) ~* '(auth\.uid|has_role)'
 ORDER BY 1;
```

---

## 2. Aturan `search_path`

Linter warn `function_search_path_mutable` muncul kalau `proconfig`
**tidak** menyertakan `search_path=…`. Aturan Ace:

| Kategori fungsi                                   | `SET search_path` wajib                    |
| ------------------------------------------------- | ------------------------------------------ |
| Fungsi murni domain publik                        | `SET search_path = public`                 |
| Fungsi yang butuh `pgcrypto` (`digest`, `gen_*`)  | `SET search_path = public, extensions`     |
| Fungsi yang enqueue/read pgmq                     | `SET search_path = public, pgmq`           |
| Fungsi yang membaca `auth.users` langsung         | `SET search_path = public, auth`           |
| Trigger realtime (`realtime.broadcast_changes`)   | `SET search_path = public, realtime`       |
| Cron/queue dispatcher lintas schema               | `SET search_path = ''` + fully qualify     |
| Scanner yang menginspeksi storage/schema          | `SET search_path = public, storage`        |

Snapshot per kategori (dari `proconfig`):

- `public` — mayoritas (default).
- `public, extensions` — semua `prep_*`, `ecer_*_via_task`, `request_*_via_task`,
  `notify_*_via_hook` (butuh `digest()` untuk PIN hash + `http` untuk hook).
- `public, pgmq` — `enqueue_email`, `read_email_batch`, `delete_email`,
  `move_to_dlq`, `email_queue_health`.
- `public, auth` — `admin_list_users`.
- `public, realtime` — `prep_broadcast_change`.
- `""` (kosong) — `email_queue_dispatch`, `email_queue_wake` (fully qualify).
- `public, storage` — `run_internal_security_scan`.

Kalau linter warn `function_search_path_mutable` untuk fungsi baru: **selalu**
tambah `SET search_path = …` di definisi, jangan ignore warn-nya.

---

## 3. Predikat izin (auth building blocks)

Semua RPC memvalidasi pemanggil via **satu** dari predikat berikut. Predikat
itu sendiri `SECURITY DEFINER STABLE` supaya bebas rekursi RLS
(lihat `docs/friend-requests-rls.md`).

| Predikat                                       | Return  | Dipakai untuk                                                                                                   |
| ---------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `has_role(_user_id uuid, _role app_role)`      | boolean | Gerbang admin. **Satu-satunya** sumber kebenaran; jangan menyimpan role di `profiles`.                          |
| `has_active_pro(_uid uuid)`                    | boolean | Gate quota (`enforce_free_*_cap`).                                                                              |
| `is_chat_only(_uid uuid)`                      | boolean | Menyembunyikan fitur non-chat untuk akun chat-only.                                                             |
| `is_conversation_member(_conv, _user)`         | boolean | RPC chat yang menulis/membaca conversation tertentu.                                                            |
| `is_conversation_owner(_conv, _user)`          | boolean | Aksi admin conversation (rename, kick, delete-for-all).                                                         |
| `are_friends(_a, _b)`                          | boolean | Building block `can_chat`.                                                                                      |
| `can_chat(_a, _b)`                             | boolean | Boleh membuka DM (teman ATAU pasangan customer/supplier).                                                       |
| `prep_read_allowed(_share_token)`              | boolean | Worker portal membaca tugas (butuh `prep_upload_grants` ≤ 15 mnt).                                              |
| `prep_upload_allowed(_share_token)`            | boolean | Storage RLS untuk upload worker (tanpa mengecek owner).                                                         |
| `prep_worker_upload_allowed(_owner, _token)`   | boolean | Storage RLS varian owner-scoped (path `{owner}/…`).                                                             |
| `prep_pin_locked_until(_token)`                | tstz    | Rate-limit PIN: ≥ 5 gagal / 10 mnt → dikunci 10 mnt.                                                            |
| `prep_share_token_exists(_token)`              | boolean | **Admin-only** helper diagnostik; `RAISE forbidden` kalau bukan admin.                                          |

Kontrak pemanggilan RPC: panggil `auth.uid()` sekali di awal, lalu
`RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'` atau
`RETURN jsonb_build_object('ok', false, 'error', 'forbidden')` untuk jalur
RPC yang mengembalikan hasil. Jangan mengecek role di client — client
hanya boleh menyembunyikan UI; sumber kebenaran tetap di fungsi ini.

### `has_role` — canonical shape (jangan diubah)

```sql
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
```

Aturan turunan:

- Cek role selalu `public.has_role(auth.uid(), 'admin'::public.app_role)`
  — fully qualified. Kalau `search_path` seorang penyerang di-shim,
  kualifikasi ini yang menahannya.
- Jangan menambahkan varian `has_role(text)` — enum-typed only.
- Role hanya bisa diberikan via `admin_set_admin_role` (lihat § 4).

---

## 4. RPC yang di-gate `has_role('admin')`

Semua fungsi yang **secara eksplisit** memanggil `has_role` di body-nya
(sisa RPC memakai `auth.uid()` sebagai user biasa dan menyandarkan izin ke
RLS + predikat conversation/friend/prep).

| RPC                                                 | Skema validasi                                                                    | Efek                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `admin_approve_payment(_payment_id, _note)`         | `auth.uid()` NOT NULL AND `has_role(admin)`                                       | Approve `subscription_payments` + extend plan.                    |
| `admin_reject_payment(_payment_id, _note)`          | idem                                                                              | Reject payment.                                                   |
| `admin_list_users(_query, _limit)`                  | idem; `search_path=public, auth`                                                  | Cari user via `auth.users` (kolom terbatas).                      |
| `admin_set_admin_role(_target, _grant)`             | idem + `_target IS NOT NULL` + tolak demote-self                                  | Grant/revoke row di `user_roles`. **Satu-satunya writer**.        |
| `prep_share_token_exists(_token)`                   | `has_role(admin)` else `42501`; token length ≥ 8                                  | Diagnostik share token — jangan pernah expose ke client biasa.    |
| `prep_submission_verify(_id, _decision, _reason)`   | `auth.uid()` NOT NULL + `has_role(admin)`; `_decision IN ('approved','rejected')` | Approve/reject prep submission + apply stok.                      |
| `prep_pin_reset(_token)`                            | `owner_user_id = auth.uid()` **OR** `has_role(admin)`                             | Hapus counter gagal PIN + ack alert.                              |
| `run_internal_security_scan()`                      | `service_role` (via `auth.jwt()->>'role'`) **OR** `has_role(admin)`               | Full-schema scan; menulis `security_scan_runs/findings`.          |
| `security_findings_acknowledge(_ids)`               | `has_role(admin)`                                                                 | Ack finding tanpa menghapus history.                              |

Setiap penambahan RPC admin-only baru **wajib** mengikuti template
`IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN RAISE …`.
Kalau lupa, scanner internal (`run_internal_security_scan`) menandai
sebagai `security_definer_no_role_check`.

---

## 5. RPC yang di-gate predikat conversation / friend / prep

Predikat non-role dipakai supaya user biasa tetap bisa memanggil RPC-nya
**untuk data miliknya sendiri**, tanpa butuh admin.

| RPC                                                                                                                                                                              | Predikat                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `chat_set_archive`, `chat_set_pin`, `chat_mute`, `chat_clear_conversation_for_me`, `chat_link_business`, `create_chat_cart`, `message_edit`, `message_pin`, `message_react`, `message_star`, `message_hide_for_me`, `message_delete_all_mine` | `is_conversation_member(_conv, auth.uid())` |
| `add_group_member`, `message_delete_for_all`                                                                                                                                     | `is_conversation_owner(_conv, auth.uid())`            |
| `start_dm(_partner)`                                                                                                                                                             | `can_chat(auth.uid(), _partner)`                      |
| `send_friend_request`, `respond_friend_request`, `cancel_friend_request`, `list_friend_requests`                                                                                 | Baca/tulis baris `friend_requests` sendiri; RLS + predikat menegakkan pihak. |
| `prep_submit*`, `prep_get_task`, `ecer_*_via_task`, `request_*_via_task`                                                                                                         | `prep_read_allowed(_token)` + `prep_pin_locked_until` |
| `send_ecer_preps_to_customer`, `send_request_prep_to_customer`                                                                                                                   | `auth.uid()` = owner prep + guard payment invariant.  |
| `pos_commit_sale`                                                                                                                                                                | `auth.uid()` = owner item warehouse.                  |
| `enforce_free_*_cap` (trigger)                                                                                                                                                   | `has_active_pro(NEW.user_id)` else block.             |

---

## 6. Trigger `SECURITY DEFINER`

Trigger bersifat internal (dipanggil PG, bukan client). Tetap `SECURITY
DEFINER` supaya bisa menulis ke tabel yang RLS-nya melarang user langsung
(`chat_delete_audit`, `order_request_events`, dll). Tidak ada validasi
caller — proteksinya lewat WHERE clause pada `NEW.*`.

Daftar:

- Auto-archive chat: `_chat_auto_archive_from_ecer_prep`,
  `_chat_auto_archive_from_request_prep`, `_chat_auto_archive_from_task`.
- Apply mutasi stok: `apply_ecer_preparation`, `apply_purchase`,
  `apply_ready_package`, `apply_request_preparation_item`, `apply_sale`.
- Guard invariant: `prevent_debt_amount_below_paid`,
  `prevent_debt_overpayment`.
- Free-tier caps: `enforce_free_devices_cap`, `enforce_free_sales_cap`,
  `enforce_free_staff_cap`, `enforce_free_warehouse_cap`.
- Hook notifikasi: `notify_friend_request_via_hook`,
  `notify_order_event_via_hook`, `notify_prep_task_via_hook`.
- Housekeeping: `handle_new_user_profile`, `handle_new_user_subscription`,
  `sync_profile_from_auth`, `touch_conversation_on_message`,
  `trg_customer_account_linked`, `trg_ensure_order_conv`,
  `trg_order_requests_status_email`, `trg_ready_packages_status_email`,
  `log_order_status_change`, `prep_task_items_resolve_ecer_title`,
  `prep_broadcast_change`, `email_queue_wake`.

---

## 7. Skema validasi input (per RPC)

RPC Ace tidak memakai Zod di sisi DB; validasi input dipatuhi di dua tempat:

1. **Client TS** (`src/lib/*.functions.ts`, `src/lib/rpc-*.ts`) — Zod schema
   sebelum `supabase.rpc(...)`.
2. **Server SQL** — `RAISE EXCEPTION` untuk kondisi yang tidak boleh
   melewati RLS.

Aturan minimum untuk fungsi baru:

- UUID input: cek `IS NOT NULL`.
- Enum-like text (`_decision`, `_kind`, `_direction`): `IN (…)` eksplisit.
- Numeric quantity: `> 0` (dan `<= 10^9` kalau menyentuh stok).
- Text input yang jadi identifier (share_token, invite_code): panjang
  minimum (`length(btrim(_x)) >= 8`).
- Batch array (`_ids uuid[]`): `array_length(_ids, 1) BETWEEN 1 AND 500`.
- Foto path: harus di-`starts_with(prefix)` sesuai owner untuk cegah
  path traversal ke folder user lain.

Kalau input gagal validasi, RPC **melempar** (`RAISE EXCEPTION`) — jangan
return `{ok:false}` diam-diam; itu bikin surface pemanggil lolos "record
before send" dan melanggar aturan explicit-state.

---

## 8. Warning linter yang biasa muncul & keputusan

| Warning                          | Interpretasi Ace                                                     | Keputusan default                                                        |
| -------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `function_search_path_mutable`   | `proconfig` tidak set `search_path`.                                 | **Fix** — tambah `SET search_path`, jangan ignore.                       |
| `security_definer_view`          | View publik `SECURITY DEFINER`.                                      | Ganti jadi function `SECURITY DEFINER` + predikat, view drop.            |
| `rls_disabled_in_public`         | Tabel publik tanpa RLS.                                              | Enable RLS + GRANT + policy.                                             |
| `policy_exists_rls_disabled`     | Policy ada tapi RLS off.                                             | `ALTER TABLE … ENABLE ROW LEVEL SECURITY`.                               |
| `auth_users_exposed`             | Kolom `auth.users.*` di-select via view/RPC.                         | Bungkus di RPC `SECURITY DEFINER` yang memfilter kolom (mis. `admin_list_users`). |
| `exposed_sensitive_data`         | RPC mengembalikan email/phone tanpa gate.                            | Tambah `has_role` gate atau turunkan kolom.                              |

**Ignoring rule:** ignore hanya kalau ada catatan di security-memory
(`security--update_memory`) yang menjelaskan kenapa warning itu intentional
(mis. `get_worker_portal_public_config` sengaja publik). Tanpa memo,
jangan ignore.

---

## 9. Menjaga dokumen ini tetap sinkron

Setiap migrasi yang **menambah/menghapus** `SECURITY DEFINER` **harus**
meng-update dokumen ini di § 3–6 dalam commit yang sama.

Diff snapshot cepat:

```bash
psql -Atc "SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' \
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace \
  WHERE n.nspname='public' AND p.prosecdef=true ORDER BY 1;" \
  > /tmp/secdef-now.txt
diff /tmp/secdef-now.txt docs/security-definer-inventory.snapshot.txt
```

Kalau diff-nya besar dan bukan bagian dari migrasi yang di-review, itu
sinyal drift — audit sebelum merge.
