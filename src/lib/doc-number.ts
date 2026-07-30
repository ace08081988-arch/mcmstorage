/**
 * Penomoran dokumen otomatis untuk semua ekspor PDF.
 * Format: PREFIX-YYYYMMDD-XXXX (mis. INV-20260729-0001).
 *
 * Sumber nomor: RPC `next_doc_number` (atomik, konsisten lintas perangkat).
 * Bila offline / RPC gagal, dipakai penghitung lokal per hari agar ekspor
 * tetap jalan — nomor lokal diberi akhiran "-L" supaya mudah diaudit.
 */
import { supabase } from "@/integrations/supabase/client";

export type DocNumberPrefix = "INV" | "LAP" | "AKR" | string;

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function localNext(prefix: string, d: Date): string {
  const key = `docseq:${prefix}:${todayKey(d)}`;
  let n = 1;
  try {
    n = Number(localStorage.getItem(key) ?? "0") + 1;
    localStorage.setItem(key, String(n));
  } catch {
    n = Math.floor(Date.now() / 1000) % 10000;
  }
  return `${prefix}-${todayKey(d)}-${String(n).padStart(4, "0")}-L`;
}

/** Ambil nomor dokumen berikutnya (aman dipanggil dari mana pun). */
export async function nextDocNumber(
  prefix: DocNumberPrefix = "INV",
  date: Date = new Date(),
): Promise<string> {
  const p = (prefix || "DOC").replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "DOC";
  try {
    const { data, error } = await supabase.rpc("next_doc_number", { _prefix: p });
    if (error) throw error;
    if (typeof data === "string" && data) return data;
  } catch {
    /* fallback lokal di bawah */
  }
  return localNext(p, date);
}

/** Potongan aman untuk nama berkas. */
export function docNumberSlug(docNo: string): string {
  return docNo.replace(/[^A-Za-z0-9-]/g, "");
}
