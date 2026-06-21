import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, Loader2, Link2 } from "lucide-react";

import { useConversations } from "@/lib/chat";
import { NewDmDialog } from "@/components/chat/NewDmDialog";
import { NewGroupDialog } from "@/components/chat/NewGroupDialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/chat/")({
  component: ChatListPage,
});

function timeShort(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 7) return d.toLocaleDateString("id-ID", { weekday: "short" });
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" });
}

function ChatListPage() {
  const { data: conversations, isLoading } = useConversations();

  return (
    <main className="mx-auto max-w-2xl space-y-3 p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Chat</h1>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/kontak">
              <Link2 className="h-4 w-4" /> Siapkan kontak chat
            </Link>
          </Button>
          <NewGroupDialog />
          <NewDmDialog />
        </div>
      </header>

      <div className="rounded-lg border">
        {isLoading ? (
          <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
          </div>
        ) : (conversations ?? []).length === 0 ? (
          <div className="space-y-2 p-8 text-center">
            <MessageCircle className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Belum ada percakapan</p>
            <p className="text-xs text-muted-foreground">
              Mulai chat dengan kontak yang akunnya sudah tertaut, atau buat grup baru.
            </p>
            <div className="pt-2">
              <Button asChild size="sm" className="gap-1.5">
                <Link to="/kontak">
                  <Link2 className="h-4 w-4" /> Siapkan kontak chat
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <ul className="divide-y">
            {(conversations ?? []).map((c) => (
              <li key={c.id}>
                <Link
                  to="/chat/$conversationId"
                  params={{ conversationId: c.id }}
                  className="flex items-start gap-3 px-3 py-3 hover:bg-accent/50"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <MessageCircle className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{c.display_title}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{timeShort(c.last_at)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {c.last_body ?? <em className="text-muted-foreground/70">Belum ada pesan</em>}
                      </span>
                      {c.unread > 0 ? (
                        <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                          {c.unread > 99 ? "99+" : c.unread}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}