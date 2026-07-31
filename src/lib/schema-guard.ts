/**
 * Validasi skema Supabase saat aplikasi mulai berjalan.
 *
 * Tujuan: memastikan kolom hasil migrasi (mis. `user_storage.categories`)
 * benar-benar ada di database sebelum fitur yang bergantung padanya dipakai.
 * Kalau kolomnya belum ada, PostgREST membalas error 42703 ("column ... does
 * not exist") dan penyimpanan data akan gagal diam-diam — guard ini
 * memunculkannya lebih awal, sekali saja, bukan saat user sedang menyimpan.
 */
import { supabase } from "@/integrations/supabase/client";

export type SchemaRequirement = {
  /** Nama tabel di schema public. */
  table: string;
  /** Kolom yang wajib ada (hasil migrasi). */
  columns: string[];
  /** Keterangan fitur yang rusak jika kolom hilang. */
  feature: string;
};

export const REQUIRED_SCHEMA: SchemaRequirement[] = [
  {
    table: "user_storage",
    columns: ["items", "categories"],
    feature: "Penyimpanan kategori & item di Beranda",
  },
];

export type SchemaIssue = {
  table: string;
  columns: string[];
  feature: string;
  message: string;
};

/** Deteksi error PostgREST "kolom tidak ada" (undefined_column). */
function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42703") return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("does not exist") && m.includes("column");
}

/** Error izin/RLS bukan masalah skema — abaikan supaya tidak false alarm. */
function isIgnorableError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return true;
  if (isMissingColumnError(err)) return false;
  return true;
}

/**
 * Jalankan probe ringan (`select ... limit 0`) untuk tiap tabel yang wajib.
 * Mengembalikan daftar masalah skema; kosong artinya skema sudah sesuai.
 */
export async function validateSupabaseSchema(
  requirements: SchemaRequirement[] = REQUIRED_SCHEMA,
): Promise<SchemaIssue[]> {
  const issues: SchemaIssue[] = [];
  for (const req of requirements) {
    try {
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(req.table as any)
        .select(req.columns.join(", "))
        .limit(0);
      if (isIgnorableError(error)) continue;
      issues.push({
        table: req.table,
        columns: req.columns,
        feature: req.feature,
        message: error?.message ?? "kolom tidak ditemukan",
      });
    } catch (e) {
      // Jaringan bermasalah — jangan laporkan sebagai masalah skema.
      console.warn("[schema-guard] probe gagal", req.table, e);
    }
  }
  return issues;
}

let ran = false;

/**
 * Dipanggil sekali saat startup. Aman dipanggil berkali-kali (idempoten)
 * dan tidak pernah melempar error ke pemanggil.
 */
export async function runSchemaGuard(
  onIssues?: (issues: SchemaIssue[]) => void,
): Promise<SchemaIssue[]> {
  if (ran) return [];
  ran = true;
  const issues = await validateSupabaseSchema().catch(() => [] as SchemaIssue[]);
  if (issues.length > 0) {
    for (const i of issues) {
      console.error(
        `[schema-guard] ${i.table} kekurangan kolom (${i.columns.join(", ")}) — ${i.feature}: ${i.message}`,
      );
    }
    onIssues?.(issues);
  }
  return issues;
}

/** Khusus untuk test. */
export function __resetSchemaGuard() {
  ran = false;
}
