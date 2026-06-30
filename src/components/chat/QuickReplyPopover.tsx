import { useEffect, useMemo, useRef } from "react";
import { useQuickReplies, type QuickReply } from "@/lib/chat-extras";

export function QuickReplyPopover({
  query,
  onPick,
  onClose,
}: {
  query: string;
  onPick: (qr: QuickReply) => void;
  onClose: () => void;
}) {
  const { data: replies } = useQuickReplies();
  const q = query.toLowerCase();
  const items = useMemo(
    () => (replies ?? []).filter((r) => r.shortcut.startsWith(q)).slice(0, 6),
    [replies, q],
  );
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  if (items.length === 0) return null;

  return (
    <div
      ref={wrapRef}
      className="absolute bottom-full left-2 right-2 mb-2 max-h-60 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Balas cepat</div>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onPick(it)}
          className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
        >
          <span className="font-mono text-xs text-primary">/{it.shortcut}</span>
          <span className="ml-2 text-muted-foreground line-clamp-1">{it.body}</span>
        </button>
      ))}
    </div>
  );
}