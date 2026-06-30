import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Copy } from "lucide-react";
import { toast } from "sonner";
import { computeSecurityCode } from "@/lib/chat-extras";

export function SecurityCodeDialog({
  open,
  onOpenChange,
  conversationId,
  memberIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversationId: string;
  memberIds: string[];
}) {
  const [code, setCode] = useState<string>("…");
  useEffect(() => {
    if (!open) return;
    let alive = true;
    computeSecurityCode([conversationId, ...memberIds]).then((c) => {
      if (alive) setCode(c);
    });
    return () => {
      alive = false;
    };
  }, [open, conversationId, memberIds]);

  const rows = code.split(" ").reduce<string[][]>((acc, g, i) => {
    if (i % 4 === 0) acc.push([]);
    acc[acc.length - 1].push(g);
    return acc;
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Kode keamanan percakapan</DialogTitle>
          <DialogDescription>
            Bandingkan kode ini dengan kode di perangkat lawan chat. Kode yang sama berarti percakapan kalian tertaut ke peserta yang sama. Kode berubah jika anggota berubah.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/40 p-4 font-mono text-center text-base leading-7 tracking-widest">
          {rows.map((r, i) => (
            <div key={i}>{r.join("  ")}</div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard?.writeText(code).then(
                () => toast.success("Kode disalin"),
                () => toast.error("Gagal menyalin"),
              );
            }}
          >
            <Copy className="mr-2 h-4 w-4" /> Salin kode
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}