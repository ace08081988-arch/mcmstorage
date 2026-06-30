import { useMemo, useState } from "react";
import { Search, Loader2, MessageCircle, Users, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConversations } from "@/lib/chat";

/**
 * Dialog ringan untuk memilih percakapan in-app sebagai target pengiriman.
 * Dipakai oleh tombol "Chat" di kartu eceran agar foto + link Maps dikirim
 * langsung ke percakapan tanpa pindah halaman.
 */
export function PickChatConversationDialog({
  open,
  onOpenChange,
  onPick,
  title = "Kirim ke percakapan",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (conversationId: string, displayTitle: string) => void;
  title?: string;
}) {
  const [q, setQ] = useState("");
  const { data: convs, isLoading } = useConversations();

  const filtered = useMemo(() => {
    const items = (convs ?? []).filter((c) => !c.archived_at);
    if (!q.trim()) return items;
    const needle = q.trim().toLowerCase();
    return items.filter((c) => c.display_title.toLowerCase().includes(needle));
  }, [convs, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0">
        <DialogHeader className="p-3 pb-2 border-b">
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari percakapan…"
              className="h-8 w-full rounded-md border bg-background pl-7 pr-7 text-xs outline-none focus:border-primary/40"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent"
                aria-label="Hapus pencarian"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat percakapan…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              {q ? "Tidak ada percakapan yang cocok." : "Belum ada percakapan. Buka menu Chat untuk memulai."}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((c) => {
                const isGroup = c.kind === "group" || c.kind === "order";
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onPick(c.id, c.display_title)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        {isGroup ? <Users className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{c.display_title}</div>
                        {c.last_body && (
                          <div className="truncate text-[10px] text-muted-foreground">{c.last_body}</div>
                        )}
                      </div>
                      {c.unread > 0 && (
                        <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          {c.unread}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}