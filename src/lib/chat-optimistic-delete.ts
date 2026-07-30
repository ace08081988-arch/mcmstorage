import type { QueryClient } from "@tanstack/react-query";
import type { MessageRow } from "@/lib/chat";

/**
 * Optimistically remove one or more messages from the local query cache so the
 * UI matches the permanent delete path immediately. The actual RPC may still
 * fail — call the returned `restore()` to roll back failed deletes.
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
  qc.setQueryData<MessageRow[]>(key, prev.filter((m) => !idSet.has(m.id)));
  return () => {
    qc.setQueryData<MessageRow[]>(key, prev);
  };
}