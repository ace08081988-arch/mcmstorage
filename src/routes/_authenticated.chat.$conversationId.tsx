import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Send, Loader2, MessageCircle, MoreVertical, Trash2, Share2, Copy, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  getConversationMeta,
  markConversationRead,
  useDeleteAllMyMessages,
  useDeleteMessage,
  useConversationMessages,
  useMyUserId,
  type MessageRow,
} from "@/lib/chat";
import { sendMessage } from "@/lib/chat.functions";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { ManageGroupDialog } from "@/components/chat/ManageGroupDialog";

export const Route = createFileRoute("/_authenticated/chat/$conversationId")({
  component: ChatRoomPage,
});

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long" });
}

function ChatRoomPage() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const { data: myId } = useMyUserId();
  const { data: messages, isLoading } = useConversationMessages(conversationId);
  const deleteMsg = useDeleteMessage(conversationId);
  const deleteAllMine = useDeleteAllMyMessages(conversationId);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const meta = useQuery({
    queryKey: ["chat", "conv-meta", conversationId],
    queryFn: () => getConversationMeta(conversationId),
  });

  // Member list & profiles for sender names (DM/group)
  const members = useQuery({
    queryKey: ["chat", "conv-members", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId);
      if (error) throw error;
      return (data ?? []).map((m) => m.user_id as string);
    },
  });

  const profileIds = useMemo(() => members.data ?? [], [members.data]);
  const profiles = useQuery({
    queryKey: ["chat", "conv-profiles", conversationId, profileIds.join(",")],
    enabled: profileIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .in("id", profileIds);
      if (error) throw error;
      return new Map((data ?? []).map((p) => [p.id, p as { id: string; display_name: string | null; email: string | null }]));
    },
  });

  const headerTitle = useMemo(() => {
    if (!meta.data) return "Memuat…";
    if (meta.data.kind === "dm" && myId && profiles.data) {
      const other = (members.data ?? []).find((u) => u !== myId);
      const p = other ? profiles.data.get(other) : null;
      return p?.display_name || p?.email || "Percakapan";
    }
    return meta.data.title || (meta.data.kind === "order" ? "Diskusi pesanan" : "Grup");
  }, [meta.data, profiles.data, members.data, myId]);

  // Mark read on mount + when new messages arrive
  useEffect(() => {
    if (!myId || !messages || messages.length === 0) return;
    markConversationRead(conversationId, myId).catch(() => {});
  }, [conversationId, myId, messages?.length]);

  // Scroll to bottom
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  const [body, setBody] = useState("");
  const send = useMutation({
    mutationFn: async (text: string) =>
      sendMessage({ data: { conversationId, body: text } }),
    onSuccess: () => setBody(""),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal mengirim"),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = body.trim();
    if (!t || send.isPending) return;
    send.mutate(t);
  };

  // Group messages by day
  const grouped = useMemo(() => {
    const out: { day: string; items: MessageRow[] }[] = [];
    for (const m of messages ?? []) {
      const day = fmtDay(m.created_at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [messages]);

  return (
    <div className="mx-auto flex h-[100dvh] max-w-2xl flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate({ to: "/chat" })}
          aria-label="Kembali"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
          <MessageCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{headerTitle}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {meta.data?.kind === "dm" ? "Percakapan pribadi" :
              meta.data?.kind === "order" ? "Diskusi pesanan" :
              `Grup · ${members.data?.length ?? 0} anggota`}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Opsi percakapan">
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {meta.data?.kind === "group" ? (
              <DropdownMenuItem onSelect={() => setManageOpen(true)}>
                <Users className="mr-2 h-4 w-4" />
                Kelola grup &amp; anggota
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirmAllOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Hapus semua pesan saya
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat pesan…
          </div>
        ) : (messages ?? []).length === 0 ? (
          <div className="grid place-items-center p-12 text-center text-xs text-muted-foreground">
            Belum ada pesan. Sapa dulu yuk.
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.day} className="space-y-2">
              <div className="my-2 flex justify-center">
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] text-muted-foreground">{g.day}</span>
              </div>
              {g.items.map((m) => {
                const mine = m.sender_id === myId;
                const senderProfile = profiles.data?.get(m.sender_id);
                const senderName = senderProfile?.display_name || senderProfile?.email || "Pengguna";
                const showSender = !mine && (meta.data?.kind !== "dm");
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`group relative flex max-w-[80%] items-start gap-1 ${mine ? "flex-row-reverse" : "flex-row"}`}>
                      <div
                        className={`rounded-2xl px-3 py-1.5 text-sm leading-snug shadow-sm ${
                          mine
                            ? "rounded-br-sm bg-primary text-primary-foreground"
                            : "rounded-bl-sm bg-muted text-foreground"
                        }`}
                      >
                        {showSender ? (
                          <div className="mb-0.5 text-[10px] font-semibold opacity-80">{senderName}</div>
                        ) : null}
                        {m.deleted_at ? (
                          <em className="opacity-70">(pesan dihapus)</em>
                        ) : (
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        )}
                        <div className={`mt-0.5 text-right text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {fmtTime(m.created_at)}
                        </div>
                      </div>
                      {!m.deleted_at ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 self-center opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                              aria-label="Opsi pesan"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                              onSelect={async () => {
                                const text = `${senderName}: ${m.body}`;
                                const res = await shareToWhatsApp({ text });
                                notifyShareResult(res);
                              }}
                            >
                              <Share2 className="mr-2 h-4 w-4" />
                              Teruskan via WhatsApp
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                navigator.clipboard?.writeText(m.body ?? "").then(
                                  () => toast.success("Teks pesan disalin"),
                                  () => toast.error("Gagal menyalin"),
                                );
                              }}
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Salin teks
                            </DropdownMenuItem>
                            {mine ? (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                disabled={deleteMsg.isPending}
                                onSelect={() => {
                                  deleteMsg.mutate(
                                    { id: m.id, attachment_path: m.attachment_path },
                                    {
                                      onError: (e) =>
                                        toast.error(e instanceof Error ? e.message : "Gagal menghapus"),
                                    },
                                  );
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Hapus untuk semua orang
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-0 z-10 border-t bg-background/95 p-2 backdrop-blur">
        <ChatProGate />
        <div className="flex items-end gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e as unknown as React.FormEvent);
              }
            }}
            placeholder="Tulis pesan…"
            rows={1}
            className="max-h-32 min-h-9 resize-none"
            disabled={chatBlocked}
          />
          <Button type="submit" size="icon" disabled={!body.trim() || send.isPending || chatBlocked} aria-label="Kirim">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-1 px-1 text-[10px] text-muted-foreground">
          Enter untuk kirim · Shift+Enter untuk baris baru
        </p>
      </form>

      <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus semua pesan saya?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua pesan yang pernah Anda kirim di percakapan ini akan hilang dari kedua sisi,
              termasuk lampirannya. Tindakan ini tidak bisa dibatalkan. Pesan dari pihak lain
              tetap utuh di sisi mereka.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAllMine.isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteAllMine.isPending}
              onClick={(e) => {
                e.preventDefault();
                deleteAllMine.mutate(undefined, {
                  onSuccess: (n) => {
                    toast.success(`${n} pesan dihapus`);
                    setConfirmAllOpen(false);
                  },
                  onError: (err) =>
                    toast.error(err instanceof Error ? err.message : "Gagal menghapus"),
                });
              }}
            >
              {deleteAllMine.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Hapus semua
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {meta.data?.kind === "group" ? (
        <ManageGroupDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          conversationId={conversationId}
          currentTitle={meta.data.title}
          ownerUserId={meta.data.owner_user_id}
          onLeft={() => navigate({ to: "/chat" })}
        />
      ) : null}
    </div>
  );
}

// Keep a hint link in case the room URL is opened directly without context.
export const ChatRoomFallbackLink = () => <Link to="/chat">Kembali ke daftar chat</Link>;