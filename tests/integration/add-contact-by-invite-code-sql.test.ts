/**
 * Regression: fungsi RPC add_contact_by_invite_code sempat error
 * "column reference 'linked_user_id' is ambiguous" karena OUT parameter
 * bertabrakan dengan kolom address_book. Tes ini mengunci definisi fungsi
 * yang sudah di-qualify (ab.<col>) supaya regresi tidak kembali.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL_PATH = resolve(__dirname, "../fixtures/add_contact_by_invite_code.sql");
const sql = readFileSync(SQL_PATH, "utf8");

// Ambil isi body function.
const body = sql.slice(sql.indexOf("BEGIN"), sql.lastIndexOf("END;"));

describe("add_contact_by_invite_code SQL", () => {
  it("mendeklarasikan OUT param linked_user_id (yang jadi sumber ambigu)", () => {
    expect(sql).toMatch(/RETURNS TABLE\([^)]*linked_user_id\s+uuid/i);
  });

  it("tidak pernah mereferensikan linked_user_id tanpa alias di WHERE/SET", () => {
    // Cocokkan setiap kemunculan linked_user_id di dalam body function.
    const hits = [...body.matchAll(/([A-Za-z_.]*)linked_user_id/g)];
    // Setiap kemunculan harus di-prefix `ab.` atau muncul di daftar kolom INSERT/VALUES/RETURNING TABLE header.
    for (const h of hits) {
      const prefix = h[1];
      // Boleh kosong hanya kalau baris tersebut adalah kolom di INSERT (…, linked_user_id, …)
      // yang aman karena bukan referensi kolom di WHERE.
      const line = body.slice(0, h.index).split("\n").pop() ?? "";
      const inInsertList = /INSERT INTO public\.address_book \([^)]*$/i.test(line);
      if (inInsertList) continue;
      expect(prefix, `linked_user_id tanpa alias pada: ${line.trim()}`).toBe("ab.");
    }
  });

  it("query pencarian existing menggunakan alias ab.", () => {
    expect(body).toMatch(/FROM public\.address_book ab[\s\S]*ab\.user_id\s*=\s*me[\s\S]*ab\.linked_user_id\s*=\s*found_profile\.id/i);
  });

  it("UPDATE address_book di-alias & COALESCE(ab.source, …)", () => {
    expect(body).toMatch(/UPDATE public\.address_book ab[\s\S]*COALESCE\(ab\.source/i);
  });
});
