/**
 * Parity test: fungsi normalisasi di klien HARUS sama persis dengan fungsi
 * database (`public.normalize_phone` / `public.normalize_email`) yang mengisi
 * kolom ter-generate `phone_norm` / `email_norm`. Kalau berbeda, dedup di
 * klien lolos tapi Supabase menolak (23505) — atau lebih buruk, duplikat
 * tersimpan diam-diam.
 *
 * Dilewati otomatis saat koneksi database tidak tersedia (mis. CI tanpa PG).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { normalizeEmail, normalizePhone } from "@/lib/address-book";

const hasDb = !!process.env["PGHOST"];

function sqlValue(expr: string, value: string): string | null {
  const out = execFileSync(
    "psql",
    ["-At", "-c", `select coalesce(${expr}, '<null>')`],
    { encoding: "utf8", timeout: 20_000, env: { ...process.env, PGVALUE: value } },
  ).trim();
  return out === "<null>" ? null : out;
}

const PHONES = [
  "0812-3456-7890",
  "+62 812 3456 7890",
  "62 812 3456 7890",
  "0062 812 3456 7890",
  "(0812) 34567890",
  "81234567890",
  "620812 3456 7890",
  "",
  "-",
];
const EMAILS = [
  "Budi.Santoso@Gmail.com",
  "budi.santoso+promo@googlemail.com",
  " ANI@Mail.COM ",
  "tanpa-domain",
  "",
];

describe.skipIf(!hasDb)("parity normalisasi klien vs database", () => {
  it("normalize_phone identik", () => {
    for (const p of PHONES) {
      const db = sqlValue(`public.normalize_phone(${literal(p)})`, p);
      expect(normalizePhone(p), `phone: ${p}`).toBe(db);
    }
  });

  it("normalize_email identik", () => {
    for (const e of EMAILS) {
      const db = sqlValue(`public.normalize_email(${literal(e)})`, e);
      expect(normalizeEmail(e), `email: ${e}`).toBe(db);
    }
  });
});

function literal(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}
