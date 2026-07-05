import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { detectBrowser, permissionGuide, type MediaKind } from "@/lib/media-permission";

type Props = {
  open: boolean;
  onClose: () => void;
  kind: MediaKind;
};

export function PermissionHelpDialog({ open, onClose, kind }: Props) {
  const guide = useMemo(() => permissionGuide(kind, detectBrowser()), [kind]);
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
            <span>{guide.title}</span>
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {guide.intro}
          </DialogDescription>
        </DialogHeader>
        <ol className="ml-5 list-decimal space-y-1.5 text-xs leading-relaxed text-foreground">
          {guide.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {guide.hint && (
          <p className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[11px] leading-relaxed text-primary">
            {guide.hint}
          </p>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { if (typeof window !== "undefined") window.location.reload(); }}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Muat ulang halaman
          </Button>
          <Button type="button" size="sm" onClick={onClose} className="gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" /> Sudah, coba lagi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}