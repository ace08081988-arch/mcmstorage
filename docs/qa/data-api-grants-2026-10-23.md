# MCM STORAGE: explicit Data API grants, 23 October 2026

Scope: `ace08081988-arch/mcmstorage`, baseline `a85f27086ed08e7a0cff86560df42d225a9c652c`. No production schema, rows, ACLs, or secrets were changed by this audit. The proposed forward migration is for review in an isolated database first.

## Result and fix

All **311 existing migration files** parse as PostgreSQL SQL. They contain **110 CREATE TABLE statements, 103 distinct public table names, 101 surviving created tables, two views, and three BIGSERIAL sequences**. Every table creation already has an explicit same-file GRANT; the three serial sequences are covered too. `subscriptions` is dropped and recreated with grants; `employees` and `turnstile_config` are ultimately dropped. Repeated `IF NOT EXISTS` email/idempotency/ledger declarations retain existing objects. Every surviving created public table explicitly enables RLS.

One application operation lacked an explicit privilege after defaults are removed:

| Object and role | Required operation | Evidence | Change |
| --- | --- | --- | --- |
| `app_settings.worker_portal_config`, `authenticated` | UPDATE this column only | `src/lib/worker-portal-admin.functions.ts` calls `context.supabase.from("app_settings").update({ worker_portal_config: clean })`; `src/integrations/supabase/auth-middleware.ts` constructs this client with publishable key + caller Bearer token | Add `GRANT UPDATE (worker_portal_config) ON public.app_settings TO authenticated` to the column-creation migration and a new forward migration |

The existing `admins can update app_settings` RLS policy requires `has_role(auth.uid(), 'admin')` in both USING and WITH CHECK. The final SELECT policy is also admin-only (`20260702113755...`). The patch grants neither table-wide UPDATE nor INSERT, DELETE, access to other columns, or new `anon` rights. It does not remove pre-existing installation-specific grants; those require a separate measured production ACL review.

## Role and RLS review

| Flow | Direct Data API role/access | Decision |
| --- | --- | --- |
| Warehouse, customer, sales, debts, chat | Existing `authenticated` grants plus ownership/member/admin policies | Preserve existing explicit declarations; no default grants added |
| Worker task links, PIN checks and submissions | Narrow existing RPC EXECUTE grants; SECURITY DEFINER performs internal reads/writes | Do not expose task, PIN, upload-grant, or stock tables to `anon` to compensate for RPC dependencies |
| `doc_sequences` | Direct backend grant; authenticated caller uses `next_doc_number` RPC | No direct client grant added |
| `prep_upload_grants` | Client SELECT explicitly revoked by `20260620100040...` | Preserve denial; storage policies use SECURITY DEFINER `prep_upload_allowed` |
| `device_otp_challenges` and device writes | Existing restrictive policies deny client writes; server handles sensitive work | No client permission expansion |
| `prep_task_wa_hook_log` retries | Existing UPDATE limited to `send_status`, `error`, `retry_count`, `last_retry_at` | Preserve column scope |
| Public catalog | Server functions use service role | Do not grant `anon` direct access to warehouse/product rows |
| APK minimum supported version | Existing `anon`/authenticated SELECT, public policy | Preserve public version metadata |
| APK download telemetry | Existing anonymous INSERT, restricted policy | Preserve insert-only public operation |
| `app_settings` public worker configuration | Current `anon` SELECT grant has no matching anonymous policy; public config goes through RPC | Do not broaden policy or grant to fix unrelated access |
| `prep_submissions_unrouted` view | SELECT authenticated/service; `security_invoker=on` in following migration | Underlying RLS remains relevant |
| `query_metrics_daily_v1` view | SELECT authenticated; `security_invoker=true` | Own-user underlying metrics policy remains relevant |
| `stock_ledger` identity | Internal writes from SECURITY DEFINER trigger/RPC; authenticated SELECT | No anonymous/direct client INSERT or sequence grant added |

The inventory records **existing** service-role `ALL` declarations, including non-DML privileges; this patch adds none. The audit does not claim that every old `ALL` or every RLS/function implementation is ideally hardened. Table GRANT and RLS are separate gates; enabling RLS alone cannot repair a missing privilege, and service-role bypass does not remove the need for explicit table privileges.

## Existing baseline gap

`public.security_scan_hook_secrets` is referenced by `20260623075035_7ab8a0a4-1e1d-40f5-b9c0-cf865b8078cf.sql` and `src/routes/api/public/hooks/security-scan-daily.ts`, but no CREATE TABLE or explicit GRANT for that table exists in the migration history. A new/reset database therefore cannot be certified complete from this history. Obtain the authoritative definition and intended backend privilege from the actual project's schema through a read-only export; do not invent its columns or any secret values. This issue predates the October 30 change.

## Reproducible checks

```sh
python3 -m pip install -r scripts/data-api-audit-requirements.txt
python3 scripts/audit-data-api-grants.py --check --self-test
npm ci --prefix scripts/data-api-tests --ignore-scripts --no-audit --no-fund
node scripts/data-api-tests/storage-focused.mjs "$PWD"
```

`pglast==8.7` parses every migration; the guard requires explicit same-file grants for newly created tables and BIGSERIAL sequences, explicit RLS for surviving public tables, and the narrow worker-column privilege contract. It accepts deliberate service-only tables without adding client grants. Mutation fixtures remove column/table/sequence grants and omit RLS after DROP/CREATE; all must be detected. The dedicated `Explicit Data API grants` PR workflow needs no database secret and performs no deployment.

`data-api-grants-2026-10-23.json` contains each object's creation/drop paths, explicit ACL timeline, literal application access references, and policy source declarations. It models top-level SQL declarations with no automatic default grants. Policy entries are source evidence, **not the final executed pg_policy catalog**; conditional/dynamic PL/pgSQL blocks are listed for runtime review. The snapshot must be reviewed before regeneration using `--write`; a clean static check is not proof of a completed database reset or Data API test.

The focused PGlite test (pinned `@electric-sql/pglite@0.5.11`, PostgreSQL 18.6) executes the exact relevant `user_roles`/`app_settings` DDL, final RLS and helper definitions with minimal local auth/storage fixtures and no default grants. All **11 assertions pass**: baseline admin UPDATE denied; historical column grant fixes fresh replay; forward grant is idempotent; admin updates config; ordinary user cannot read/update the row; anon cannot update; admin cannot update another column or a mixed set; INSERT and DELETE remain denied. Evidence: `data-api-grants-postgres-results.json`. This test does not run a PostgREST/GraphQL server.

A full baseline replay was attempted locally and stopped at the existing `20260618164206_email_infra.sql` because PGlite does not provide `pg_net` (16 earlier migrations applied). This is an environment limitation, not a successful full reset. The later missing `security_scan_hook_secrets` definition is an independent source-history blocker. A read-only hosted anonymous probe also returned HTTP 503, which provides no evidence of GRANT correctness. Authenticated hosted access was unavailable.

Required before applying to production: replay the authoritative full baseline and migrations on an isolated Supabase project/branch with automatic DML grants disabled; inspect final table/column/sequence ACL and pg_policy catalogs; verify REST with admin, ordinary authenticated and anonymous JWTs, the worker portal RPC, retry logging, and public catalog flows. Review both surviving broad legacy ACLs and the missing hook-secret schema. Do not run `db reset` against a linked production project.

## Per-object declaration summary

The table below lists the **explicit declared privileges** after top-level GRANT/REVOKE/DROP processing. RLS further limits client access. `ALL*` denotes the existing table ALL grants, not a new grant from this fix. Full source paths and application evidence are in the JSON inventory.

| Object | Status | anon | authenticated | service_role |
| --- | --- | --- | --- | --- |
| `address_book` | table | — | delete, insert, select, update | ALL* |
| `admin_denial_events` | table | — | select | ALL* |
| `apk_download_events` | table | insert | insert, select | ALL* |
| `apk_min_supported` | table | select | select | ALL* |
| `apk_release_meta` | table | — | delete, insert, select, update | ALL* |
| `app_settings` | table | select | select, update(worker_portal_config) | ALL* |
| `auto_send_audit` | table | — | insert, select, update | ALL* |
| `business_notify_hook_config` | table | — | select | ALL* |
| `chat_blocks` | table | — | delete, insert, select | ALL* |
| `chat_call_hidden` | table | — | delete, insert, select | ALL* |
| `chat_calls` | table | — | insert, select, update | ALL* |
| `chat_delete_audit` | table | — | insert, select | ALL* |
| `chat_list_members` | table | — | delete, insert, select, update | ALL* |
| `chat_lists` | table | — | delete, insert, select, update | ALL* |
| `chat_notes` | table | — | delete, insert, select, update | ALL* |
| `chat_party_links` | table | — | delete, insert, select, update | ALL* |
| `chat_quick_replies` | table | — | delete, insert, select, update | ALL* |
| `conversation_members` | table | — | delete, insert, select, update | ALL* |
| `conversations` | table | — | delete, insert, select, update | ALL* |
| `customer_payments` | table | — | delete, insert, select, update | ALL* |
| `customers` | table | — | delete, insert, select, update | ALL* |
| `debt_adjust_audit` | table | — | delete, insert, select, update | ALL* |
| `debt_payments` | table | — | delete, insert, select, update | ALL* |
| `debts` | table | — | delete, insert, select, update | ALL* |
| `device_otp_challenges` | table | — | delete, insert, select, update | ALL* |
| `device_sessions` | table | — | delete, insert, select, update | ALL* |
| `doc_sequences` | table | — | — | ALL* |
| `ecer_preparations` | table | — | delete, insert, select, update | ALL* |
| `ecer_send_events` | table | — | delete, insert, select, update | ALL* |
| `ecer_titles` | table | — | delete, insert, select, update | ALL* |
| `email_monitor_config` | table | — | — | ALL* |
| `email_queue_alerts` | table | — | — | ALL* |
| `email_send_log` | table | — | — | ALL* |
| `email_send_state` | table | — | — | ALL* |
| `email_unsubscribe_tokens` | table | — | — | ALL* |
| `employees` | dropped | — | — | — |
| `fcm_tokens` | table | — | delete, insert, select, update | ALL* |
| `friend_notify_hook_config` | table | — | select | ALL* |
| `friend_requests` | table | — | delete, insert, select, update | ALL* |
| `message_hidden` | table | — | delete, insert, select | ALL* |
| `message_reactions` | table | — | delete, insert, select, update | ALL* |
| `messages` | table | — | delete, insert, select, update | ALL* |
| `order_request_events` | table | — | insert, select | ALL* |
| `order_requests` | table | — | delete, insert, select, update | ALL* |
| `org_branding` | table | — | delete, insert, select, update | ALL* |
| `portal_error_alerts` | table | — | select, update | ALL* |
| `portal_error_audit` | table | — | select | ALL* |
| `portal_error_events` | table | — | select | ALL* |
| `prep_link_deliveries` | table | — | delete, insert, select, update | ALL* |
| `prep_pin_alerts` | table | — | select, update | ALL* |
| `prep_pin_failures` | table | — | select | ALL* |
| `prep_submissions` | table | — | delete, insert, select, update | ALL* |
| `prep_submissions_unrouted` | view | — | select | select |
| `prep_submit_wa_hook` | table | — | insert, select, update | ALL* |
| `prep_task_items` | table | — | delete, insert, select, update | ALL* |
| `prep_task_notify_hook_config` | table | — | select | ALL* |
| `prep_task_request_titles` | table | — | delete, insert, select, update | ALL* |
| `prep_task_wa_hook_log` | table | — | select, update(error), update(last_retry_at), update(retry_count), update(send_status) | ALL* |
| `prep_tasks` | table | — | delete, insert, select, update | ALL* |
| `prep_upload_grants` | table | — | — | ALL* |
| `profiles` | table | — | delete, insert, select, update | ALL* |
| `public_catalog_settings` | table | — | delete, insert, select, update | ALL* |
| `purchases` | table | — | delete, insert, select, update | ALL* |
| `push_action_nonces` | table | — | — | ALL* |
| `push_subscriptions` | table | — | delete, insert, select, update | ALL* |
| `query_metrics` | table | — | insert, select | ALL* |
| `query_metrics_daily_v1` | view | — | select | — |
| `query_metrics_id_seq` | sequence | — | select, usage | select, update, usage |
| `ready_packages` | table | — | delete, insert, select, update | ALL* |
| `request_preparation_items` | table | — | delete, insert, select, update | ALL* |
| `request_preparations` | table | — | delete, insert, select, update | ALL* |
| `request_title_items` | table | — | delete, insert, select, update | ALL* |
| `request_titles` | table | — | delete, insert, select, update | ALL* |
| `sales` | table | — | delete, insert, select, update | ALL* |
| `scroll_guard_config` | table | — | delete, insert, select, update | ALL* |
| `security_scan_findings` | table | — | select | ALL* |
| `security_scan_runs` | table | — | select | ALL* |
| `self_prep_items` | table | — | delete, insert, select, update | ALL* |
| `shipment_hook_config` | table | — | — | ALL* |
| `signup_attempts` | table | — | — | ALL* |
| `signup_attempts_id_seq` | sequence | — | — | select, usage |
| `staff_contacts` | table | — | delete, insert, select, update | ALL* |
| `status_comments` | table | — | delete, insert, select | ALL* |
| `status_likes` | table | — | delete, insert, select | ALL* |
| `statuses` | table | — | delete, insert, select, update | ALL* |
| `stock_ledger` | table | — | select | ALL* |
| `subscription_events` | table | — | select | ALL* |
| `subscription_payments` | table | — | insert, select | ALL* |
| `subscriptions` | table | — | select | ALL* |
| `supplier_payments` | table | — | delete, insert, select, update | ALL* |
| `suppliers` | table | — | delete, insert, select, update | ALL* |
| `suppressed_emails` | table | — | — | ALL* |
| `turnstile_config` | dropped | — | — | — |
| `user_appearance_prefs` | table | — | delete, insert, select, update | ALL* |
| `user_devices` | table | — | select | ALL* |
| `user_notif_prefs` | table | — | delete, insert, select, update | ALL* |
| `user_roles` | table | — | select | ALL* |
| `user_storage` | table | — | delete, insert, select, update | ALL* |
| `wa_message_templates` | table | — | delete, insert, select, update | ALL* |
| `warehouse_categories` | table | — | delete, insert, select, update | ALL* |
| `warehouse_category_variants` | table | — | delete, insert, select, update | ALL* |
| `warehouse_item_variants` | table | — | delete, insert, select, update | ALL* |
| `warehouse_items` | table | — | delete, insert, select, update | ALL* |
| `web_vital_alert_config` | table | — | select, update | ALL* |
| `web_vital_alerts` | table | — | select, update | ALL* |
| `web_vital_samples` | table | — | — | ALL* |
| `web_vital_samples_id_seq` | sequence | — | — | select, usage |
| `worker_submit_idempotency` | table | — | — | ALL* |
