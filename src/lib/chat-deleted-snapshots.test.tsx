/**
 * Snapshot tests for deleted-message rendering across the chat surfaces.
 *
 * Any change to how `(pesan dihapus)` / `(lampiran dihapus)` are rendered
 * (icon, wrapper element, ordering, text, italic styling) MUST update these
 * snapshots intentionally — that's the point of the test.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  DeletedPreview,
  MessagePreview,
  messagePreviewText,
  type DeletableMessage,
} from "./chat-deleted";
import { PinnedBanner } from "@/components/chat/PinnedBanner";
import { MessageInfoDialog } from "@/components/chat/MessageInfoDialog";
import type { MessageRow, ConversationListItem } from "@/lib/chat";

const mkMessage = (over: Partial<DeletableMessage> = {}): DeletableMessage => ({
  body: null,
  deleted_at: null,
  attachment_path: null,
  attachment_mime: null,
  attachment_name: null,
  ...over,
});

const mkRow = (over: Partial<MessageRow> = {}): MessageRow =>
  ({
    id: "m-1",
    conversation_id: "c-1",
    sender_id: "u-1",
    body: null,
    attachment_path: null,
    attachment_name: null,
    attachment_mime: null,
    attachment_size: null,
    reply_to: null,
    created_at: "2026-06-30T00:00:00.000Z",
    edited_at: null,
    deleted_at: null,
    ...over,
  }) as unknown as MessageRow;

function withQuery(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe("snapshots: deleted message rendering", () => {
  describe("DeletedPreview", () => {
    it("snapshot: no attachment", () => {
      expect(
        renderToStaticMarkup(<DeletedPreview message={mkMessage({ deleted_at: "now" })} />),
      ).toMatchSnapshot();
    });

    it("snapshot: with attachment", () => {
      expect(
        renderToStaticMarkup(
          <DeletedPreview message={mkMessage({ deleted_at: "now", attachment_path: "x.png" })} />,
        ),
      ).toMatchSnapshot();
    });
  });

  describe("MessagePreview", () => {
    it("snapshot: live text", () => {
      expect(
        renderToStaticMarkup(<MessagePreview message={mkMessage({ body: "halo" })} />),
      ).toMatchSnapshot();
    });

    it("snapshot: live attachment-only", () => {
      expect(
        renderToStaticMarkup(
          <MessagePreview message={mkMessage({ attachment_name: "foto.png" })} />,
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: deleted text", () => {
      expect(
        renderToStaticMarkup(
          <MessagePreview message={mkMessage({ body: "rahasia", deleted_at: "now" })} />,
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: deleted with attachment", () => {
      expect(
        renderToStaticMarkup(
          <MessagePreview
            message={mkMessage({
              body: "rahasia",
              attachment_name: "rahasia.pdf",
              attachment_path: "x.pdf",
              deleted_at: "now",
            })}
          />,
        ),
      ).toMatchSnapshot();
    });
  });

  describe("PinnedBanner", () => {
    it("snapshot: empty pinned list renders nothing", () => {
      expect(
        renderToStaticMarkup(
          withQuery(
            <PinnedBanner conversationId="c-1" pinned={[]} onJump={() => {}} canUnpin={false} />,
          ),
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: live + deleted pinned messages", () => {
      const pinned: MessageRow[] = [
        mkRow({ id: "m-1", body: "Penting: jangan lupa" }),
        mkRow({ id: "m-2", body: "rahasia", deleted_at: "2026-06-30T00:00:00.000Z" }),
        mkRow({
          id: "m-3",
          body: "rahasia",
          attachment_name: "file.pdf",
          attachment_path: "x.pdf",
          deleted_at: "2026-06-30T00:00:00.000Z",
        }),
      ];
      expect(
        renderToStaticMarkup(
          withQuery(
            <PinnedBanner conversationId="c-1" pinned={pinned} onJump={() => {}} canUnpin />,
          ),
        ),
      ).toMatchSnapshot();
    });
  });

  describe("MessageInfoDialog", () => {
    it("snapshot: live message with attachment", () => {
      const html = renderToStaticMarkup(
        <MessageInfoDialog
          open
          onOpenChange={() => {}}
          message={mkRow({
            id: "m-info-1",
            body: "halo",
            attachment_path: "x.pdf",
            attachment_name: "invoice.pdf",
          })}
          senderName="Andi"
          readAtMs={null}
        />,
      );
      expect(html).toMatchSnapshot();
    });

    it("snapshot: deleted message with attachment", () => {
      const html = renderToStaticMarkup(
        <MessageInfoDialog
          open
          onOpenChange={() => {}}
          message={mkRow({
            id: "m-info-2",
            body: "rahasia",
            attachment_path: "x.pdf",
            attachment_name: "rahasia.pdf",
            deleted_at: "2026-06-30T00:00:00.000Z",
          })}
          senderName="Andi"
          readAtMs={null}
        />,
      );
      expect(html).toMatchSnapshot();
    });

    it("snapshot: null message renders nothing", () => {
      const html = renderToStaticMarkup(
        <MessageInfoDialog
          open
          onOpenChange={() => {}}
          message={null}
          senderName="Andi"
          readAtMs={null}
        />,
      );
      expect(html).toMatchSnapshot();
    });
  });

  describe("Conversation list preview", () => {
    /** Mirrors the row rendered in the chat list (mobile + desktop sidebar). */
    function ConversationRowPreview({ item }: { item: Pick<ConversationListItem, "display_title" | "last_body" | "last_at"> }) {
      return (
        <div className="flex flex-col gap-0.5 px-3 py-2">
          <span className="font-medium">{item.display_title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {item.last_body ?? ""}
          </span>
        </div>
      );
    }

    it("snapshot: live last message", () => {
      const last_body = messagePreviewText(mkMessage({ body: "halo dunia" })) || "Lampiran";
      expect(
        renderToStaticMarkup(
          <ConversationRowPreview
            item={{ display_title: "Andi", last_body, last_at: "2026-06-30T00:00:00.000Z" }}
          />,
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: last message deleted (text only)", () => {
      const last_body =
        messagePreviewText(mkMessage({ body: "rahasia", deleted_at: "now" })) || "Lampiran";
      expect(
        renderToStaticMarkup(
          <ConversationRowPreview
            item={{ display_title: "Andi", last_body, last_at: "2026-06-30T00:00:00.000Z" }}
          />,
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: last message deleted with attachment", () => {
      const last_body =
        messagePreviewText(
          mkMessage({
            body: "rahasia",
            attachment_name: "rahasia.pdf",
            attachment_path: "x.pdf",
            deleted_at: "now",
          }),
        ) || "Lampiran";
      expect(
        renderToStaticMarkup(
          <ConversationRowPreview
            item={{ display_title: "Andi", last_body, last_at: "2026-06-30T00:00:00.000Z" }}
          />,
        ),
      ).toMatchSnapshot();
    });
  });

  describe("Edge cases: extreme data combinations", () => {
    const LONG_BODY = "A".repeat(2000);
    const LONG_NAME = `${"nama-file-sangat-panjang-".repeat(20)}.pdf`;

    it("snapshot: MessagePreview with very long body (live)", () => {
      expect(
        renderToStaticMarkup(<MessagePreview message={mkMessage({ body: LONG_BODY })} />),
      ).toMatchSnapshot();
    });

    it("snapshot: MessagePreview with very long body (deleted)", () => {
      expect(
        renderToStaticMarkup(
          <MessagePreview message={mkMessage({ body: LONG_BODY, deleted_at: "now" })} />,
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: MessagePreview with 0 attachments and empty body", () => {
      expect(
        renderToStaticMarkup(<MessagePreview message={mkMessage({ body: "   " })} />),
      ).toMatchSnapshot();
    });

    it("snapshot: MessagePreview with 1 attachment, no name (path only)", () => {
      expect(
        renderToStaticMarkup(
          <MessagePreview message={mkMessage({ attachment_path: "uploads/blob-1" })} />,
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: MessagePreview with 1 attachment, mime only", () => {
      expect(
        renderToStaticMarkup(
          <MessagePreview message={mkMessage({ attachment_mime: "image/png" })} />,
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: MessagePreview with 1 attachment named, very long name", () => {
      expect(
        renderToStaticMarkup(
          <MessagePreview message={mkMessage({ attachment_name: LONG_NAME })} />,
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: MessagePreview with multiple attachment hints (path+mime+name)", () => {
      // The schema models a single attachment per message; this exercises the
      // ">1 attachment metadata fields populated" combination.
      expect(
        renderToStaticMarkup(
          <MessagePreview
            message={mkMessage({
              attachment_path: "uploads/a.pdf",
              attachment_mime: "application/pdf",
              attachment_name: "a.pdf, b.pdf, c.pdf",
            })}
          />,
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: DeletedPreview with empty/whitespace sender metadata (no attachment)", () => {
      expect(
        renderToStaticMarkup(
          <DeletedPreview
            message={mkMessage({ body: "   ", deleted_at: "now", attachment_name: "" })}
          />,
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: DeletedPreview with multi-field attachment metadata", () => {
      expect(
        renderToStaticMarkup(
          <DeletedPreview
            message={mkMessage({
              deleted_at: "now",
              attachment_path: "uploads/a.pdf",
              attachment_mime: "application/pdf",
              attachment_name: "a.pdf, b.pdf",
            })}
          />,
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: DeletedPreview with custom className + iconClassName", () => {
      expect(
        renderToStaticMarkup(
          <DeletedPreview
            message={mkMessage({ deleted_at: "now", attachment_path: "x" })}
            className="text-xs text-muted-foreground"
            iconClassName="h-2 w-2"
          />,
        ),
      ).toMatchSnapshot();
    });

    it("snapshot: MessagePreview with all metadata null/undefined", () => {
      expect(
        renderToStaticMarkup(<MessagePreview message={mkMessage({})} />),
      ).toMatchSnapshot();
    });

    it("snapshot: MessagePreview when message is null", () => {
      expect(renderToStaticMarkup(<MessagePreview message={null} />)).toMatchSnapshot();
    });

    it("snapshot: MessagePreview when message is undefined", () => {
      expect(renderToStaticMarkup(<MessagePreview message={undefined} />)).toMatchSnapshot();
    });
  });

  describe("Sequence rendering: 10–20 deleted items, mixed bodies & attachments", () => {
    // Deterministic fixture builder: pick body length & attachment shape by index.
    const bodyVariants = [
      "rahasia",
      "x",
      "Halo " + "panjang ".repeat(40), // ~280 chars
      "A".repeat(2000),
      "   ", // whitespace-only
      "",
      "Pesan dengan emoji 🚀🔥 dan unicode: ümlaut, 中文, العربية",
      "B".repeat(50),
    ] as const;

    type AttachShape =
      | "none"
      | "name-only"
      | "path-only"
      | "mime-only"
      | "name+path"
      | "name+path+mime";

    const attachShapes: AttachShape[] = [
      "none",
      "name-only",
      "path-only",
      "mime-only",
      "name+path",
      "name+path+mime",
    ];

    function mkSeqItem(i: number, deleted: boolean) {
      const body = bodyVariants[i % bodyVariants.length];
      const shape = attachShapes[i % attachShapes.length];
      const name = `file-${i}.pdf`;
      const path = `uploads/${i}/blob`;
      const mime = i % 2 === 0 ? "application/pdf" : "image/png";
      const over: Partial<DeletableMessage> = { body, deleted_at: deleted ? `now-${i}` : null };
      if (shape === "name-only") over.attachment_name = name;
      if (shape === "path-only") over.attachment_path = path;
      if (shape === "mime-only") over.attachment_mime = mime;
      if (shape === "name+path") {
        over.attachment_name = name;
        over.attachment_path = path;
      }
      if (shape === "name+path+mime") {
        over.attachment_name = name;
        over.attachment_path = path;
        over.attachment_mime = mime;
      }
      return mkMessage(over);
    }

    function SequenceList({
      count,
      mode,
    }: {
      count: number;
      mode: "all-deleted" | "mixed";
    }) {
      const items = Array.from({ length: count }, (_, i) =>
        mkSeqItem(i, mode === "all-deleted" ? true : i % 2 === 0),
      );
      return (
        <ul>
          {items.map((m, i) => (
            <li key={i} data-i={i}>
              <MessagePreview message={m} />
            </li>
          ))}
        </ul>
      );
    }

    function DeletedSequenceList({ count }: { count: number }) {
      const items = Array.from({ length: count }, (_, i) => mkSeqItem(i, true));
      return (
        <ul>
          {items.map((m, i) => (
            <li key={i} data-i={i}>
              <DeletedPreview message={m} />
            </li>
          ))}
        </ul>
      );
    }

    it("snapshot: MessagePreview sequence — 10 items, all deleted, mixed bodies & attachments", () => {
      expect(
        renderToStaticMarkup(<SequenceList count={10} mode="all-deleted" />),
      ).toMatchSnapshot();
    });

    it("snapshot: MessagePreview sequence — 15 items, mixed live/deleted", () => {
      expect(
        renderToStaticMarkup(<SequenceList count={15} mode="mixed" />),
      ).toMatchSnapshot();
    });

    it("snapshot: MessagePreview sequence — 20 items, all deleted (max)", () => {
      expect(
        renderToStaticMarkup(<SequenceList count={20} mode="all-deleted" />),
      ).toMatchSnapshot();
    });

    it("snapshot: DeletedPreview sequence — 10 items, mixed attachment shapes", () => {
      expect(renderToStaticMarkup(<DeletedSequenceList count={10} />)).toMatchSnapshot();
    });

    it("snapshot: DeletedPreview sequence — 20 items, mixed attachment shapes (max)", () => {
      expect(renderToStaticMarkup(<DeletedSequenceList count={20} />)).toMatchSnapshot();
    });
  });
});