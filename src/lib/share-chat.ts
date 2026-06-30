/**
 * Share helper untuk mengirim "kiriman pegawai / siapkan sendiri" (kumpulan foto +
 * link Maps) ke percakapan in-app. Mirroring `share-wa.ts` agar baik via WA maupun
 * via Chat aplikasi, gambar + link lokasi sama-sama benar terkirim.
 *
 * Setelah pengiriman sukses, helper memanggil `markSent(...)` sehingga kartu
 * berpindah ke tab "Riwayat terkirim" persis seperti alur WA.
 */
import { sendMessage } from "@/lib/chat.functions";
import { uploadChatFile } from "@/lib/chat-attachments";
import { markSent } from "@/lib/wa-sent-history";

export type ChatShareShot = {
  id: string;
  file: File;
  /** Optional caption khusus untuk foto ini. */
  caption?: string;
};

export type ChatShareResult =
  | { status: "shared"; messageCount: number }
  | { status: "failed"; error: string; messageCount: number };

export type ChatShareProgress =
  | { type: "caption"; status: "start" | "ok" | "fail"; error?: string }
  | { type: "photo"; index: number; total: number; status: "start" | "ok" | "fail"; error?: string }
  | { type: "location"; status: "start" | "ok" | "fail"; error?: string };

export type ChatShareInput = {
  conversationId: string;
  /** Caption utama yang dikirim sebagai pesan teks pertama. */
  caption: string;
  /** Link Maps / lokasi opsional — dikirim sebagai pesan terakhir agar mudah ditap. */
  locationUrl?: string | null;
  /** Foto-foto yang akan dilampirkan; satu pesan per foto (sesuai schema RPC). */
  shots: ChatShareShot[];
  /** ID kiriman yang harus ditandai "terkirim" agar berpindah ke Riwayat. */
  markIds?: string[];
  /** Idempotency key — diteruskan ke entri Riwayat agar bisa diaudit ulang. */
  idemKey?: string;
  /** Dipanggil setiap fase pengiriman untuk live progress di UI. */
  onProgress?: (p: ChatShareProgress) => void;
};

export async function shareToChat(input: ChatShareInput): Promise<ChatShareResult> {
  const { conversationId, caption, locationUrl, shots, markIds, idemKey, onProgress } = input;
  let count = 0;
  const emit = (p: ChatShareProgress) => { try { onProgress?.(p); } catch { /* ignore */ } };

  try {
    // 1) Caption utama
    if (caption.trim().length > 0) {
      emit({ type: "caption", status: "start" });
      try {
        await sendMessage({ data: { conversationId, body: caption.trim().slice(0, 4000) } });
        count++;
        emit({ type: "caption", status: "ok" });
      } catch (e) {
        emit({ type: "caption", status: "fail", error: (e as Error)?.message });
        throw e;
      }
    }

    // 2) Setiap foto sebagai pesan terpisah (chat.functions.sendMessage hanya
    //    menerima satu attachment per pesan).
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      emit({ type: "photo", index: i, total: shots.length, status: "start" });
      try {
        const up = await uploadChatFile({ conversationId, file: s.file });
        await sendMessage({
          data: {
            conversationId,
            attachmentPath: up.path,
            attachmentMime: up.mime,
            attachmentName: up.name,
            attachmentSize: up.size,
            body: s.caption ? s.caption.slice(0, 4000) : undefined,
          },
        });
        count++;
        emit({ type: "photo", index: i, total: shots.length, status: "ok" });
      } catch (e) {
        // satu foto gagal tidak menghentikan pengiriman lain
        console.warn("[share-chat] upload/send failed:", e);
        emit({ type: "photo", index: i, total: shots.length, status: "fail", error: (e as Error)?.message });
      }
    }

    // 3) Link lokasi sebagai pesan terakhir agar mudah disentuh.
    if (locationUrl && locationUrl.trim()) {
      emit({ type: "location", status: "start" });
      try {
        await sendMessage({
          data: { conversationId, body: `📍 Lokasi: ${locationUrl.trim()}`.slice(0, 4000) },
        });
        count++;
        emit({ type: "location", status: "ok" });
      } catch (e) {
        emit({ type: "location", status: "fail", error: (e as Error)?.message });
      }
    }

    if (count === 0) {
      return { status: "failed", error: "Tidak ada pesan yang berhasil dikirim.", messageCount: 0 };
    }

    if (markIds && markIds.length > 0) {
      markSent(markIds, { channel: "chat", mapsUrl: locationUrl ?? null, status: "success", idemKey });
    }
    return { status: "shared", messageCount: count };
  } catch (err) {
    const msg = (err as Error)?.message ?? "Unknown error";
    if (count > 0) {
      if (markIds && markIds.length > 0) {
        markSent(markIds, { channel: "chat", mapsUrl: locationUrl ?? null, status: "success", idemKey });
      }
      return { status: "shared", messageCount: count };
    }
    return { status: "failed", error: msg, messageCount: 0 };
  }
}