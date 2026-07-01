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

## 8. Menjalankan subset uji RLS participant

Semua uji berada di `supabase/tests/security_rls_authz.sql`. Setiap blok
ditandai komentar `-- N)` sehingga bisa di-grep atau di-slice.

### 8.1 Jalankan seluruh suite

```bash
# Perlu $PGHOST/$PGUSER/$PGPASSWORD (managed Postgres di CI) dan
# test.can_switch=on agar SET LOCAL ROLE authenticated/anon boleh.
PGOPTIONS="-c test.can_switch=on" \
  psql -v ON_ERROR_STOP=1 -f supabase/tests/security_rls_authz.sql
# atau via package script:
bun run test:security:sql
```

### 8.2 Subset blok yang relevan untuk participant

| Blok | Fokus                                    | Cara jalankan hanya blok itu |
|------|-------------------------------------------|------------------------------|
| 8    | RLS UPDATE — sender vs recipient          | lihat perintah slice di bawah |
| 9    | Policy `fr_update_recipient` scope        | `sed` slice atau grep-run    |
| 10   | `start_dm` tetap tertutup bila belum accepted | slice |
| 11   | Matriks transisi pending → *              | slice |
| 12   | Kontrak error trigger (SQLSTATE/DETAIL/HINT) | slice |
| 13   | Visibility SELECT policy `fr_select_self` | slice |

Slice satu blok saja (contoh: hanya blok 12) tanpa mengubah file:

```bash
# Ambil header setup (BEGIN…SET) + blok 12 + ROLLBACK, lalu jalankan.
awk '
  BEGIN { keep=1 }
  /^-- =+$/ && next_is_block { keep=0 }
  /^-- 12\)/ { keep=1 }
  /^ROLLBACK;/ { print; exit }
  keep { print }
' supabase/tests/security_rls_authz.sql \
  | PGOPTIONS="-c test.can_switch=on" psql -v ON_ERROR_STOP=1 -f -
```

Alternatif praktis: comment-out blok yang tidak diinginkan sementara,
atau jalankan semuanya — durasi seluruh suite <2 detik.

### 8.3 Audit + integrasi berdampingan

```bash
bun run audit:friend-requests          # snapshot policy/trigger/grant + simulasi serangan
bun run test:security:integration      # HTTP-level RLS via PostgREST (Vitest)
```

## 9. Membaca kegagalan kontrak SQLSTATE / MESSAGE_TEXT / DETAIL / HINT

Blok 12 memverifikasi bahwa setiap penolakan dari
`tg_friend_requests_guard` menyertakan **kode + pesan + DETAIL + HINT**
yang tepat. Bila gagal, output CI berbentuk:

```text
psql:supabase/tests/security_rls_authz.sql:XXXX: ERROR:
  FAIL 12a: expected SQLSTATE 42501, got 23514
           (msg=friend_requests guard: participants are immutable ...)
CONTEXT:  PL/pgSQL function inline_code_block line 42 at RAISE
```

### 9.1 Cara membaca baris FAIL

Format: `FAIL <blok>: <alasan> (sqlstate=… msg=… detail=… hint=…)`.

- **`expected SQLSTATE X, got Y`** — kode error berubah. Bandingkan
  dengan tabel di **§4** dan cek RAISE mana di `tg_friend_requests_guard`
  yang seharusnya menyalakan skenario ini. Kemungkinan besar branch di
  trigger dipindah/dihapus, atau policy RLS sekarang menyaring baris
  keluar lebih dulu (silent no-op → tidak ada error sama sekali).
- **`unexpected message: …`** — MESSAGE_TEXT tidak match regex yang
  didokumentasikan di **§4**. Sinkronkan: perbarui pesan trigger _atau_
  perbarui regex di blok 12 _dan_ tabel §4 (dalam commit yang sama).
- **`DETAIL missing diagnostic fields: …`** — trigger tidak lagi
  mengisi `req_id / actor / role / from_user / to_user / old_status /
  new_status`. Ini adalah **regresi observability CI**; kembalikan
  format `ctx` di `tg_friend_requests_guard`.
- **`HINT missing RPC recommendation: …`** — HINT tidak menyebut RPC
  yang seharusnya dipakai (`respond_friend_request`,
  `cancel_friend_request`). Perbaiki HINT di trigger.
- **`FAIL 12g: third-party UPDATE mutated a pending row`** — pihak
  ketiga berhasil UPDATE. Ini **security regression** — policy RLS
  USING melebar. Hentikan deploy.

### 9.2 Alur triage cepat

1. Baca baris `FAIL <blok>:` untuk mengetahui skenario mana yang pecah.
2. Buka `supabase/tests/security_rls_authz.sql` di blok tersebut untuk
   melihat ekspektasi eksplisit (regex message, string DETAIL, dsb).
3. Bandingkan dengan definisi trigger:
   ```bash
   psql -c "SELECT pg_get_functiondef('public.tg_friend_requests_guard'::regproc);"
   ```
4. Cocokkan branch trigger dengan tabel §4. Baris yang tidak lagi cocok
   adalah source of truth yang bergeser — sinkronkan trigger, tabel §4,
   dan blok 12 dalam satu commit.
5. Jalankan ulang subset: `bun run test:security:sql` (atau slice blok
   12 dengan snippet §8.2) sampai hijau.

### 9.3 Kegagalan yang khas dan artinya

| Gejala di log CI | Kemungkinan akar masalah |
|---|---|
| Semua blok 12 skip `SKIP 12: cannot switch roles` | Sesi Postgres tidak boleh `SET ROLE`. Set `test.can_switch=on` atau jalankan sebagai role dengan hak switch. |
| `FAIL 12a: sender self-accept did not raise` | Trigger guard dihapus / dinonaktifkan. Regresi kritis. |
| `sqlstate=42501, msg=new row violates row-level security policy` | Trigger tidak ter-fire karena USING RLS menyaring baris **sebelum** BEFORE trigger — cek apakah policy USING sender-cancel dihapus. |
| `DETAIL is NULL` | `ctx` di trigger tidak dilampirkan pada branch itu — sinkronkan format RAISE dengan §4. |
| Blok 13 gagal dengan jumlah baris > 1 untuk third-party | `fr_select_self` melebar atau ada policy SELECT tambahan. Cek blok 13-static untuk pesan drift. |

> Jika CI merah tetapi lokal hijau, biasanya karena `test.can_switch`
> tidak diaktifkan di lokal (blok runtime di-skip). Reproduksi dengan
> `PGOPTIONS="-c test.can_switch=on"` sebelum menuduh flakiness.