import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, MessageSquarePlus, Search, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useChatContacts, useStartDm } from "@/lib/chat";

export function NewDmDialog() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: contacts, isLoading } = useChatContacts(q);
  const startDm = useStartDm();
  const navigate = useNavigate();

  const onPick = async (uid: string) => {
    try {
      const id = await startDm.mutateAsync(uid);
      setOpen(false);
      navigate({ to: "/chat/$conversationId", params: { conversationId: id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memulai chat");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" size="sm" className="gap-1.5">
          <MessageSquarePlus className="h-4 w-4" /> Chat baru
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mulai chat dengan kontak</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama atau nomor telepon…"
            className="pl-8"
            autoFocus
          />
        </div>
        <div className="max-h-80 space-y-1 overflow-auto rounded-md border p-1">
          {isLoading ? (
            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
            </div>
          ) : (contacts ?? []).length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              Belum ada kontak yang dapat diajak chat. Tautkan akun pelanggan/pemasok terlebih dahulu.
            </div>
          ) : (
            (contacts ?? []).map((c) => (
              <button
                key={c.user_id}
                type="button"
                onClick={() => onPick(c.user_id)}
                disabled={startDm.isPending}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent disabled:opacity-50"
              >
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
                  <UserRound className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {c.display_name || c.phone || "Pengguna"}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {c.phone ? `${c.phone} · ` : ""}{c.label ?? c.kind}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}