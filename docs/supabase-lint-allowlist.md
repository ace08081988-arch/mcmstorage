# Supabase Lint Allowlist — Architectural Taxonomy

File: `.github/supabase-lint-allowlist.json`
Checker: `scripts/check-supabase-lints.mjs` (workflow `.github/workflows/supabase-linter.yml`)

The two Supabase lints

- `0028_anon_security_definer_function_executable`
- `0029_authenticated_security_definer_function_executable`

fire on every `SECURITY DEFINER` function in `public` that has `EXECUTE` granted to `anon` / `authenticated`. Because MCM's architecture uses `SECURITY DEFINER` deliberately in several distinct roles, we suppress these findings **per architectural bucket**, not per function. Each bucket has a stable `category` key and its own `reason` field; adding a new function to an existing bucket is a routine change, adding a new bucket requires a documented architectural justification.

## Bucket catalogue

### `worker-portal-share-token` (anon only)
Field-worker RPCs called from `/portal/*` share links. There is no Supabase account; the caller authenticates each call with `share_token + bcrypt(PIN)` inside the function body. Anon `EXECUTE` **is** the auth surface. Failure ratelimiting lives in `prep_pin_failures` / `prep_pin_alerts`.

### `trigger-only` (anon)
`enforce_free_*_cap`, `prevent_debt_*`, `handle_new_user_subscription`. These run only as trigger bodies. Postgres executes triggers with the session role regardless of `EXECUTE` grants; the linter cannot distinguish trigger-only functions from RPCs. Direct RPC invocation returns early because `TG_OP` / `NEW` is null.

### `cron-and-queue` (anon)
`email_queue_dispatch`, `email_queue_wake`. Scheduled by `pg_cron` / `pgmq`. No user-scoped writes, no PII exposure — grant kept for scheduler enumeration.

### `signup-transition` (anon)
`gen_invite_code`, `has_active_pro`, `is_chat_only`, `match_address_book_profiles`. Invoked during the signup handshake before Supabase issues the authenticated JWT (auth trigger context = anon). Each function either short-circuits when `auth.uid() IS NULL` or exposes a public plan flag.

### `authuid-guarded-user-rpc` (anon AND authenticated)
First-party user RPCs whose grant is `TO PUBLIC` (so both anon and authenticated get `EXECUTE`). Every body starts with `IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'` and then scopes every read/write to `auth.uid()`. Tightening the grant to `TO authenticated` is a tracked cleanup — see `docs/security-definer-inventory.md`.

### `rls-predicate` (authenticated)
`has_role`, `can_chat`, `is_conversation_member`, `is_conversation_owner`. Authorization predicates used inside RLS policies and other definers. `SECURITY DEFINER` is required to break RLS recursion. Read-only, boolean, no side effects.

### `admin-role-gated` (authenticated)
RPCs whose first statement is `IF NOT has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'`. `SECURITY DEFINER` is required to bypass RLS on `auth.users`, `subscriptions`, `security_findings`. Non-admin rejection is asserted by `supabase/tests/security_definer_authz.sql`.

## Schema rules (enforced by CI)

`scripts/check-supabase-lints.mjs` validates the JSON before it queries Supabase, and the workflow's `validate-allowlist` job runs it with `VALIDATE_ONLY=1` on every PR (no secrets needed). It fails the build when any of the following is violated:

- `name`, `level` (`INFO|WARN|ERROR`), `category`, `reason`, and `functions` are all required.
- `reason` must be **≥ 40 characters** — a substantive architectural justification, not a placeholder.
- `category` must be **unique per rule** — merge additions into the existing bucket instead of creating a duplicate.
- Every function must be **schema-qualified** (`schema.name`), non-empty, and appear **at most once per rule** — a function belongs to exactly one bucket.

Run locally with `VALIDATE_ONLY=1 node scripts/check-supabase-lints.mjs`.

## Adding a function (procedure)

1. Identify which bucket the new function belongs to. If none fits, propose a new bucket in this file first with an architectural justification, then add it to the JSON.
2. Append the fully qualified name (`public.<fn>`) to the appropriate `functions` array. Keep the array alphabetised.
3. Extend `supabase/tests/security_definer_authz.sql` with a rejection test for the new function under the matching group (worker-portal / authuid-guarded / admin-gated).
4. Run `npm run test:security:sql` locally; CI (`supabase-linter.yml`) will confirm no `unexpected` findings remain on the next push.

## Removing a function

If a function no longer needs `SECURITY DEFINER` (e.g. rewritten to `SECURITY INVOKER` with tightened RLS), drop it from the JSON in the same commit that changes the migration. The checker's "Allowlist entries not matched by this scan" section in the GitHub summary is the canary — a stale entry surfaces there before it can hide a real regression.

## Why per-bucket instead of a global "ignore these rules"

A blanket suppression would silence future regressions (a new admin RPC missing the `has_role` gate, a worker RPC missing the PIN check). Per-function + per-bucket keeps the CI signal: any new `SECURITY DEFINER` function is flagged until we consciously classify it.