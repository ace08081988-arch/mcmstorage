import { n as useChatHeartbeat } from "@/lib/chat";

/**
 * Detak kehadiran global: selama aplikasi terbuka (halaman apa pun),
 * server menandai pesan masuk sebagai "sampai di perangkat" sehingga
 * centang di sisi pengirim bisa berubah 1 → 2 (hitam) sebelum dibaca.
 */
export function ChatPresenceHost() {
  useChatHeartbeat();
  return null;
}
