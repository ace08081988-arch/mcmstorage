import { AlertCircle, Check, CheckCheck, Clock, CloudOff } from "lucide-react";

/**
 * Indikator status pengiriman pesan — satu sumber visual untuk bubble
 * optimistic (outbox) maupun pesan yang sudah tersimpan di server, supaya
 * ikon/istilahnya konsisten di seluruh halaman chat.
 *
 * queued   : menunggu koneksi (offline) — belum pernah dicoba kirim
 * sending  : sedang dikirim ke server
 * sent      : sudah sampai server, belum sampai perangkat lawan (centang 1)
 * delivered : sudah sampai perangkat lawan, belum dibuka (centang 2 hitam)
 * read     : sudah dibaca
 * failed   : gagal kirim, butuh kirim ulang
 */
export type MessageSendStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

const LABEL: Record<MessageSendStatus, string> = {
  queued: "Menunggu koneksi",
  sending: "Mengirim",
  sent: "Terkirim",
  delivered: "Sampai di perangkat lawan",
  read: "Dibaca",
  failed: "Gagal terkirim",
};

export function MessageStatusIcon({
  status,
  className = "",
}: {
  status: MessageSendStatus;
  className?: string;
}) {
  const label = LABEL[status];
  const common = `h-3.5 w-3.5 shrink-0 ${className}`;
  if (status === "queued")
    return <CloudOff className={`${common} opacity-70`} aria-label={label} />;
  if (status === "sending")
    return <Clock className={`${common} animate-pulse opacity-70`} aria-label={label} />;
  if (status === "read") return <CheckCheck className={`${common} wa-check`} aria-label={label} />;
  if (status === "delivered")
    return <CheckCheck className={`${common} wa-check-delivered`} aria-label={label} />;
  if (status === "failed")
    return <AlertCircle className={`${common} text-destructive`} aria-label={label} />;
  return <Check className={`${common} opacity-80`} aria-label={label} />;
}

export function messageStatusLabel(status: MessageSendStatus): string {
  return LABEL[status];
}
