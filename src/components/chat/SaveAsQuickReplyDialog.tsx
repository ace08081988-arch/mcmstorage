import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useSaveQuickReply } from "@/lib/chat-extras";

export function SaveAsQuickReplyDialog({
  open,
  onOpenChange,
  defaultBody,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultBody: string;
}) {
  const save = useSaveQuickReply();
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    if (open) {
      setShortcut("");
      setBody(defaultBody);
    }
  }, [open, defaultBody]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah balas cepat</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Shortcut (huruf kecil, tanpa spasi)</label>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">/</span>
              <Input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="terimakasih" maxLength={32} />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Ketik <code>/{shortcut || "shortcut"}</code> di kotak pesan untuk memunculkan teks ini.</p>
          </div>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="Isi balasan" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button
            disabled={save.isPending || !body.trim() || !shortcut.trim()}
            onClick={() => {
              save.mutate(
                { shortcut, body: body.trim() },
                {
                  onSuccess: () => {
                    toast.success("Balas cepat tersimpan");
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