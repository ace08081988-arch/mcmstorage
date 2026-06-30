import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useSaveNote } from "@/lib/chat-extras";

export function SaveAsNoteDialog({
  open,
  onOpenChange,
  defaultBody,
  conversationId,
  sourceMessageId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultBody: string;
  conversationId?: string;
  sourceMessageId?: string;
}) {
  const save = useSaveNote();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    if (open) {
      setBody(defaultBody);
      setTitle(defaultBody.slice(0, 40));
    }
  }, [open, defaultBody]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah ke Catatan</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Judul catatan" maxLength={120} />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Isi catatan" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button
            disabled={save.isPending || !body.trim()}
            onClick={() => {
              save.mutate(
                {
                  title: title.trim() || body.trim().slice(0, 40),
                  body: body.trim(),
                  source_message_id: sourceMessageId ?? null,
                  conversation_id: conversationId ?? null,
                },
                {
                  onSuccess: () => {
                    toast.success("Catatan tersimpan");
                    onOpenChange(false);
                  },
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal"),
                },
              );
            }}
          >
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}