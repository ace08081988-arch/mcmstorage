/**
 * Regression E2E-analisis SQL: RPC `request_list_titles_via_task` HARUS
 * memfilter paket request per-task (`via_task_id = v_task.id`).
 *
 * Sebelum perbaikan, filter `submitted_count` dan klausa NOT EXISTS
 * mengecek `request_preparations` secara global — sekali satu judul
 * disubmit di task manapun, judul yang sama tidak pernah muncul lagi
 * di task lain (mis. task baru dengan nama yang sama). Regresi ini
 * mengunci scope per-task dari body RPC terbaru.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");

function latestFnBody(): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  const re =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.request_list_titles_via_task[\s\S]*?AS\s+\$function\$([\s\S]*?)\$function\$/gi;
  let last: string | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIG_DIR, f), "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) last = m[1];
  }
  if (!last) throw new Error("RPC request_list_titles_via_task tidak ditemukan di migrasi");
  return last;
}

const body = latestFnBody();

function latestCreateTaskBody(): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  const re =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.prep_create_task[\s\S]*?AS\s+\$function\$([\s\S]*?)\$function\$/gi;
  let last: string | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIG_DIR, f), "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) last = m[1];
  }
  if (!last) throw new Error("RPC prep_create_task tidak ditemukan di migrasi");
  return last;
}

const createTaskBody = latestCreateTaskBody();

/** Ekstrak sub-query `submitted_count` (SELECT count(*) …). */
function submittedCountSubquery(): string {
  const m = body.match(/'submitted_count',\s*\(([\s\S]*?)\)\s*,/);
  if (!m) throw new Error("Sub-query submitted_count tidak ditemukan");
  return m[1];
}

/** Ekstrak klausa NOT EXISTS di WHERE. */
function notExistsClause(): string {
  const m = body.match(/NOT\s+EXISTS\s*\(([\s\S]*?)\)\s*;/i);
  if (!m) throw new Error("Klausa NOT EXISTS tidak ditemukan");
  return m[1];
}

describe("request_list_titles_via_task — scope per-task", () => {
  it("hitungan submitted_count difilter dengan via_task_id = v_task.id", () => {
    const sub = submittedCountSubquery();
    expect(sub).toMatch(/rp\.title_id\s*=\s*t\.id/i);
    expect(sub).toMatch(/rp\.user_id\s*=\s*v_task\.owner_user_id/i);
    expect(sub).toMatch(/rp\.via_task_id\s*=\s*v_task\.id/i);
  });

  it("submitted_count TIDAK memakai filter global tanpa via_task_id", () => {
    const sub = submittedCountSubquery();
    // Jangan sampai ada `via_task_id IS NOT NULL` (filter global lama).
    expect(sub).not.toMatch(/via_task_id\s+IS\s+NOT\s+NULL/i);
  });

  it("klausa NOT EXISTS untuk menyembunyikan judul juga scoped per-task", () => {
    const ne = notExistsClause();
    expect(ne).toMatch(/rp\.title_id\s*=\s*t\.id/i);
    expect(ne).toMatch(/rp\.via_task_id\s*=\s*v_task\.id/i);
    expect(ne).not.toMatch(/via_task_id\s+IS\s+NOT\s+NULL/i);
  });

  it("query utama JOIN prep_task_request_titles pada task saat ini", () => {
    // Judul hanya boleh muncul jika terhubung ke task lewat prep_task_request_titles.
    expect(body).toMatch(
      /JOIN\s+public\.prep_task_request_titles\s+ptrt\s+ON\s+ptrt\.title_id\s*=\s*t\.id\s+AND\s+ptrt\.task_id\s*=\s*v_task\.id/i,
    );
  });

  it("tidak memfilter judul berdasarkan nama (judul sama antar task tidak boleh bocor)", () => {
    // Regresi lama pernah dicoba memakai `t.name = …` untuk dedup — sekarang harus per-id.
    expect(body).not.toMatch(/t\.name\s*=\s*/i);
  });

  it("prep_create_task punya safety-net Request exact-match saat _title_ids kosong", () => {
    // Jika client lama/preview belum mengirim _title_ids, link `Request: X`
    // tetap harus menaut ke paket `X` saja — bukan fallback global semua paket aktif.
    expect(createTaskBody).toMatch(/NOT\s+EXISTS\s*\([\s\S]*prep_task_request_titles[\s\S]*task_id\s*=\s*v_task_id[\s\S]*\)/i);
    expect(createTaskBody).toMatch(/coalesce\(_title,\s*''\)\s*~\*\s*'\^Request/i);
    expect(createTaskBody).toMatch(/lower\(trim\(rt\.name\)\)\s*=\s*lower\(trim\(regexp_replace\(coalesce\(_title,\s*''\),\s*'\^Request/i);
    expect(createTaskBody).not.toMatch(/rt\.name\s+ILIKE/i);
  });
});
