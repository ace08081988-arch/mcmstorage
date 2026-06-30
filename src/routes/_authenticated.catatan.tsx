import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { NotebookPen, Plus, Trash2, Pencil, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useChatNotes, useDeleteNote, useSaveNote, type ChatNote } from "@/lib/chat-extras";

export const Route = createFileRoute("/_authenticated/catatan")({
  component: NotesPage,
});

function NotesPage() {
  const { data: notes = [], isLoading } = useChatNotes();
  const save = useSaveNote();
  const del = useDeleteNote();
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<{ id?: string; title: string; body: string } | null>(null);

  const filtered = notes.filter((n) =>
    !filter.trim()
      ? true
      : (n.title + " " + n.body).toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="container mx-auto max-w-3xl space-y-4 p-3">
      <header className="flex items-center gap-2">
        <NotebookPen className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Catatan</h1>
        <div className="ml-auto flex items-center gap-2">
          <Input placeholder="Cari…" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40" />
          <Button size="sm" onClick={() => setDraft({ title: "", body: "" })}>
            <Plus className="mr-1 h-4 w-4" /> Baru
          </Button>
        </div>
      </header>

      {draft ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{draft.id ? "Edit catatan" : "Catatan baru"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Judul" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <Textarea rows={5} placeholder="Isi catatan" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>Batal</Button>
              <Button
                disabled={save.isPending || !draft.body.trim()}
                onClick={() => {
                  save.mutate(
                    { id: draft.id, title: draft.title.trim() || draft.body.trim().slice(0, 40), body: draft.body.trim() },
                    {
                      onSuccess: () => {
                        toast.success("Catatan tersimpan");
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
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada catatan. Tambahkan dari sini atau pilih pesan di chat lalu pilih “Tambah ke Catatan”.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((n: ChatNote) => (
            <li key={n.id}>
              <Card>
                <CardContent className="space-y-1 p-3">
                  <div className="flex items-start gap-2">
                    <h3 className="flex-1 font-semibold text-sm">{n.title}</h3>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => navigator.clipboard?.writeText(n.body).then(() => toast.success("Disalin"))}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDraft({ id: n.id, title: n.title, body: n.body })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => del.mutate(n.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{n.body}</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(n.updated_at).toLocaleString("id-ID")}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}