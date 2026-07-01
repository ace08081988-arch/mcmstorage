import type { AdminApkListResult } from "./apk.functions";

/**
 * Sumber kebenaran tunggal untuk memutuskan tampilan halaman
 * `/pengaturan-apk`. Diekstrak dari komponen supaya bisa diuji tanpa harus
 * memasang router / query. Kontrak:
 *   - `loading` → sedang mengecek admin atau memuat data awal.
 *   - `error`   → query gagal (bukan karena admin gate).
 *   - `notice`  → user bukan admin (baik dari hook maupun payload server).
 *   - `content` → user admin & data siap dirender.
 */
export type ApkAdminView = "loading" | "error" | "notice" | "content";

export function classifyApkAdminView(input: {
  isCheckingAdmin: boolean;
  isAdmin: boolean;
  isLoadingApk: boolean;
  isError: boolean;
  data: AdminApkListResult | undefined;
}): ApkAdminView {
  const { isCheckingAdmin, isAdmin, isLoadingApk, isError, data } = input;
  if (isCheckingAdmin || (isAdmin && isLoadingApk && !data)) return "loading";
  if (isError) return "error";
  if (!isAdmin || (data && data.isAdmin === false)) return "notice";
  return "content";
}

/** Deteksi error legacy dari handler lama yang masih throw. */
export function isAdminRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Forbidden:\s*admin diperlukan|admin diperlukan/i.test(message);
}