import { Pin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MessageRow } from "@/lib/chat";
import { usePinMessage } from "@/lib/chat-extras";
import { isDeleted, messagePreviewText } from "@/lib/chat-deleted";

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
    <div className="chat-preview-panel-warning border-b bg-warning dark:bg-warning/30">
      {pinned.map((m) => {
        const deleted = isDeleted(m);
        const text = messagePreviewText(m) || "Lampiran";
        return (
          <div key={m.id} className="flex items-center gap-ms-2 px-ms-3 py-1.5 text-ms-xs">
            <Pin className="chat-preview-label h-3.5 w-3.5 shrink-0" />
            <button
              type="button"
              onClick={() => onJump(m.id)}
              className="flex-1 truncate text-left hover:underline"
              title={text}
            >
              <span className="chat-preview-label font-semibold">Disematkan · </span>
              <span className={deleted ? "chat-preview-text italic" : "chat-preview-label"}>{text}</span>
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