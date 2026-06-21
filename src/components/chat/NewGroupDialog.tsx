import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Users, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useChatContacts, useCreateGroup } from "@/lib/chat";

export function NewGroupDialog() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, true>>({});
  const { data: contacts, isLoading } = useChatContacts(q);
  const create = useCreateGroup();
  const navigate = useNavigate();

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = { ...p };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });

  const submit = async () => {
    const ids = Object.keys(picked);
    if (ids.length === 0) {
      toast.error("Pilih minimal 1 anggota");
      return;
    }
    try {
      const id = await create.mutateAsync({ title: title.trim() || "Grup baru", memberIds: ids });
      setOpen(false);
      setTitle("");
      setPicked({});
      navigate({ to: "/chat/$conversationId", params: { conversationId: id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat grup");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Users className="h-4 w-4" /> Grup baru
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Buat grup chat</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="grup-title">Nama grup</Label>
            <Input id="grup-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mis. Tim toko" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grup-q">Tambahkan anggota</Label>
            <Input id="grup-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kontak…" />
          </div>
          <div className="max-h-64 space-y-1 overflow-auto rounded-md border p-1">
            {isLoading ? (
              <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
              </div>
            ) : (contacts ?? []).length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">Tidak ada kontak.</div>
            ) : (
              (contacts ?? []).map((c) => {
                const on = !!picked[c.user_id];
                return (
                  <button
                    key={c.user_id}
                    type="button"
                    onClick={() => toggle(c.user_id)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                  >
                    <div className={`grid h-5 w-5 place-items-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                      {on ? <Check className="h-3.5 w-3.5" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.display_name || c.email || "Pengguna"}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{c.label ?? c.kind}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={create.isPending} className="gap-2">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            Buat grup ({Object.keys(picked).length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}