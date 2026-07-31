/**
 * Kontrak keamanan endpoint publik `/api/public/hooks/log-portal-error`:
 *   - Payload tanpa `token` ditolak Zod (400 bad_payload).
 *   - Payload dengan `token` yang tidak cocok dengan `prep_tasks.share_token`
 *     aktif ditolak dengan 401 `invalid_token` — TIDAK ada baris yang
 *     ditulis ke `portal_error_events` / `portal_error_alerts`.
 *
 * Ini mengunci temuan scanner "unauthenticated error-logging endpoint":
 *   share_token adalah mekanisme auth endpoint ini, jadi request anonim
 *   tanpa token valid TIDAK boleh menghasilkan write apapun.
 *
 * Base URL diambil dari env `PORTAL_ERROR_BASE_URL` (mis. preview/prod).
 * Test di-skip bila env tidak diset supaya lokal tanpa dev server tidak
 * merah — CI mengeset env ini.
 */
import { describe, it, expect } from "vitest";

const BASE_URL =
  process.env.PORTAL_ERROR_BASE_URL ||
  process.env.PREVIEW_URL ||
  process.env.PUBLISHED_URL ||
  "";

const d = BASE_URL ? describe : describe.skip;
const ENDPOINT = "/api/public/hooks/log-portal-error";

async function post(body: unknown): Promise<Response> {
  return fetch(new URL(ENDPOINT, BASE_URL).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

d("POST /api/public/hooks/log-portal-error — auth via share_token", () => {
  it("menolak payload tanpa token dengan 400 (Zod bad_payload)", async () => {
    const res = await post({ kind: "test_missing_token" });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/bad_payload|bad_json/i);
  });

  it("menolak token yang tidak ada di prep_tasks dengan 401 invalid_token", async () => {
    const res = await post({
      kind: "test_invalid_token",
      token: "definitely-not-a-real-share-token-" + Date.now(),
    });
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).toMatch(/invalid_token|token_revoked|token_expired/i);
  });

  it("menolak body non-JSON dengan 400 bad_json", async () => {
    const res = await fetch(new URL(ENDPOINT, BASE_URL).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json-at-all",
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/bad_json|bad_payload/i);
  });

  it("menolak token kosong (min length) dengan 400", async () => {
    const res = await post({ kind: "test_empty_token", token: "" });
    expect(res.status).toBe(400);
  });
});