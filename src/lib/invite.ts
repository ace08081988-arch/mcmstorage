/**
 * Invite/PIN helper — BBM-style contact exchange lewat kode 8 karakter.
 *
 * PIN disimpan di `profiles.invite_code`. Semua akses lewat RPC
 * `resolve_invite_code` / `send_friend_request` (SECURITY DEFINER)
 * supaya orang lain hanya melihat nama + avatar, bukan email/HP.
 *
 * Alur baru (friend gate): memasukkan PIN mengirim PERMINTAAN pertemanan.
 * Sisi lawan harus Terima dulu di halaman /kontak/permintaan sebelum chat
 * & panggilan bisa dilakukan. Kalau sebelumnya sudah berteman, RPC
 * langsung mengembalikan `alreadyFriends=true` supaya UI bisa membuka
 * chat tanpa langkah tambahan (kompatibel dengan pengguna existing).
 */
import { supabase } from "@/integrations/supabase/client";

export type InviteProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  invite_code: string;
  chat_only: boolean;
};

/** Bersihkan input pengguna: buang spasi/tanda hubung, upper-case, potong ke 8+. */
export function normalizeInviteCode(raw: string): string {
  return (raw || "")
    .replace(/[\s\-_]/g, "")
    .toUpperCase()
    .slice(0, 16);
}

export function isLikelyInviteCode(raw: string): boolean {
  const n = normalizeInviteCode(raw);
  return /^[A-Z0-9]{6,16}$/.test(n);
}

/** Format tampilan `ABCD-1234` supaya lebih mudah dibaca/diucapkan. */
export function formatInviteCode(code: string | null | undefined): string {
  const n = normalizeInviteCode(code ?? "");
  if (n.length <= 4) return n;
  return `${n.slice(0, 4)}-${n.slice(4)}`;
}

export function buildInviteUrl(code: string): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://mcmstorage.biz";
  return `${origin}/i/${normalizeInviteCode(code)}`;
}

/** Cari profil dari PIN. Return `null` bila tidak ketemu. */
export async function resolveInviteCode(code: string): Promise<InviteProfile | null> {
  const clean = normalizeInviteCode(code);
  if (!clean) return null;
  const { data, error } = await supabase.rpc("resolve_invite_code", { _code: clean });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : (data as unknown as InviteProfile | null);
  return row ? (row as InviteProfile) : null;
}

export type FriendRequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

export type SendFriendRequestResult = {
  requestId: string;
  toUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: FriendRequestStatus;
  wasExisting: boolean;
  alreadyFriends: boolean;
  /**
   * Kalau pihak lawan sudah lebih dulu mengirim permintaan ke kita,
   * RPC mengembalikan id-nya di sini supaya UI bisa menawarkan tombol
   * "Terima permintaan" alih-alih mengirim permintaan balik.
   */
  incomingReverseId: string | null;
};

type SendFriendRequestRow = {
  request_id: string;
  to_user: string;
  display_name: string | null;
  avatar_url: string | null;
  status: FriendRequestStatus;
  was_existing: boolean;
  already_friends: boolean;
  incoming_reverse_id: string | null;
};

/**
 * Kirim permintaan pertemanan berdasarkan PIN. Idempoten:
 *  - Pertama kali: baris `pending` dibuat, `wasExisting=false`.
 *  - Sudah pending: kembalikan status apa adanya, `wasExisting=true`.
 *  - Sudah accepted: `alreadyFriends=true` (klien boleh langsung buka chat).
 *  - Pernah rejected/cancelled: dibuka lagi jadi pending.
 */
export async function sendFriendRequest(code: string): Promise<SendFriendRequestResult> {
  const clean = normalizeInviteCode(code);
  if (!clean) throw new Error("Kode undangan kosong.");
  // `as never` — RPC baru; types.ts akan di-regenerasi setelah migration.
  const { data, error } = await supabase.rpc("send_friend_request" as never, { _code: clean } as never);
  if (error) {
    if (/invite_code_not_found/i.test(error.message)) {
      throw new Error("PIN tidak ditemukan. Cek kembali kodenya.");
    }
    if (/unauthorized/i.test(error.message)) {
      throw new Error("Sesi tidak valid — silakan login ulang.");
    }
    throw error;
  }
  const row = (Array.isArray(data) ? data[0] : data) as SendFriendRequestRow | null | undefined;
  if (!row) throw new Error("PIN tidak ditemukan.");
  return {
    requestId: row.request_id,
    toUserId: row.to_user,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    status: row.status,
    wasExisting: row.was_existing,
    alreadyFriends: row.already_friends,
    incomingReverseId: row.incoming_reverse_id,
  };
}

/**
 * Backward-compatible wrapper untuk call site lama yang masih memakai
 * `addContactByInviteCode`. Mengembalikan bentuk yang mirip dengan RPC
 * lama plus field baru (`status`, `alreadyFriends`, `pending`). Toast /
 * copy di call site perlu memperhatikan `status === 'pending'` supaya
 * memberi pesan "menunggu diterima" alih-alih "ditambahkan".
 */
export type AddContactResult = {
  contactId: string;
  linkedUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  alreadyExisted: boolean;
  status: FriendRequestStatus;
  pending: boolean;
  alreadyFriends: boolean;
  incomingReverseId: string | null;
};

export async function addContactByInviteCode(code: string): Promise<AddContactResult> {
  const r = await sendFriendRequest(code);
  return {
    contactId: r.requestId,
    linkedUserId: r.toUserId,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    alreadyExisted: r.wasExisting,
    status: r.status,
    pending: r.status === "pending",
    alreadyFriends: r.alreadyFriends,
    incomingReverseId: r.incomingReverseId,
  };
}

export type FriendRequestRow = {
  id: string;
  from_user: string;
  to_user: string;
  status: FriendRequestStatus;
  created_at: string;
  responded_at: string | null;
  direction: "incoming" | "outgoing";
  peer_id: string;
  peer_display_name: string | null;
  peer_avatar_url: string | null;
  peer_invite_code: string | null;
};

export async function listFriendRequests(
  direction: "incoming" | "outgoing" | "all" = "all",
  onlyPending = true,
): Promise<FriendRequestRow[]> {
  const { data, error } = await supabase.rpc("list_friend_requests" as never, {
    _direction: direction,
    _only_pending: onlyPending,
  } as never);
  if (error) throw error;
  return (data ?? []) as FriendRequestRow[];
}

export async function respondFriendRequest(requestId: string, accept: boolean): Promise<FriendRequestStatus> {
  const { data, error } = await supabase.rpc("respond_friend_request" as never, {
    _request_id: requestId,
    _accept: accept,
  } as never);
  if (error) {
    if (/forbidden/i.test(error.message)) throw new Error("Hanya penerima permintaan yang bisa merespon.");
    if (/not_found/i.test(error.message)) throw new Error("Permintaan sudah tidak berlaku.");
    throw error;
  }
  const row = (Array.isArray(data) ? data[0] : data) as { status: FriendRequestStatus } | null | undefined;
  return row?.status ?? (accept ? "accepted" : "rejected");
}

export async function cancelFriendRequest(requestId: string): Promise<FriendRequestStatus> {
  const { data, error } = await supabase.rpc("cancel_friend_request" as never, {
    _request_id: requestId,
  } as never);
  if (error) {
    if (/forbidden/i.test(error.message)) throw new Error("Hanya pengirim yang bisa membatalkan permintaan.");
    if (/not_found/i.test(error.message)) throw new Error("Permintaan sudah tidak ada.");
    throw error;
  }
  const row = (Array.isArray(data) ? data[0] : data) as { status: FriendRequestStatus } | null | undefined;
  return row?.status ?? "cancelled";
}