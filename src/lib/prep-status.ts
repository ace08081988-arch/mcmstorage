import type { StatusVariant } from "@/components/StatusBadge";

/**
 * SSOT untuk 11 status siklus hidup pesanan / penyiapan.
 * Kunci tetap English snake_case; label UI Indonesia via STATUS_LABEL_ID.
 *
 * Aturan derivasi dijaga di file ini agar konsisten di semua surface
 * (/request, /ecer, dashboard, riwayat). Jangan sebar `if sold_at ...`
 * ad-hoc di route lain — panggil `deriveRequestStatus` / `deriveEcerStatus`.
 */
export type LifecycleStatus =
  | "draft"
  | "new_request"
  | "sent_to_employee"
  | "preparing"
  | "waiting_verification"
  | "ready_to_ship"
  | "waiting_payment"
  | "paid"
  | "dp"
  | "credit"
  | "sent"
  | "completed"
  | "archived";

export const STATUS_LABEL_ID: Record<LifecycleStatus, string> = {
  draft: "Draft",
  new_request: "Permintaan Baru",
  sent_to_employee: "Dikirim ke Karyawan",
  preparing: "Sedang Disiapkan",
  waiting_verification: "Menunggu Verifikasi",
  ready_to_ship: "Siap Kirim",
  waiting_payment: "Menunggu Pembayaran",
  paid: "Lunas",
  dp: "DP",
  credit: "Piutang",
  sent: "Terkirim",
  completed: "Selesai",
  archived: "Diarsipkan",
};

export const STATUS_VARIANT: Record<LifecycleStatus, StatusVariant> = {
  draft: "info",
  new_request: "info",
  sent_to_employee: "info",
  preparing: "menunggu",
  waiting_verification: "menunggu",
  ready_to_ship: "siap",
  waiting_payment: "menunggu",
  paid: "lunas",
  dp: "kelebihan",
  credit: "hutang",
  sent: "siap",
  completed: "selesai",
  archived: "selesai",
};

// Input minimal — tidak menuntut seluruh shape row. Setiap field opsional
// supaya pemanggil bisa oper subset kolom saja.
export type PrepLifecycleInput = {
  verification_status?: string | null;
  rejection_reason?: string | null;
  sold_at?: string | null;
  sold_payment_method?: string | null;
  sold_total?: number | null;
  sold_paid_amount?: number | null;
  archived_at?: string | null;
  ready_at?: string | null;
};

export type TaskLifecycleInput = {
  status?: string | null;
  hasSubmission?: boolean;
};

/**
 * H5: SSOT untuk tampilan status ringkas kartu tugas pegawai
 * ("Menunggu" | "Dikerjakan" | "Selesai"). Sebelumnya tugas.tsx punya
 * heuristik lokal `submitted >= items → Selesai` yang mengabaikan
 * `verification_status` sehingga tugas bisa terlihat Selesai padahal
 * masih menunggu verifikasi admin.
 */
export type TaskShortStatus = "Menunggu" | "Dikerjakan" | "Selesai";

export function deriveTaskShortStatus(
  rawStatus: string | null | undefined,
  progress: { items: number; submitted: number; approved: number },
): TaskShortStatus {
  const s = String(rawStatus ?? "").toLowerCase();
  if (s === "cancelled" || s === "expired") return "Menunggu";
  // Tuntas hanya bila SEMUA item sudah disetujui admin (bukan hanya submitted).
  if (progress.items > 0 && progress.approved >= progress.items) return "Selesai";
  if (s === "done" || s === "selesai") {
    // Backend menandai done tapi belum semua approved → tetap "Dikerjakan"
    // supaya operator sadar masih ada yang perlu diverifikasi.
    return progress.submitted > 0 ? "Dikerjakan" : "Menunggu";
  }
  if (progress.submitted > 0) return "Dikerjakan";
  return "Menunggu";
}

/**
 * Derivasi status untuk pesanan Request Order (ada customer + payment).
 */
export function deriveRequestStatus(
  prep?: PrepLifecycleInput | null,
  task?: TaskLifecycleInput | null,
): LifecycleStatus {
  if (prep?.archived_at) return "archived";

  // Sudah dikirim ke customer → lifecycle pasca-payment.
  if (prep?.sold_at) {
    const pm = (prep.sold_payment_method ?? "").toLowerCase();
    if (pm === "hutang") return "credit";
    if (pm === "partial") return "dp";
    if (pm === "kas") return "paid";
    return "sent";
  }

  const v = (prep?.verification_status ?? "").toLowerCase();
  if (v === "rejected") return "preparing"; // kembali ke karyawan
  if (v === "pending") return "waiting_verification";
  if (v === "approved") return "ready_to_ship";

  // Tanpa row prep — pakai state task.
  if (task) {
    if (task.hasSubmission) return "waiting_verification";
    const ts = (task.status ?? "").toLowerCase();
    if (ts === "active") return "sent_to_employee";
    if (ts === "done") return "completed";
    if (ts === "cancelled" || ts === "expired") return "archived";
  }
  return "new_request";
}

/**
 * Derivasi status untuk Ecer (tanpa customer). Setelah approve →
 * ready_to_ship (nanti dipromosikan ke "in ecer inventory" pada gap #9).
 */
export function deriveEcerStatus(
  prep?: PrepLifecycleInput | null,
  task?: TaskLifecycleInput | null,
): LifecycleStatus {
  if (prep?.archived_at) return "archived";
  if (prep?.sold_at) {
    const pm = (prep.sold_payment_method ?? "").toLowerCase();
    if (pm === "hutang") return "credit";
    if (pm === "partial") return "dp";
    if (pm === "kas") return "paid";
    return "sent";
  }
  const v = (prep?.verification_status ?? "").toLowerCase();
  if (v === "rejected") return "preparing";
  if (v === "pending") return "waiting_verification";
  if (v === "approved") return "ready_to_ship";
  if (task) {
    if (task.hasSubmission) return "waiting_verification";
    const ts = (task.status ?? "").toLowerCase();
    if (ts === "active") return "sent_to_employee";
    if (ts === "done") return "completed";
    if (ts === "cancelled" || ts === "expired") return "archived";
  }
  return "new_request";
}

export function statusLabel(s: LifecycleStatus): string {
  return STATUS_LABEL_ID[s];
}

export function statusVariant(s: LifecycleStatus): StatusVariant {
  return STATUS_VARIANT[s];
}