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
  head: () => ({
    meta: [
      { title: "Balas Cepat · Ace Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: QuickRepliesPage,
});

function QuickRepliesPage() {
  const { data: replies = [], isLoading } = useQuickReplies();
  const save = useSaveQuickReply();
  const del = useDeleteQuickReply();
  const [draft, setDraft] = useState<{ id?: string; shortcut: string; body: string } | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-ms-4 px-ms-4 py-ms-5 md:max-w-4xl md:p-ms-6">
      <header className="rounded-2xl border border-border/60 bg-card/95 p-ms-4 shadow-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-ms-3">
          <div className="flex min-w-0 items-center gap-ms-2">
            <MessageSquarePlus className="h-5 w-5 shrink-0 text-primary" />
            <h1 className="truncate text-ms-lg font-semibold leading-tight">Balas cepat</h1>
          </div>
          <Button size="sm" className="shrink-0" onClick={() => setDraft({ shortcut: "", body: "" })}>
            <Plus className="mr-1 h-4 w-4" /> Baru
          </Button>
        </div>
        <p className="mt-ms-2 text-ms-xs leading-relaxed text-muted-foreground">
          Ketik <code>/</code> diikuti shortcut di kotak pesan chat untuk menyisipkan balasan ini secara cepat.
        </p>
      </header>

      {draft ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-ms-sm">{draft.id ? "Edit" : "Baru"}</CardTitle></CardHeader>
          <CardContent className="space-ms-2">
            <div className="flex items-center gap-ms-1">
              <span className="text-muted-foreground">/</span>
              <Input placeholder="shortcut" value={draft.shortcut} onChange={(e) => setDraft({ ...draft, shortcut: e.target.value })} maxLength={32} />
            </div>
            <Textarea rows={4} placeholder="Isi balasan" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <div className="flex justify-end gap-ms-2">
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
        <Card>
          <CardContent className="p-ms-4 text-ms-sm text-muted-foreground">Memuat…</CardContent>
        </Card>
      ) : replies.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-ms-2 p-ms-6 text-center">
            <MessageSquarePlus className="h-8 w-8 text-primary/70" />
            <p className="text-ms-sm font-medium">Belum ada balas cepat</p>
            <p className="max-w-sm text-ms-xs text-muted-foreground">
              Simpan jawaban yang sering dipakai (mis. ongkir, rekening, jam buka) supaya bisa dikirim satu ketukan.
            </p>
            <Button size="sm" className="mt-ms-1" onClick={() => setDraft({ shortcut: "", body: "" })}>
              <Plus className="mr-1 h-4 w-4" /> Buat balas cepat
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-ms-2">
          {replies.map((r: QuickReply) => (
            <li key={r.id}>
              <Card>
                <CardContent className="flex items-start gap-ms-2 p-ms-3">
                  <div className="flex-1">
                    <p className="font-mono text-ms-xs text-primary">/{r.shortcut}</p>
                    <p className="whitespace-pre-wrap text-ms-sm">{r.body}</p>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit balasan cepat" onClick={() => setDraft({ id: r.id, shortcut: r.shortcut, body: r.body })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label="Hapus balasan cepat" onClick={() => del.mutate(r.id)}>
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