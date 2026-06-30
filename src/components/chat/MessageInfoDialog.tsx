import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MessageRow } from "@/lib/chat";

export function MessageInfoDialog({
  open,
  onOpenChange,
  message,
  senderName,
  readAtMs,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  message: MessageRow | null;
  senderName: string;
  readAtMs: number | null | undefined;
}) {
  if (!message) return null;
  const sent = new Date(message.created_at);
  const read = readAtMs && readAtMs >= sent.getTime();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Info pesan</DialogTitle>
        </DialogHeader>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Pengirim</dt><dd className="text-right">{senderName}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Dikirim</dt><dd className="text-right">{sent.toLocaleString("id-ID")}</dd></div>
          {message.edited_at ? (
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Diedit</dt><dd className="text-right">{new Date(message.edited_at).toLocaleString("id-ID")}</dd></div>
          ) : null}
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Status</dt><dd className="text-right">{message.deleted_at ? "Dihapus" : read ? "Dibaca" : "Terkirim"}</dd></div>
          {readAtMs ? (
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Dibaca</dt><dd className="text-right">{new Date(readAtMs).toLocaleString("id-ID")}</dd></div>
          ) : null}
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">ID</dt><dd className="break-all text-right font-mono text-[11px]">{message.id}</dd></div>
          {message.attachment_path ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Lampiran</dt>
              <dd className="break-all text-right text-[11px]">
                {message.deleted_at ? <em className="text-muted-foreground">(lampiran dihapus)</em> : (message.attachment_name ?? message.attachment_path)}
              </dd>
            </div>
          ) : null}
        </dl>
      </DialogContent>
    </Dialog>
  );
}