/**
 * SPRINT 5 (Critical) — pagar regresi untuk urutan RPC submit portal pegawai.
 *
 * Bug aslinya: pada `prep_submit`, `UPDATE warehouse_items` (pemotongan stok)
 * dijalankan SEBELUM reservasi `worker_submit_idempotency`. Dua panggilan
 * dengan (task_id, client_key) sama bisa sama-sama memotong stok, lalu yang
 * kedua kena ON CONFLICT dan mengembalikan hasil lama — stok dan stock_ledger
 * terpotong dua kali tanpa jejak error.
 *
 * Tes ini membaca definisi fungsi apa adanya dari migrasi terakhir yang
 * mendefinisikannya dan menegakkan tiga invarian struktural:
 *   1. Baris tugas dikunci (`FOR UPDATE`) sebelum pemeriksaan apa pun.
 *   2. Semua pemeriksaan pembatas (limit, stok) berada di dalam kunci itu.
 *   3. Reservasi idempotensi mendahului SEMUA statement mutasi.
 *
 * Ini sengaja statis: RPC-nya SECURITY DEFINER dan hanya bisa dieksekusi lewat
 * peran anon/authenticated, jadi CI tidak boleh memanggilnya ke database
 * produksi. Uji perilaku end-to-end-nya ada di
 * `scripts/concurrency-worker-submit.mjs` (manual, butuh fixture eksplisit).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = join(process.cwd(), "supabase/migrations");

/** Ambil badan `CREATE OR REPLACE FUNCTION <name>` dari migrasi TERBARU yang memuatnya. */
function latestFunctionBody(name: string): string {
  const files = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();
  for (const f of files) {
    const sql = readFileSync(join(MIG_DIR, f), "utf8");
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start === -1) continue;
    const end = sql.indexOf("$function$;", start);
    expect(end, `penutup $function$ untuk ${name} di ${f}`).toBeGreaterThan(start);
    return sql.slice(start, end);
  }
  throw new Error(`definisi ${name} tidak ditemukan di supabase/migrations`);
}

const TASK_LOCK = "FROM public.prep_tasks WHERE id = v_task.id FOR UPDATE";
const RESERVE = "INSERT INTO public.worker_submit_idempotency";

/** Statement mutasi yang TIDAK boleh mendahului reservasi. */
const MUTATIONS: Record<string, string[]> = {
  prep_submit: [
    "SET stock_base = stock_base - v_deduct",
    "INSERT INTO public.prep_submissions",
    "INSERT INTO public.ecer_preparations",
    "UPDATE public.prep_task_items",
  ],
  ecer_submit_via_task: ["INSERT INTO public.ecer_preparations"],
  request_submit_via_task: [
    "INSERT INTO public.request_preparations",
    "INSERT INTO public.request_preparation_items",
  ],
};

/** Pemeriksaan yang harus berada DI DALAM kunci baris tugas. */
const GUARDED_CHECKS: Record<string, string[]> = {
  prep_submit: [
    "SELECT count(*) INTO v_used FROM public.prep_submissions",
    "v_used >= v_limit",
    "FROM public.warehouse_items",
    "insufficient_stock",
    "item_changed",
  ],
  ecer_submit_via_task: ["FROM public.ecer_titles WHERE id = _title_id"],
  request_submit_via_task: [
    "SELECT count(*) INTO v_used FROM public.request_preparations",
    "v_used >= coalesce(v_task.max_submissions, 1)",
  ],
};

describe.each(Object.keys(MUTATIONS))("RPC submit pegawai: %s", (fn) => {
  const body = latestFunctionBody(fn);
  const lock = body.indexOf(TASK_LOCK);
  const reserve = body.indexOf(RESERVE);

  it("mengunci baris tugas sebagai titik serialisasi", () => {
    expect(lock, "SELECT ... FOR UPDATE pada prep_tasks wajib ada").toBeGreaterThan(-1);
  });

  it("mereservasi kunci idempotensi", () => {
    expect(reserve, "reservasi worker_submit_idempotency wajib ada").toBeGreaterThan(-1);
  });

  it("mereservasi kunci setelah kunci baris tugas diambil", () => {
    expect(reserve).toBeGreaterThan(lock);
  });

  it.each(MUTATIONS[fn]!)("tidak memutasi sebelum reservasi: %s", (stmt) => {
    const at = body.indexOf(stmt);
    if (at === -1) return; // statement opsional untuk fungsi ini
    expect(
      at,
      `"${stmt}" berjalan sebelum reservasi idempotensi — retry akan memutasi dua kali`,
    ).toBeGreaterThan(reserve);
  });

  it.each(GUARDED_CHECKS[fn]!)("memeriksa di dalam kunci tugas: %s", (check) => {
    const at = body.indexOf(check);
    expect(at, `pemeriksaan "${check}" tidak ditemukan`).toBeGreaterThan(-1);
    expect(
      at,
      `pemeriksaan "${check}" berjalan sebelum kunci tugas — dua transaksi bisa sama-sama lolos`,
    ).toBeGreaterThan(lock);
  });

  it("membatalkan reservasi bila terjadi kegagalan (tidak ada COMMIT parsial)", () => {
    // plpgsql: blok fungsi adalah satu subtransaksi. Yang dilarang adalah
    // COMMIT eksplisit di tengah, yang akan mengunci reservasi walau mutasi gagal.
    expect(body).not.toMatch(/\bCOMMIT\b/i);
  });

  it("hanya menulis hasil ke kunci setelah semua mutasi selesai", () => {
    const write = body.indexOf("UPDATE public.worker_submit_idempotency SET result");
    expect(write).toBeGreaterThan(reserve);
    for (const stmt of MUTATIONS[fn]!) {
      const at = body.indexOf(stmt);
      if (at !== -1) expect(write).toBeGreaterThan(at);
    }
  });
});
