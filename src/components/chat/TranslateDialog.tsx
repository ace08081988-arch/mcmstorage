import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { translateMessage } from "@/lib/chat-ai.functions";

export function TranslateDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: string;
}) {
  const [target, setTarget] = useState<"id" | "en">("id");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !source) return;
    let alive = true;
    setLoading(true);
    setErr(null);
    setResult(null);
    translateMessage({ data: { text: source, target } })
      .then((r) => {
        if (alive) setResult(r.translation);
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : "Gagal");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, source, target]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Terjemahkan pesan</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">Asli</div>
            <div className="max-h-32 overflow-y-auto rounded-md border bg-muted/30 p-2 text-sm whitespace-pre-wrap">{source}</div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-muted-foreground">Terjemahan ({target === "id" ? "Indonesia" : "Inggris"})</div>
            <Button size="sm" variant="outline" onClick={() => setTarget(target === "id" ? "en" : "id")}>
              <ArrowLeftRight className="mr-2 h-3 w-3" /> {target === "id" ? "ke Inggris" : "ke Indonesia"}
            </Button>
          </div>
          <div className="min-h-20 rounded-md border bg-background p-2 text-sm whitespace-pre-wrap">
            {loading ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Menerjemahkan…</span>
            ) : err ? (
              <span className="text-destructive">{err}</span>
            ) : (
              result ?? ""
            )}
          </div>
          {result ? (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(result).then(
                    () => toast.success("Terjemahan disalin"),
                    () => toast.error("Gagal menyalin"),
                  );
                }}
              >
                <Copy className="mr-2 h-3 w-3" /> Salin terjemahan
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}