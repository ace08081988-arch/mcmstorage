/**
 * SSOT kategori percakapan.
 *
 * Kategori disimpan di kolom `conversations.category` (default `customer`
 * pada migrasi Slice A). Kolom ini bersifat metadata — RLS/akses tidak
 * bergantung padanya, jadi aman untuk diklasifikasi ulang di UI.
 *
 * Prinsip:
 * - Nilai kanonik ada 4: customer / employee / internal / archived.
 * - `deriveCategory()` dipakai saat kolom `category` bernilai default
 *   dan kita ingin menebak kategori paling masuk akal dari sinyal
 *   (peer role, linked business object, group vs dm). Slice UI berikutnya
 *   (B/C/D) memakai helper ini agar hasilnya konsisten.
 * - Auto-archive dilakukan slice C (trigger), bukan derivation runtime.
 */

export type ChatCategory = "customer" | "employee" | "internal" | "archived";

export const CHAT_CATEGORIES: readonly ChatCategory[] = [
  "customer",
  "employee",
  "internal",
  "archived",
] as const;

export const CHAT_CATEGORY_LABEL_ID: Record<ChatCategory, string> = {
  customer: "Pelanggan",
  employee: "Karyawan",
  internal: "Internal / Catatan",
  archived: "Arsip",
};

/** Sinyal minimum untuk derivation — bebas dari tipe Supabase. */
export type ChatCategorySignals = {
  /** Nilai kolom `category` di database. `null` = tidak diketahui / belum di-set. */
  storedCategory?: ChatCategory | string | null;
  /** True jika percakapan grup (kind = 'group'). */
  isGroup?: boolean;
  /** True jika peer (untuk DM) punya role admin/worker/staff. */
  peerIsStaff?: boolean;
  /** True jika peer adalah pemilik toko sendiri (self / owner_user_id). */
  peerIsSelf?: boolean;
  /** True jika percakapan sudah terhubung ke customer/order. */
  hasCustomerLink?: boolean;
  /** True jika percakapan sudah terhubung ke prep task/karyawan. */
  hasTaskLink?: boolean;
  /** True jika sudah diarsipkan (archived_at IS NOT NULL). */
  isArchived?: boolean;
};

export function isChatCategory(v: unknown): v is ChatCategory {
  return typeof v === "string" && (CHAT_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Turunkan kategori final dari sinyal yang tersedia.
 *
 * Prioritas:
 * 1. Archived (paling akhir dalam siklus) menang atas apa pun.
 * 2. `storedCategory` valid dipakai apa adanya — user boleh reclassify manual.
 * 3. Fallback berdasarkan sinyal:
 *    - Grup + peer staff atau task link → employee
 *    - DM ke self / group notes-only → internal
 *    - Task link atau peer staff → employee
 *    - Customer link → customer
 *    - Default → customer
 */
export function deriveCategory(s: ChatCategorySignals): ChatCategory {
  if (s.isArchived) return "archived";
  if (isChatCategory(s.storedCategory) && s.storedCategory !== "customer") {
    // 'customer' adalah default kolom — jangan anggap itu keputusan eksplisit,
    // biarkan derivation berjalan agar bisa promote ke employee/internal.
    return s.storedCategory;
  }
  if (s.peerIsSelf) return "internal";
  if (s.hasTaskLink || s.peerIsStaff) return "employee";
  if (s.hasCustomerLink) return "customer";
  if (isChatCategory(s.storedCategory)) return s.storedCategory;
  return "customer";
}
