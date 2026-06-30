import type { QueryClient } from "@tanstack/react-query";
import type { MessageRow } from "@/lib/chat";

/**
 * Optimistically mark one or more messages as deleted in the local query
 * cache so the UI updates instantly when the user taps "Hapus untuk semua".
 * The actual RPC may still be deferred (e.g. by scheduleUndo) — call the
 * returned `restore()` to roll back if the user cancels or the request fails.
 */
export function optimisticDeleteMessages(
  qc: QueryClient,
  conversationId: string,
  ids: string[],
): () => void {
  const key = ["chat", "messages", conversationId];
  const prev = qc.getQueryData<MessageRow[]>(key);
  if (!prev) return () => undefined;
  const idSet = new Set(ids);
  const nowIso = new Date().toISOString();
  qc.setQueryData<MessageRow[]>(key, prev.map((m) =>
    idSet.has(m.id) && !m.deleted_at
      ? {
          ...m,
          deleted_at: nowIso,
          body: null,
          attachment_path: null,
          attachment_name: null,
          attachment_mime: null,
          attachment_size: null,
        }
      : m,
  ));
  return () => {
    qc.setQueryData<MessageRow[]>(key, prev);
  };
}