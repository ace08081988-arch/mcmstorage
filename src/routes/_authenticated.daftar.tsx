import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2, Loader2, Check, X, Search, Pin, Users2, MailOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  useChatLists, useCreateChatList, useDeleteChatList, useUpdateChatList,
  useChatListMembers, useSetChatListMembers,
  CHAT_LIST_COLORS, CHAT_LIST_ICONS,
  type ChatListWithCount,
} from "@/lib/chat-lists";
import { useConversations, type ConversationListItem } from "@/lib/chat";
import { ChatListIcon } from "@/lib/chat-list-icons";
import { confirm } from "@/lib/confirm";

export const Route = createFileRoute("/_authenticated/daftar")({
  component: DaftarPage,
});

function DaftarPage() {
  const navigate = useNavigate();
  const { data: lists, isLoading } = useChatLists();
  const { data: conversations } = useConversations();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ChatListWithCount | null>(null);

  const unreadCount = useMemo(
    () => (conversations ?? []).filter((c) => (c.unread ?? 0) > 0 && !c.archived_at).length,
    [conversations],
  );
  const groupCount = useMemo(
    () => (conversations ?? []).filter((c) => c.kind === "group" && !c.archived_at).length,
    [conversations],
  );
  const favCount = useMemo(
    () => (conversations ?? []).filter((c) => !!c.pinned_at && !c.archived_at).length,
    [conversations],
  );

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full"
          onClick={() => navigate({ to: "/chat" })}
          aria-label="Kembali"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold">Daftar</h1>
      </header>

      <div className="px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Gunakan daftar untuk menyusun urutan tampilan di tab Chat.
        </p>
      </div>

      <div className="px-2 pb-4">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-4 rounded-2xl px-2 py-3 text-left hover:bg-muted/60"
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-foreground">
                <Plus className="h-6 w-6" />
              </span>
              <span className="text-base font-medium">Daftar baru</span>
            </button>
          </DialogTrigger>
          <CreateListDialog onClose={() => setCreateOpen(false)} />
        </Dialog>

        <div className="mt-2 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Daftar Anda
        </div>

        <ul className="mt-1">
          {/* Preset bawaan — tidak dapat diubah/dihapus */}
          <PresetRow
            color="#22c55e"
            icon={<MailOpen className="h-5 w-5" />}
            title="Belum dibaca"
            subtitle="Preset"
            count={unreadCount}
          />
          <PresetRow
            color="#f59e0b"
            icon={<Pin className="h-5 w-5" />}
            title="Favorit"
            subtitle="Preset"
            count={favCount}
          />
          <PresetRow
            color="#3b82f6"
            icon={<Users2 className="h-5 w-5" />}
            title="Grup"
            subtitle="Preset"
            count={groupCount}
          />

          {isLoading ? (
            <li className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat daftar…
            </li>
          ) : null}

          {(lists ?? []).map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => setEditing(l)}
                className="flex w-full items-center gap-4 rounded-2xl px-2 py-3 text-left hover:bg-muted/60"
              >
                <span
                  className="grid h-12 w-12 place-items-center rounded-full text-white"
                  style={{ backgroundColor: l.color }}
                >
                  <ChatListIcon name={l.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium">{l.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {l.member_count} anggota
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-6 border-t px-3 pt-4 text-xs text-muted-foreground">
          <div className="mb-1 font-medium uppercase tracking-wide">Preset yang tersedia</div>
          <p>
            Preset seperti "Belum dibaca", "Favorit", dan "Grup" selalu tersedia sebagai filter
            cepat di tab Chat.
          </p>
        </div>
      </div>

      {editing ? (
        <EditListDialog list={editing} onClose={() => setEditing(null)} />
      ) : null}
    </main>
  );
}

function PresetRow({
  color, icon, title, subtitle, count,
}: {
  color: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count: number;
}) {
  return (
    <li>
      <Link
        to="/chat"
        className="flex items-center gap-4 rounded-2xl px-2 py-3 hover:bg-muted/60"
      >
        <span
          className="grid h-12 w-12 place-items-center rounded-full text-white"
          style={{ backgroundColor: color }}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{title}</span>
          <span className="block text-sm text-muted-foreground">{subtitle}</span>
        </span>
        {count > 0 ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {count}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function CreateListDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(CHAT_LIST_COLORS[0]);
  const [icon, setIcon] = useState<string>(CHAT_LIST_ICONS[0]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [q, setQ] = useState("");
  const { data: conversations } = useConversations();
  const create = useCreateChatList();
  const setMembers = useSetChatListMembers();

  const filtered = useMemo(() => {
    const list = (conversations ?? []).filter((c) => !c.archived_at);
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter((c) => (c.display_title ?? "").toLowerCase().includes(term));
  }, [conversations, q]);

  const submit = async () => {
    if (!name.trim()) return;
    const created = await create.mutateAsync({ name, color, icon });
    if (selected.size > 0) {
      await setMembers.mutateAsync({
        listId: created.id,
        conversationIds: Array.from(selected),
      });
    }
    onClose();
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Daftar baru</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Nama daftar</label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mis. Ditanggapi AI"
            maxLength={40}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Warna</label>
          <div className="flex flex-wrap gap-2">
            {CHAT_LIST_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Warna ${c}`}
                className="grid h-8 w-8 place-items-center rounded-full ring-2 ring-transparent transition"
                style={{
                  backgroundColor: c,
                  outline: color === c ? "2px solid hsl(var(--foreground))" : "none",
                  outlineOffset: 2,
                }}
              >
                {color === c ? <Check className="h-4 w-4 text-white" /> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Ikon</label>
          <div className="flex flex-wrap gap-2">
            {CHAT_LIST_ICONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setIcon(n)}
                aria-label={`Ikon ${n}`}
                className={
                  "grid h-9 w-9 place-items-center rounded-full border " +
                  (icon === n ? "border-foreground bg-muted" : "border-border")
                }
              >
                <ChatListIcon name={n} className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Tambahkan chat (opsional)</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari chat…"
              className="h-9 pl-8"
            />
          </div>
          <ul className="max-h-52 overflow-auto rounded-md border">
            {filtered.length === 0 ? (
              <li className="p-3 text-center text-xs text-muted-foreground">
                Tidak ada chat cocok.
              </li>
            ) : (
              filtered.map((c) => (
                <ConversationCheckRow
                  key={c.id}
                  conv={c}
                  checked={selected.has(c.id)}
                  onToggle={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                />
              ))
            )}
          </ul>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Batal
        </Button>
        <Button onClick={submit} disabled={!name.trim() || create.isPending}>
          {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Buat
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function EditListDialog({
  list, onClose,
}: {
  list: ChatListWithCount;
  onClose: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [color, setColor] = useState(list.color);
  const [icon, setIcon] = useState(list.icon);
  const [q, setQ] = useState("");
  const { data: conversations } = useConversations();
  const { data: memberIds } = useChatListMembers(list.id);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [inited, setInited] = useState(false);

  // Init selected from server data once
  if (!inited && memberIds) {
    setSelected(new Set(memberIds));
    setInited(true);
  }

  const update = useUpdateChatList();
  const setMembers = useSetChatListMembers();
  const del = useDeleteChatList();

  const filtered = useMemo(() => {
    const list = (conversations ?? []).filter((c) => !c.archived_at);
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter((c) => (c.display_title ?? "").toLowerCase().includes(term));
  }, [conversations, q]);

  const save = async () => {
    await update.mutateAsync({ id: list.id, name, color, icon });
    await setMembers.mutateAsync({
      listId: list.id,
      conversationIds: Array.from(selected),
    });
    onClose();
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Hapus daftar "${list.name}"?`,
      description: "Chat di dalamnya tidak akan terhapus, hanya daftar ini.",
      confirmText: "Hapus",
      cancelText: "Batal",
      destructive: true,
    });
    if (!ok) return;
    await del.mutateAsync(list.id);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ubah daftar</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nama daftar</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Warna</label>
            <div className="flex flex-wrap gap-2">
              {CHAT_LIST_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Warna ${c}`}
                  className="grid h-8 w-8 place-items-center rounded-full"
                  style={{
                    backgroundColor: c,
                    outline: color === c ? "2px solid hsl(var(--foreground))" : "none",
                    outlineOffset: 2,
                  }}
                >
                  {color === c ? <Check className="h-4 w-4 text-white" /> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ikon</label>
            <div className="flex flex-wrap gap-2">
              {CHAT_LIST_ICONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setIcon(n)}
                  aria-label={`Ikon ${n}`}
                  className={
                    "grid h-9 w-9 place-items-center rounded-full border " +
                    (icon === n ? "border-foreground bg-muted" : "border-border")
                  }
                >
                  <ChatListIcon name={n} className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Anggota ({selected.size})</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari chat…"
                className="h-9 pl-8"
              />
            </div>
            <ul className="max-h-52 overflow-auto rounded-md border">
              {filtered.length === 0 ? (
                <li className="p-3 text-center text-xs text-muted-foreground">
                  Tidak ada chat cocok.
                </li>
              ) : (
                filtered.map((c) => (
                  <ConversationCheckRow
                    key={c.id}
                    conv={c}
                    checked={selected.has(c.id)}
                    onToggle={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                  />
                ))
              )}
            </ul>
          </div>
        </div>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={remove}
            disabled={del.isPending}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Hapus daftar
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              <X className="mr-2 h-4 w-4" /> Batal
            </Button>
            <Button
              onClick={save}
              disabled={!name.trim() || update.isPending || setMembers.isPending}
            >
              {(update.isPending || setMembers.isPending) ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Simpan
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConversationCheckRow({
  conv, checked, onToggle,
}: {
  conv: ConversationListItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={
          "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60 " +
          (checked ? "bg-primary/5" : "")
        }
      >
        <span
          className={
            "grid h-5 w-5 place-items-center rounded border " +
            (checked ? "border-primary bg-primary text-primary-foreground" : "border-border")
          }
        >
          {checked ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{conv.display_title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {conv.kind === "group" ? "Grup" : conv.kind === "order" ? "Order" : "Chat"}
            {conv.pinned_at ? " · Favorit" : ""}
          </span>
        </span>
      </button>
    </li>
  );
}
