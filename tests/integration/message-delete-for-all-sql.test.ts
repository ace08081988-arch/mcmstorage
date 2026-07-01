/**
 * Regression: RPC message_delete_for_all sempat balas 400 (23514) karena
 * constraint messages_check menuntut body ATAU attachment_path non-null,
 * padahal soft-delete memang men-NULL-kan keduanya. Constraint sudah
 * direlaksasi supaya baris dengan deleted_at terisi boleh punya body &
 * attachment NULL. Test ini mengunci dua invariants sekaligus:
 *   1. Constraint mengizinkan (body=NULL, attachment_path=NULL, deleted_at NOT NULL).
 *   2. Body RPC memang men-NULL-kan body + attachment_path dan mengeset deleted_at=now().
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL_PATH = resolve(__dirname, "../fixtures/message_delete_for_all.sql");
const sql = readFileSync(SQL_PATH, "utf8");

// Ambil klausul CHECK dari ALTER TABLE ... ADD CONSTRAINT messages_check.
const checkMatch = sql.match(
  /ADD CONSTRAINT messages_check\s+CHECK\s*\(([\s\S]*?)\);/i,
);

// Ambil body plpgsql RPC message_delete_for_all.
const rpcStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.message_delete_for_all");
const rpcSingleEnd = sql.indexOf("CREATE OR REPLACE FUNCTION public.message_delete_all_mine");
const rpcBody = sql.slice(rpcStart, rpcSingleEnd > 0 ? rpcSingleEnd : undefined);
const updateStmt = (rpcBody.match(/UPDATE public\.messages[\s\S]*?WHERE id = _msg;/i) ?? [""])[0];

// Ambil body plpgsql RPC message_delete_all_mine (bulk).
const bulkStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.message_delete_all_mine");
const bulkBody = bulkStart >= 0 ? sql.slice(bulkStart) : "";
const bulkUpdate = (bulkBody.match(/UPDATE public\.messages[\s\S]*?RETURNING t\.attachment_path/i) ?? [""])[0];

function evalCheck(expr: string, row: { body: string | null; attachment_path: string | null; deleted_at: string | null }): boolean {
  // Terjemahkan CHECK ke boolean JS: (deleted_at IS NOT NULL) OR (body IS NOT NULL) OR (attachment_path IS NOT NULL)
  const isNotNull = (col: keyof typeof row) => row[col] !== null;
  // Regex-check bahwa ekspresi persis tiga OR "IS NOT NULL" untuk kolom yang benar.
  const cols = [...expr.matchAll(/(\w+)\s+IS\s+NOT\s+NULL/gi)].map((m) => m[1].toLowerCase());
  return cols.some((c) => isNotNull(c as keyof typeof row));
}

describe("messages_check constraint (post-relaksasi)", () => {
  it("didefinisikan ulang dengan tiga cabang IS NOT NULL", () => {
    expect(checkMatch, "ADD CONSTRAINT messages_check tidak ditemukan").toBeTruthy();
    const expr = checkMatch![1];
    expect(expr).toMatch(/deleted_at\s+IS\s+NOT\s+NULL/i);
    expect(expr).toMatch(/body\s+IS\s+NOT\s+NULL/i);
    expect(expr).toMatch(/attachment_path\s+IS\s+NOT\s+NULL/i);
    // Harus pakai OR, bukan AND — kalau AND regresi total.
    expect(expr).toMatch(/\bOR\b/i);
    expect(expr).not.toMatch(/\bAND\b/i);
  });

  it("mengizinkan baris soft-deleted dengan body & attachment_path NULL", () => {
    const expr = checkMatch![1];
    expect(
      evalCheck(expr, { body: null, attachment_path: null, deleted_at: "2026-07-01T00:00:00Z" }),
    ).toBe(true);
  });

  it("tetap menolak baris hidup tanpa body & attachment_path (deleted_at NULL)", () => {
    const expr = checkMatch![1];
    expect(
      evalCheck(expr, { body: null, attachment_path: null, deleted_at: null }),
    ).toBe(false);
  });

  it("menerima baris hidup dengan body saja / attachment saja", () => {
    const expr = checkMatch![1];
    expect(evalCheck(expr, { body: "halo", attachment_path: null, deleted_at: null })).toBe(true);
    expect(evalCheck(expr, { body: null, attachment_path: "a/b.jpg", deleted_at: null })).toBe(true);
  });
});

describe("messages_check truth table — body & attachment NULL hanya lolos saat deleted_at terisi", () => {
  const expr = checkMatch![1];
  const V = "x"; // any non-null sentinel
  const D = "2026-07-01T00:00:00Z";

  // (body, attachment_path, deleted_at) -> expected accept?
  const cases: Array<[
    string | null,
    string | null,
    string | null,
    boolean,
    string,
  ]> = [
    // deleted_at NULL — minimal salah satu body/attachment harus ada.
    [null, null, null, false, "hidup & kosong total → DITOLAK"],
    [V,    null, null, true,  "hidup + body → diterima"],
    [null, V,    null, true,  "hidup + attachment → diterima"],
    [V,    V,    null, true,  "hidup + body & attachment → diterima"],
    // deleted_at terisi — semua kombinasi harus diterima (termasuk yang keduanya NULL).
    [null, null, D,    true,  "soft-deleted & kosong total → DITERIMA (case kunci soft-delete)"],
    [V,    null, D,    true,  "soft-deleted + body sisa → diterima"],
    [null, V,    D,    true,  "soft-deleted + attachment sisa → diterima"],
    [V,    V,    D,    true,  "soft-deleted + keduanya sisa → diterima"],
  ];

  it.each(cases)(
    "body=%s attachment=%s deleted_at=%s → %s (%s)",
    (body, attachment_path, deleted_at, expected) => {
      expect(evalCheck(expr, { body, attachment_path, deleted_at })).toBe(expected);
    },
  );

  it("body & attachment NULL: ditolak saat deleted_at NULL, diterima saat deleted_at terisi", () => {
    expect(evalCheck(expr, { body: null, attachment_path: null, deleted_at: null })).toBe(false);
    expect(evalCheck(expr, { body: null, attachment_path: null, deleted_at: D })).toBe(true);
  });
});

describe("message_delete_all_mine (bulk) — konsisten dengan constraint yang direlaksasi", () => {
  it("men-NULL-kan body + semua kolom attachment sekaligus mengeset deleted_at", () => {
    expect(bulkUpdate, "UPDATE bulk tidak ditemukan").toBeTruthy();
    expect(bulkUpdate).toMatch(/deleted_at\s*=\s*now\(\)/i);
    expect(bulkUpdate).toMatch(/body\s*=\s*NULL/i);
    expect(bulkUpdate).toMatch(/attachment_path\s*=\s*NULL/i);
    expect(bulkUpdate).toMatch(/attachment_name\s*=\s*NULL/i);
    expect(bulkUpdate).toMatch(/attachment_mime\s*=\s*NULL/i);
    expect(bulkUpdate).toMatch(/attachment_size\s*=\s*NULL/i);
  });

  it("hanya menyasar pesan milik caller yang belum ter-soft-delete", () => {
    expect(bulkBody).toMatch(/sender_id\s*=\s*v_uid/i);
    expect(bulkBody).toMatch(/deleted_at IS NULL/i);
  });

  it("gate keanggotaan conversation dijalankan sebelum UPDATE", () => {
    // Urutan penting: cek member → baru UPDATE. Kalau kebalik, non-member bisa ikut menghapus.
    const memberIdx = bulkBody.search(/is_conversation_member/i);
    const updIdx = bulkBody.search(/UPDATE public\.messages/i);
    expect(memberIdx).toBeGreaterThan(-1);
    expect(updIdx).toBeGreaterThan(-1);
    expect(memberIdx).toBeLessThan(updIdx);
  });

  it.each([
    ["body saja", "halo", null],
    ["attachment saja", null, "a/b.jpg"],
    ["body + attachment", "halo", "a/b.jpg"],
  ] as const)(
    "varian input '%s': hasil UPDATE (body=NULL, attachment=NULL, deleted_at=now()) tetap lolos messages_check",
    (_label, bodyBefore, attBefore) => {
      const expr = checkMatch![1];
      // Sebelum bulk delete: baris hidup → harus lolos (guard sanity).
      expect(evalCheck(expr, { body: bodyBefore, attachment_path: attBefore, deleted_at: null })).toBe(true);
      // Sesudah bulk delete: RPC NULL-kan body + attachment, isi deleted_at.
      expect(evalCheck(expr, { body: null, attachment_path: null, deleted_at: "2026-07-01T00:00:00Z" })).toBe(true);
    },
  );

  it("RETURNING hanya mengembalikan attachment_path non-null untuk cleanup storage", () => {
    expect(bulkBody).toMatch(/SELECT attachment_path FROM upd WHERE attachment_path IS NOT NULL/i);
  });
});

describe("message_delete_for_all RPC body", () => {
  it("melakukan UPDATE public.messages yang men-NULL-kan body & attachment_path", () => {
    expect(updateStmt, "UPDATE public.messages tidak ditemukan di RPC").toBeTruthy();
    expect(updateStmt).toMatch(/body\s*=\s*NULL/i);
    expect(updateStmt).toMatch(/attachment_path\s*=\s*NULL/i);
    expect(updateStmt).toMatch(/attachment_name\s*=\s*NULL/i);
    expect(updateStmt).toMatch(/attachment_mime\s*=\s*NULL/i);
    expect(updateStmt).toMatch(/attachment_size\s*=\s*NULL/i);
  });

  it("mengeset deleted_at = now() supaya cabang deleted_at pada CHECK terpenuhi", () => {
    expect(updateStmt).toMatch(/deleted_at\s*=\s*now\(\)/i);
  });

  it("RETURN attachment_path lama supaya storage bisa ikut dibersihkan", () => {
    expect(rpcBody).toMatch(/v_path\s*:=\s*v_m\.attachment_path/i);
    expect(rpcBody).toMatch(/RETURN v_path;/);
  });

  it("menolak caller yang bukan sender & bukan owner conversation (forbidden)", () => {
    expect(rpcBody).toMatch(/RAISE EXCEPTION 'forbidden'/);
    expect(rpcBody).toMatch(/v_m\.sender_id\s*<>\s*v_uid/);
  });

  it("idempoten: kalau sudah deleted_at, langsung RETURN tanpa UPDATE ulang", () => {
    expect(rpcBody).toMatch(/IF v_m\.deleted_at IS NOT NULL THEN[\s\S]*?RETURN v_m\.attachment_path;[\s\S]*?END IF;/);
  });
});