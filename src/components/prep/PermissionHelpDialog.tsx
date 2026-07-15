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
          <DialogTitle className="flex items-center gap-ms-2 text-ms-base">
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
            <span>{guide.title}</span>
          </DialogTitle>
          <DialogDescription className="text-ms-xs leading-relaxed">
            {guide.intro}
          </DialogDescription>
        </DialogHeader>
        <ol className="ml-5 list-decimal space-y-1.5 text-ms-xs leading-relaxed text-foreground">
          {guide.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {guide.hint && (
          <p className="rounded-md border border-primary/30 bg-primary/5 p-ms-2 text-ms-2xs leading-relaxed text-primary">
            {guide.hint}
          </p>
        )}
        <DialogFooter className="flex-col gap-ms-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { if (typeof window !== "undefined") window.location.reload(); }}
            className="gap-ms-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Muat ulang halaman
          </Button>
          <Button type="button" size="sm" onClick={onClose} className="gap-ms-1.5">
            <ExternalLink className="h-3.5 w-3.5" /> Sudah, coba lagi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}