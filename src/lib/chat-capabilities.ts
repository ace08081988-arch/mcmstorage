/**
 * SSOT kemampuan percakapan (baca / kirim / telepon).
 *
 * Sumber kebenaran ada di RPC `chat_conversation_capabilities` (server),
 * modul ini hanya berisi tipe + helper murni supaya UI, server function,
 * dan test memakai aturan yang sama persis.
 *
 * Aturan penting: MENGHAPUS KONTAK DARI BUKU ALAMAT BUKAN MEMBLOKIR.
 * Selama kedua peserta masih menjadi anggota percakapan dan tidak ada
 * baris blokir eksplisit di `chat_blocks`, DM tetap bisa dibalas.
 */

export type CapabilityReason =
  | "ok"
  | "not_authenticated"
  | "conversation_not_found"
  | "not_member"
  | "peer_left"
  | "blocked_by_me"
  | "blocked_by_peer";

export type ConversationCapabilities = {
  canRead: boolean;
  canSend: boolean;
  canCall: boolean;
  reasonCode: CapabilityReason;
  peerUserId?: string | null;
  kind?: string | null;
  relationVersion?: string | null;
  updatedAt?: string | null;
};

export const DENIED_CAPABILITIES: ConversationCapabilities = {
  canRead: false,
  canSend: false,
  canCall: false,
  reasonCode: "not_member",
};

const REASONS: Record<CapabilityReason, { label: string; hint: string; action?: string }> = {
  ok: { label: "", hint: "" },
  not_authenticated: {
    label: "Sesi berakhir",
    hint: "Masuk kembali untuk melanjutkan percakapan.",
    action: "login",
  },
  conversation_not_found: {
    label: "Percakapan tidak ditemukan",
    hint: "Percakapan ini sudah dihapus.",
  },
  not_member: {
    label: "Anda bukan peserta percakapan ini",
    hint: "Minta diundang kembali oleh peserta lain.",
  },
  peer_left: {
    label: "Peserta lain keluar dari percakapan",
    hint: "Riwayat tetap bisa dibaca. Mulai chat baru untuk menghubungi kembali.",
    action: "new_chat",
  },
  blocked_by_me: {
    label: "Anda memblokir kontak ini",
    hint: "Buka blokir untuk mengirim pesan dan menelepon lagi.",
    action: "unblock",
  },
  blocked_by_peer: {
    label: "Kontak ini memblokir Anda",
    hint: "Riwayat tetap bisa dibaca, tetapi pesan baru tidak akan terkirim.",
  },
};

export function describeCapability(reason: CapabilityReason) {
  return REASONS[reason] ?? REASONS.not_member;
}

/** Normalisasi payload jsonb RPC ke bentuk yang dipakai aplikasi. */
export function normalizeCapabilities(raw: unknown): ConversationCapabilities {
  const r = (raw ?? {}) as Record<string, unknown>;
  const reason = (r["reasonCode"] as CapabilityReason) ?? "not_member";
  const known = reason in REASONS ? reason : "not_member";
  return {
    canRead: r["canRead"] === true,
    canSend: r["canSend"] === true,
    canCall: r["canCall"] === true,
    reasonCode: known,
    peerUserId: (r["peerUserId"] as string | null) ?? null,
    kind: (r["kind"] as string | null) ?? null,
    relationVersion: (r["relationVersion"] as string | null) ?? null,
    updatedAt: (r["updatedAt"] as string | null) ?? null,
  };
}

/** Kunci cache React Query — dipakai untuk invalidasi saat resume/online. */
export function capabilityQueryKey(conversationId: string) {
  return ["chat", "capabilities", conversationId] as const;
}