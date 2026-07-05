/**
 * Regression: RPC `send_request_prep_to_customer` sempat gagal karena
 * `debts_source_check` awalnya hanya memuat ('manual','purchase','sale')
 * padahal RPC menulis debt dengan source `'request_prep'`. Test ini mengunci
 * dua invariants secara statis (tanpa live DB) langsung dari file migrasi:
 *
 *   1. Constraint `debts_source_check` HARUS memuat `'request_prep'` di
 *      allowlist-nya (migrasi 20260705122006).
 *   2. RPC `send_request_prep_to_customer` HARUS meng-INSERT ke `public.debts`
 *      dengan `source = 'request_prep'` (bukan literal lain), dan HANYA saat
 *      metode bayar = 'hutang' + total > 0.
 *
 * Bila salah satu regresi, kirim penyiapan request dengan metode hutang akan
 * balas 23514 (check violation) dan piutang tidak tercatat — sama dengan bug
 * asli yang memaksa pelebaran constraint.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { assertDebtSource, DEBT_SOURCES } from "@/lib/debt-source";

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");

function readAllMigrations(): string {
  return readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort() // urutan kronologis by timestamp prefix
    .map((f) => readFileSync(join(MIG_DIR, f), "utf8"))
    .join("\n\n-- ==== next migration ====\n\n");
}

const allSql = readAllMigrations();

/** Ambil klausul CHECK aktif terakhir untuk `debts_source_check`. */
function latestDebtsSourceCheck(): string | null {
  const re = /ADD\s+CONSTRAINT\s+debts_source_check\s+CHECK\s*\(([\s\S]*?)\)\s*;/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(allSql)) !== null) last = m[1];
  return last;
}

/** Ambil body RPC `send_request_prep_to_customer` versi terbaru. */
function latestRpcBody(): string | null {
  const re =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.send_request_prep_to_customer[\s\S]*?\$function\$([\s\S]*?)\$function\$/gi;
  const re2 =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.send_request_prep_to_customer[\s\S]*?AS\s+\$\$([\s\S]*?)\$\$/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(allSql)) !== null) last = m[1];
  if (last) return last;
  while ((m = re2.exec(allSql)) !== null) last = m[1];
  return last;
}

describe("send_request_prep_to_customer × debts_source_check", () => {
  const checkExpr = latestDebtsSourceCheck();
  const rpcBody = latestRpcBody();

  it("migrasi mendefinisikan `debts_source_check` yang memuat 'request_prep'", () => {
    expect(checkExpr, "ADD CONSTRAINT debts_source_check tidak ditemukan di migrasi").toBeTruthy();
    // Semua sumber allowlist SSOT harus disebut di ekspresi CHECK.
    for (const src of ["manual", "purchase", "sale", "request_prep"] as const) {
      expect(checkExpr!).toMatch(new RegExp(`'${src}'`));
    }
  });

  it("SSOT `DEBT_SOURCES` sinkron dengan allowlist constraint (tidak ada nilai liar)", () => {
    // Setiap literal string di antara tanda kutip pada ekspresi CHECK harus
    // muncul di SSOT — dan sebaliknya.
    const literals = Array.from(checkExpr!.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
    expect(new Set(literals)).toEqual(new Set(DEBT_SOURCES));
  });

  it("RPC ditemukan dan meng-INSERT `debts` dengan source='request_prep'", () => {
    expect(rpcBody, "Body RPC send_request_prep_to_customer tidak ditemukan").toBeTruthy();
    // Blok INSERT INTO public.debts ... 'request_prep'.
    const insertDebts = rpcBody!.match(/INSERT\s+INTO\s+public\.debts[\s\S]*?;/i);
    expect(insertDebts, "INSERT INTO public.debts tidak ada di RPC").toBeTruthy();
    expect(insertDebts![0]).toMatch(/'request_prep'/);
    // Tidak boleh ada literal source lain di dalam blok INSERT tsb.
    const otherSources = Array.from(insertDebts![0].matchAll(/'(manual|purchase|sale)'/g));
    expect(otherSources, "RPC menulis source selain 'request_prep' — regresi").toHaveLength(0);
  });

  it("RPC hanya menulis piutang saat metode 'hutang' DAN total > 0", () => {
    // Cari blok IF pembungkus INSERT debts.
    const guard = rpcBody!.match(
      /IF\s+_payment_method\s*=\s*'hutang'[\s\S]*?_total_amount\s*>\s*0[\s\S]*?INSERT\s+INTO\s+public\.debts[\s\S]*?END\s+IF\s*;/i,
    );
    expect(
      guard,
      "RPC harus membungkus INSERT debts di dalam IF _payment_method='hutang' AND _total_amount>0",
    ).toBeTruthy();
    expect(guard![0]).toMatch(/kind\s*=?\s*['"]?piutang['"]?|'piutang'/i);
  });

  it("RPC memvalidasi _payment_method hanya menerima 'kas' atau 'hutang'", () => {
    // Cegah regresi ke enum bebas yang bisa menembus guard piutang.
    expect(rpcBody!).toMatch(/_payment_method\s+NOT\s+IN\s*\(\s*'kas'\s*,\s*'hutang'\s*\)/i);
  });

  it("guard klien `assertDebtSource` menerima 'request_prep' TAPI klien memakai 'manual'", () => {
    // Sanity: SSOT konsisten — 'request_prep' valid, 'chat' tidak.
    expect(() => assertDebtSource("request_prep")).not.toThrow();
    expect(() => assertDebtSource("manual")).not.toThrow();
    expect(() => assertDebtSource("chat")).toThrow(/tidak valid/i);
  });
});
