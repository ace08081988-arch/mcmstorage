import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MessageSquarePlus, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useDeleteQuickReply, useQuickReplies, useSaveQuickReply, type QuickReply } from "@/lib/chat-extras";

export const Route = createFileRoute("/_authenticated/balas-cepat")({
  component: QuickRepliesPage,
});

function QuickRepliesPage() {
  const { data: replies = [], isLoading } = useQuickReplies();
  const save = useSaveQuickReply();
  const del = useDeleteQuickReply();
  const [draft, setDraft] = useState<{ id?: string; shortcut: string; body: string } | null>(null);

  return (
    <div className="container mx-auto max-w-3xl space-y-4 p-3">
      <header className="flex items-center gap-2">
        <MessageSquarePlus className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Balas cepat</h1>
        <Button size="sm" className="ml-auto" onClick={() => setDraft({ shortcut: "", body: "" })}>
          <Plus className="mr-1 h-4 w-4" /> Baru
        </Button>
      </header>
      <p className="text-xs text-muted-foreground">
        Ketik <code>/</code> diikuti shortcut di kotak pesan chat untuk menyisipkan balasan ini secara cepat.
      </p>

      {draft ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{draft.id ? "Edit" : "Baru"}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">/</span>
              <Input placeholder="shortcut" value={draft.shortcut} onChange={(e) => setDraft({ ...draft, shortcut: e.target.value })} maxLength={32} />
            </div>
            <Textarea rows={4} placeholder="Isi balasan" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>Batal</Button>
              <Button
                disabled={save.isPending || !draft.body.trim() || !draft.shortcut.trim()}
                onClick={() => {
                  save.mutate(
                    { id: draft.id, shortcut: draft.shortcut, body: draft.body.trim() },
                    {
                      onSuccess: () => {
                        toast.success("Tersimpan");
                        setDraft(null);
                      },
                      onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal"),
                    },
                  );
                }}
              >
                Simpan
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : replies.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada balas cepat.</p>
      ) : (
        <ul className="space-y-2">
          {replies.map((r: QuickReply) => (
            <li key={r.id}>
              <Card>
                <CardContent className="flex items-start gap-2 p-3">
                  <div className="flex-1">
                    <p className="font-mono text-xs text-primary">/{r.shortcut}</p>
                    <p className="whitespace-pre-wrap text-sm">{r.body}</p>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDraft({ id: r.id, shortcut: r.shortcut, body: r.body })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => del.mutate(r.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}