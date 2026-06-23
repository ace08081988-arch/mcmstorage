import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, LogOut, Pencil, Search, Trash2, UserPlus, UserRound, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  useAddGroupMember,
  useChatContacts,
  useMyUserId,
  useRemoveGroupMember,
  useRenameConversation,
} from "@/lib/chat";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  currentTitle: string | null;
  ownerUserId: string;
  /** Called after the current user leaves the group so the page can navigate away. */
  onLeft?: () => void;
};

export function ManageGroupDialog({
  open,
  onOpenChange,
  conversationId,
  currentTitle,
  ownerUserId,
  onLeft,
}: Props) {
  const { data: myId } = useMyUserId();
  const isOwner = !!myId && myId === ownerUserId;

  const [title, setTitle] = useState(currentTitle ?? "");
  const [q, setQ] = useState("");

  const rename = useRenameConversation(conversationId);
  const addMember = useAddGroupMember(conversationId);
  const removeMember = useRemoveGroupMember(conversationId);

  // Current members + their profiles (for display).
  const members = useQuery({
    queryKey: ["chat", "conv-members-profiles", conversationId],
    enabled: open,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("conversation_members")
        .select("user_id, role")
        .eq("conversation_id", conversationId);
      if (error) throw error;
      const ids = (rows ?? []).map((r) => r.user_id as string);
      if (ids.length === 0) return [] as Array<{
        user_id: string;
        role: string;
        display_name: string | null;
        phone: string | null;
      }>;
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, phone")
        .in("id", ids);
      const pm = new Map((profs ?? []).map((p) => [p.id, p]));
      return (rows ?? []).map((r) => ({
        user_id: r.user_id as string,
        role: (r.role as string) ?? "member",
        display_name: pm.get(r.user_id as string)?.display_name ?? null,
        phone: pm.get(r.user_id as string)?.phone ?? null,
      }));
    },
  });

  const memberIds = useMemo(
    () => new Set((members.data ?? []).map((m) => m.user_id)),
    [members.data],
  );

  // Contacts available to invite (filtered to those NOT already in the group).
  const contacts = useChatContacts(q);
  const candidates = useMemo(
    () => (contacts.data ?? []).filter((c) => !memberIds.has(c.user_id)),
    [contacts.data, memberIds],
  );

  const onRename = async () => {
    try {
      await rename.mutateAsync(title);
      toast.success("Nama grup diperbarui");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengubah nama");
    }
  };

  const onInvite = async (userId: string) => {
    try {
      await addMember.mutateAsync(userId);
      toast.success("Anggota ditambahkan");
      setQ("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menambah anggota");
    }
  };

  const onRemove = async (userId: string) => {
    try {
      await removeMember.mutateAsync(userId);
      toast.success(userId === myId ? "Anda keluar dari grup" : "Anggota dikeluarkan");
      if (userId === myId) {
        onOpenChange(false);
        onLeft?.();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus anggota");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Kelola grup
          </DialogTitle>
          <DialogDescription>
            {isOwner
              ? "Sebagai pemilik grup, Anda bisa mengganti nama, menambah, dan mengeluarkan anggota."
              : "Anda anggota grup ini. Anda bisa melihat anggota lain dan keluar dari grup."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isOwner ? (
            <div className="space-y-1.5">
              <Label htmlFor="group-rename">Nama grup</Label>
              <div className="flex gap-2">
                <Input
                  id="group-rename"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  placeholder="Nama grup"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={rename.isPending || title.trim() === (currentTitle ?? "").trim() || !title.trim()}
                  onClick={() => void onRename()}
                  className="gap-1.5"
                >
                  {rename.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                  Simpan
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>Anggota ({members.data?.length ?? 0})</Label>
            <ul className="max-h-48 space-y-1 overflow-auto rounded-md border p-1">
              {members.isLoading ? (
                <li className="flex items-center justify-center p-4 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat anggota…
                </li>
              ) : (members.data ?? []).length === 0 ? (
                <li className="p-4 text-center text-xs text-muted-foreground">Belum ada anggota.</li>
              ) : (
                members.data!.map((m) => {
                  const isMe = m.user_id === myId;
                  const isMemberOwner = m.user_id === ownerUserId;
                  const canRemove = !isMemberOwner && (isOwner || isMe);
                  return (
                    <li
                      key={m.user_id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                    >
                      <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary">
                        <UserRound className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {m.display_name || m.phone || "Pengguna"}
                          {isMe ? <span className="ml-1 text-[10px] text-muted-foreground">(Anda)</span> : null}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {isMemberOwner ? "Pemilik grup" : m.role || "Anggota"}
                        </div>
                      </div>
                      {canRemove ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={removeMember.isPending}
                          onClick={() => void onRemove(m.user_id)}
                          className="gap-1 text-destructive hover:text-destructive"
                        >
                          {isMe ? <LogOut className="h-4 w-4" /> : <X className="h-4 w-4" />}
                          {isMe ? "Keluar" : "Keluarkan"}
                        </Button>
                      ) : null}
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          {isOwner ? (
            <div className="space-y-1.5">
              <Label htmlFor="group-add">Tambah anggota</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="group-add"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Cari kontak yang sudah tertaut…"
                  className="pl-8"
                />
              </div>
              <ul className="max-h-44 space-y-1 overflow-auto rounded-md border p-1">
                {contacts.isLoading ? (
                  <li className="flex items-center justify-center p-3 text-xs text-muted-foreground">
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Memuat…
                  </li>
                ) : candidates.length === 0 ? (
                  <li className="p-3 text-center text-xs text-muted-foreground">
                    {(contacts.data ?? []).length === 0
                      ? "Belum ada kontak yang bisa diundang. Tautkan akun pelanggan/pemasok dulu."
                      : "Semua kontak yang cocok sudah jadi anggota."}
                  </li>
                ) : (
                  candidates.map((c) => (
                    <li key={c.user_id}>
                      <button
                        type="button"
                        disabled={addMember.isPending}
                        onClick={() => void onInvite(c.user_id)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                      >
                        <div className="grid h-7 w-7 place-items-center rounded-full bg-muted text-muted-foreground">
                          <UserPlus className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            {c.display_name || c.phone || "Pengguna"}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {c.phone ? `${c.phone} · ` : ""}{c.label ?? c.kind}
                          </div>
                        </div>
                        <Check className="h-4 w-4 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}

          {!isOwner ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs text-muted-foreground">
                Keluar dari grup ini berarti Anda tidak akan menerima pesan baru.
                Pesan lama Anda tetap terlihat oleh anggota lain.
              </p>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mt-2 gap-1.5"
                disabled={!myId || removeMember.isPending}
                onClick={() => myId && void onRemove(myId)}
              >
                {removeMember.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Keluar dari grup
              </Button>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}