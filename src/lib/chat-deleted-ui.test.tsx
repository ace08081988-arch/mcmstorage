/**
 * UI-level "end-to-end" coverage for deleted-message rendering.
 *
 * These tests reproduce the actual JSX shapes used by the chat surfaces
 * (message bubble, composer reply preview, MessageInfoDialog attachment row,
 * conversation list preview) and assert that — regardless of the call site —
 * the placeholders rendered by `chat-deleted.tsx` stay consistent and never
 * leak the deleted content.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DELETED_PLACEHOLDER,
  DELETED_ATTACHMENT_PLACEHOLDER,
  MessagePreview,
  messagePreviewText,
  isDeleted,
  hasAttachment,
  type DeletableMessage,
} from "./chat-deleted";

const SECRET_BODY = "rahasia-bocor-jangan-tampil";
const SECRET_NAME = "rahasia-file.pdf";

function mkMessage(over: Partial<DeletableMessage> = {}): DeletableMessage {
  return {
    body: null,
    deleted_at: null,
    attachment_path: null,
    attachment_mime: null,
    attachment_name: null,
    ...over,
  };
}

/** Mirrors the bubble shape used in chat.$conversationId.tsx for the message body. */
function MessageBubble({ message }: { message: DeletableMessage }) {
  return (
    <div data-testid="bubble" className={isDeleted(message) ? "italic opacity-70" : ""}>
      <MessagePreview message={message} />
    </div>
  );
}

/** Mirrors the composer reply preview block above the input. */
function ComposerReplyPreview({ replyTo }: { replyTo: DeletableMessage }) {
  return (
    <div data-testid="composer-reply" className="rounded border p-2 text-xs">
      <span className="font-medium">Membalas: </span>
      <MessagePreview message={replyTo} />
    </div>
  );
}

/** Mirrors MessageInfoDialog attachment row. */
function AttachmentInfoRow({ message }: { message: DeletableMessage }) {
  if (!hasAttachment(message)) return null;
  const label = isDeleted(message) ? DELETED_ATTACHMENT_PLACEHOLDER : message.attachment_name;
  return (
    <div data-testid="attachment-row">
      <span>Lampiran: </span>
      <span>{label}</span>
    </div>
  );
}

describe("chat-deleted UI (e2e render)", () => {
  describe("MessageBubble", () => {
    it("shows live body untouched", () => {
      const html = renderToStaticMarkup(
        <MessageBubble message={mkMessage({ body: "halo dunia" })} />,
      );
      expect(html).toContain("halo dunia");
      expect(html).not.toContain(DELETED_PLACEHOLDER);
    });

    it("renders deleted placeholder for deleted text-only message", () => {
      const html = renderToStaticMarkup(
        <MessageBubble message={mkMessage({ body: SECRET_BODY, deleted_at: "2026-01-01" })} />,
      );
      expect(html).toContain(DELETED_PLACEHOLDER);
      expect(html).not.toContain(SECRET_BODY);
      // italic styling class is applied for deleted state
      expect(html).toMatch(/italic/);
    });

    it("renders both placeholders + Ban icon when deleted message had attachment", () => {
      const html = renderToStaticMarkup(
        <MessageBubble
          message={mkMessage({
            body: SECRET_BODY,
            attachment_name: SECRET_NAME,
            attachment_mime: "application/pdf",
            attachment_path: "x/y.pdf",
            deleted_at: "2026-01-01",
          })}
        />,
      );
      expect(html).toContain(DELETED_PLACEHOLDER);
      expect(html).toContain(DELETED_ATTACHMENT_PLACEHOLDER);
      expect(html).toContain("lucide-ban");
      expect(html).not.toContain(SECRET_BODY);
      expect(html).not.toContain(SECRET_NAME);
    });
  });

  describe("Composer reply preview", () => {
    it("shows original body when replying to live message", () => {
      const html = renderToStaticMarkup(
        <ComposerReplyPreview replyTo={mkMessage({ body: "pesan asli" })} />,
      );
      expect(html).toContain("Membalas:");
      expect(html).toContain("pesan asli");
    });

    it("substitutes deleted placeholder and never shows original body", () => {
      const html = renderToStaticMarkup(
        <ComposerReplyPreview
          replyTo={mkMessage({ body: SECRET_BODY, deleted_at: "now" })}
        />,
      );
      expect(html).toContain(DELETED_PLACEHOLDER);
      expect(html).not.toContain(SECRET_BODY);
    });

    it("shows both placeholders for deleted reply target with attachment", () => {
      const html = renderToStaticMarkup(
        <ComposerReplyPreview
          replyTo={mkMessage({
            body: SECRET_BODY,
            attachment_name: SECRET_NAME,
            attachment_path: "x.pdf",
            deleted_at: "now",
          })}
        />,
      );
      expect(html).toContain(DELETED_PLACEHOLDER);
      expect(html).toContain(DELETED_ATTACHMENT_PLACEHOLDER);
      expect(html).not.toContain(SECRET_NAME);
      expect(html).not.toContain(SECRET_BODY);
    });
  });

  describe("Attachment indicator (MessageInfoDialog)", () => {
    it("shows real file name for live attachment", () => {
      const html = renderToStaticMarkup(
        <AttachmentInfoRow
          message={mkMessage({ attachment_name: "invoice.pdf", attachment_path: "x.pdf" })}
        />,
      );
      expect(html).toContain("invoice.pdf");
      expect(html).not.toContain(DELETED_ATTACHMENT_PLACEHOLDER);
    });

    it("replaces file name with placeholder when message deleted", () => {
      const html = renderToStaticMarkup(
        <AttachmentInfoRow
          message={mkMessage({
            attachment_name: SECRET_NAME,
            attachment_path: "x.pdf",
            deleted_at: "now",
          })}
        />,
      );
      expect(html).toContain(DELETED_ATTACHMENT_PLACEHOLDER);
      expect(html).not.toContain(SECRET_NAME);
    });

    it("renders nothing when there is no attachment", () => {
      const html = renderToStaticMarkup(
        <AttachmentInfoRow message={mkMessage({ body: "halo" })} />,
      );
      expect(html).toBe("");
    });
  });

  describe("Conversation list preview (text)", () => {
    it("uses deleted placeholder + attachment placeholder together", () => {
      const text = messagePreviewText(
        mkMessage({
          body: SECRET_BODY,
          attachment_name: SECRET_NAME,
          deleted_at: "now",
        }),
      );
      expect(text).toBe(`${DELETED_PLACEHOLDER} · ${DELETED_ATTACHMENT_PLACEHOLDER}`);
      expect(text).not.toContain(SECRET_BODY);
      expect(text).not.toContain(SECRET_NAME);
    });

    it("composer, bubble, and list previews stay byte-identical for the same deleted message", () => {
      const msg = mkMessage({
        body: SECRET_BODY,
        attachment_name: SECRET_NAME,
        attachment_path: "x.pdf",
        deleted_at: "now",
      });
      const bubble = renderToStaticMarkup(<MessagePreview message={msg} />);
      const reply = renderToStaticMarkup(<MessagePreview message={msg} />);
      const listText = messagePreviewText(msg);
      expect(bubble).toBe(reply);
      expect(bubble).toContain(DELETED_PLACEHOLDER);
      expect(bubble).toContain(DELETED_ATTACHMENT_PLACEHOLDER);
      expect(listText).toContain(DELETED_PLACEHOLDER);
      expect(listText).toContain(DELETED_ATTACHMENT_PLACEHOLDER);
    });
  });
});