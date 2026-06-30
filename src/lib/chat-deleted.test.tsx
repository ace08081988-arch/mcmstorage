import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DELETED_PLACEHOLDER,
  DELETED_ATTACHMENT_PLACEHOLDER,
  ATTACHMENT_FALLBACK,
  hasAttachment,
  isDeleted,
  messagePreviewText,
  DeletedPreview,
  MessagePreview,
  type DeletableMessage,
} from "./chat-deleted";

const base = (over: Partial<DeletableMessage> = {}): DeletableMessage => ({
  body: null,
  deleted_at: null,
  attachment_path: null,
  attachment_mime: null,
  attachment_name: null,
  ...over,
});

describe("chat-deleted helpers", () => {
  describe("hasAttachment", () => {
    it("is false for null/empty", () => {
      expect(hasAttachment(null)).toBe(false);
      expect(hasAttachment(undefined)).toBe(false);
      expect(hasAttachment(base())).toBe(false);
    });
    it.each([
      ["path", { attachment_path: "x/y.png" }],
      ["mime", { attachment_mime: "image/png" }],
      ["name", { attachment_name: "y.png" }],
    ])("is true when only %s present", (_label, over) => {
      expect(hasAttachment(base(over))).toBe(true);
    });
  });

  describe("isDeleted", () => {
    it("is false when deleted_at is null/missing", () => {
      expect(isDeleted(null)).toBe(false);
      expect(isDeleted(base())).toBe(false);
    });
    it("is true when deleted_at has any value", () => {
      expect(isDeleted(base({ deleted_at: "2026-01-01T00:00:00Z" }))).toBe(true);
    });
  });

  describe("messagePreviewText", () => {
    it("returns empty string for null/undefined", () => {
      expect(messagePreviewText(null)).toBe("");
      expect(messagePreviewText(undefined)).toBe("");
    });

    it("returns trimmed body when present and not deleted", () => {
      expect(messagePreviewText(base({ body: "  hello  " }))).toBe("hello");
    });

    it("prefers attachment name over generic fallback", () => {
      expect(
        messagePreviewText(base({ attachment_name: "doc.pdf", attachment_mime: "application/pdf" })),
      ).toBe("📎 doc.pdf");
    });

    it("falls back to generic attachment label when only mime/path present", () => {
      expect(messagePreviewText(base({ attachment_path: "x/y.png" }))).toBe(ATTACHMENT_FALLBACK);
      expect(messagePreviewText(base({ attachment_mime: "image/png" }))).toBe(ATTACHMENT_FALLBACK);
    });

    it("returns empty string when there is no body and no attachment", () => {
      expect(messagePreviewText(base({ body: "   " }))).toBe("");
    });

    it("returns deleted placeholder alone when no attachment", () => {
      expect(messagePreviewText(base({ body: "secret", deleted_at: "now" }))).toBe(DELETED_PLACEHOLDER);
    });

    it.each([
      ["path", { attachment_path: "x/y.png" }],
      ["mime", { attachment_mime: "image/png" }],
      ["name", { attachment_name: "y.png" }],
    ])(
      "appends attachment placeholder for deleted message with attachment (%s)",
      (_label, over) => {
        const out = messagePreviewText(base({ deleted_at: "now", body: "x", ...over }));
        expect(out).toBe(`${DELETED_PLACEHOLDER} · ${DELETED_ATTACHMENT_PLACEHOLDER}`);
      },
    );

    it("never leaks original body or attachment name when deleted", () => {
      const out = messagePreviewText(
        base({ body: "rahasia", attachment_name: "rahasia.pdf", deleted_at: "now" }),
      );
      expect(out).not.toContain("rahasia");
      expect(out).not.toContain("rahasia.pdf");
    });
  });

  describe("DeletedPreview component", () => {
    it("renders deleted placeholder only (no attachment)", () => {
      const html = renderToStaticMarkup(<DeletedPreview message={base({ deleted_at: "now" })} />);
      expect(html).toContain(DELETED_PLACEHOLDER);
      expect(html).not.toContain(DELETED_ATTACHMENT_PLACEHOLDER);
    });

    it("renders both placeholders when attachment present", () => {
      const html = renderToStaticMarkup(
        <DeletedPreview message={base({ deleted_at: "now", attachment_path: "x.png" })} />,
      );
      expect(html).toContain(DELETED_PLACEHOLDER);
      expect(html).toContain(DELETED_ATTACHMENT_PLACEHOLDER);
    });
  });

  describe("MessagePreview component", () => {
    it("renders null for null message", () => {
      expect(renderToStaticMarkup(<MessagePreview message={null} />)).toBe("");
    });

    it("renders DeletedPreview for deleted messages", () => {
      const html = renderToStaticMarkup(
        <MessagePreview message={base({ body: "rahasia-pesan", deleted_at: "now" })} />,
      );
      expect(html).toContain(DELETED_PLACEHOLDER);
      expect(html).not.toContain("rahasia-pesan");
    });

    it("renders body text for live messages", () => {
      const html = renderToStaticMarkup(<MessagePreview message={base({ body: "halo" })} />);
      expect(html).toContain("halo");
    });

    it("falls back to ATTACHMENT_FALLBACK when no body or name", () => {
      const html = renderToStaticMarkup(
        <MessagePreview message={base({ attachment_mime: "image/png" })} />,
      );
      expect(html).toContain(ATTACHMENT_FALLBACK);
    });
  });
});