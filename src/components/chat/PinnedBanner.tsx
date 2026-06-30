import { Pin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MessageRow } from "@/lib/chat";
import { usePinMessage } from "@/lib/chat-extras";

export function PinnedBanner({
  conversationId,
  pinned,
  onJump,
  canUnpin,
}: {
  conversationId: string;
  pinned: MessageRow[];
  onJump: (id: string) => void;
  canUnpin: boolean;
}) {
  const pinMut = usePinMessage(conversationId);
  if (pinned.length === 0) return null;
  return (
    <div className="border-b bg-amber-50 dark:bg-amber-950/30">
      {pinned.map((m) => {
        const text = m.deleted_at
          ? "Pesan dihapus"
          : m.body?.trim() || (m.attachment_name ? `📎 ${m.attachment_name}` : "Lampiran");
        return (
          <div key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <Pin className="h-3.5 w-3.5 shrink-0 text-amber-600" />
            <button
              type="button"
              onClick={() => onJump(m.id)}
              className="flex-1 truncate text-left hover:underline"
              title={text}
            >
              <span className="font-semibold text-amber-700 dark:text-amber-300">Disematkan · </span>
              <span className="text-foreground">{text}</span>
            </button>
            {canUnpin ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="Lepas pin"
                onClick={() => pinMut.mutate({ messageId: m.id, on: false })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}