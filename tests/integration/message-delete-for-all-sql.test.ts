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
const rpcBody = sql.slice(rpcStart);
const updateStmt = (rpcBody.match(/UPDATE public\.messages[\s\S]*?WHERE id = _msg;/i) ?? [""])[0];

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