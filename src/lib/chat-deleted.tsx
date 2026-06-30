import { Ban } from "lucide-react";
import type { ReactNode } from "react";

export const DELETED_PLACEHOLDER = "(pesan dihapus)";
export const DELETED_ATTACHMENT_PLACEHOLDER = "(lampiran dihapus)";
export const ATTACHMENT_FALLBACK = "(lampiran)";

export type DeletableMessage = {
  body?: string | null;
  deleted_at?: string | null;
  attachment_path?: string | null;
  attachment_mime?: string | null;
  attachment_name?: string | null;
};

export function hasAttachment(m: DeletableMessage | null | undefined): boolean {
  if (!m) return false;
  return !!(m.attachment_path || m.attachment_mime || m.attachment_name);
}

export function isDeleted(m: DeletableMessage | null | undefined): boolean {
  return !!m?.deleted_at;
}

/** Plain-text preview for lists, copy/forward, push notifications, etc. */
export function messagePreviewText(m: DeletableMessage | null | undefined): string {
  if (!m) return "";
  if (isDeleted(m)) {
    return hasAttachment(m) ? `${DELETED_PLACEHOLDER} · ${DELETED_ATTACHMENT_PLACEHOLDER}` : DELETED_PLACEHOLDER;
  }
  const body = m.body?.trim();
  if (body) return body;
  if (m.attachment_name) return `📎 ${m.attachment_name}`;
  if (hasAttachment(m)) return ATTACHMENT_FALLBACK;
  return "";
}

/** Rich render for reply previews / banners; shares the same wording as the plain-text helper. */
export function DeletedPreview({
  message,
  className,
  iconClassName = "h-3 w-3 opacity-80",
}: {
  message: DeletableMessage;
  className?: string;
  iconClassName?: string;
}): ReactNode {
  const attach = hasAttachment(message);
  return (
    <span className={className ?? "inline-flex items-center gap-1 italic"}>
      <Ban className={iconClassName} />
      {DELETED_PLACEHOLDER}
      {attach ? ` · ${DELETED_ATTACHMENT_PLACEHOLDER}` : ""}
    </span>
  );
}

/** Reply-preview-style renderer that picks the right output for any message. */
export function MessagePreview({ message }: { message: DeletableMessage | null | undefined }): ReactNode {
  if (!message) return null;
  if (isDeleted(message)) return <DeletedPreview message={message} />;
  return <>{messagePreviewText(message) || ATTACHMENT_FALLBACK}</>;
}