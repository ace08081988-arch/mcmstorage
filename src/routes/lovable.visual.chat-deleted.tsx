/**
 * Deterministic visual harness for chat "(pesan dihapus)" rendering.
 *
 * Mounted under /lovable/visual/chat-deleted so it inherits the
 * /lovable/* robots-disallowed prefix and is consumed by Playwright in
 * tests/visual/chat-deleted.public.spec.ts.
 *
 * All data here is hard-coded — no network, no auth, no time-dependent
 * formatting — so screenshots stay byte-stable across runs.
 */
import { createFileRoute } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PinnedBanner } from "@/components/chat/PinnedBanner";
import { MessageInfoDialog } from "@/components/chat/MessageInfoDialog";
import { MessagePreview } from "@/lib/chat-deleted";
import type { MessageRow } from "@/lib/chat";

type Part = "pinned" | "info-live" | "info-deleted" | "list" | "all";

export const Route = createFileRoute("/lovable/visual/chat-deleted")({
  component: VisualHarness,
  validateSearch: (s: Record<string, unknown>): { part: Part } => {
    const p = s.part as Part | undefined;
    const allowed: Part[] = ["pinned", "info-live", "info-deleted", "list", "all"];
    return { part: allowed.includes(p as Part) ? (p as Part) : "all" };
  },
  head: () => ({
    meta: [
      { title: "Visual harness — chat deleted" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

const FIXED_ISO = "2026-06-30T03:15:00.000Z";
const FIXED_READ_MS = Date.parse("2026-06-30T03:16:30.000Z");

const mkRow = (over: Partial<MessageRow> = {}): MessageRow =>
  ({
    id: "m-fixture-1",
    conversation_id: "c-fixture",
    sender_id: "u-fixture",
    body: null,
    attachment_path: null,
    attachment_name: null,
    attachment_mime: null,
    reply_to_id: null,
    edited_at: null,
    deleted_at: null,
    created_at: FIXED_ISO,
    ...over,
  } as MessageRow);

const pinnedLive = mkRow({ id: "pin-live", body: "Pengumuman: stok GS baru tiba" });
const pinnedDeleted = mkRow({
  id: "pin-del",
  body: "rahasia",
  attachment_name: "rahasia.pdf",
  attachment_path: "uploads/rahasia.pdf",
  deleted_at: FIXED_ISO,
});

const infoLive = mkRow({ id: "info-live", body: "Halo, pesan biasa" });
const infoDeleted = mkRow({
  id: "info-del",
  body: "rahasia",
  attachment_name: "rahasia.pdf",
  attachment_path: "uploads/rahasia.pdf",
  attachment_mime: "application/pdf",
  deleted_at: FIXED_ISO,
});

type Row = { id: string; title: string; preview: ReturnType<typeof MessagePreview>; time: string };

const conversationRows: Row[] = [
  {
    id: "c1",
    title: "Andi (live)",
    preview: <MessagePreview message={mkRow({ body: "Sampai jumpa besok ya" })} />,
    time: "10:15",
  },
  {
    id: "c2",
    title: "Budi (deleted, no attach)",
    preview: <MessagePreview message={mkRow({ body: "rahasia", deleted_at: FIXED_ISO })} />,
    time: "09:42",
  },
  {
    id: "c3",
    title: "Citra (deleted + attachment)",
    preview: (
      <MessagePreview
        message={mkRow({
          body: "rahasia",
          attachment_name: "rahasia.pdf",
          attachment_path: "uploads/rahasia.pdf",
          deleted_at: FIXED_ISO,
        })}
      />
    ),
    time: "09:10",
  },
  {
    id: "c4",
    title: "Dewi (attachment only)",
    preview: <MessagePreview message={mkRow({ attachment_name: "invoice.pdf" })} />,
    time: "08:55",
  },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section data-visual-section={id} className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="rounded-lg border bg-card">{children}</div>
    </section>
  );
}

function VisualHarness() {
  const { part } = Route.useSearch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const show = (p: Part) => part === "all" || part === p;
  return (
    <QueryClientProvider client={qc}>
      <div className="mx-auto max-w-md space-y-6 p-4">
        <h1 className="text-lg font-semibold">Visual harness — chat deleted</h1>

        {show("pinned") ? (
          <>
        <Section id="pinned-banner-live" title="PinnedBanner — live">
          <PinnedBanner
            conversationId="c-fixture"
            pinned={[pinnedLive]}
            onJump={() => {}}
            canUnpin
          />
        </Section>

        <Section id="pinned-banner-deleted" title="PinnedBanner — deleted with attachment">
          <PinnedBanner
            conversationId="c-fixture"
            pinned={[pinnedDeleted]}
            onJump={() => {}}
            canUnpin
          />
        </Section>

        <Section id="pinned-banner-mixed" title="PinnedBanner — mixed (live + deleted)">
          <PinnedBanner
            conversationId="c-fixture"
            pinned={[pinnedLive, pinnedDeleted]}
            onJump={() => {}}
            canUnpin={false}
          />
        </Section>
          </>
        ) : null}

        {show("info-live") ? (
          <Section id="message-info-live" title="MessageInfoDialog — live">
            <MessageInfoDialog
              open
              onOpenChange={() => {}}
              message={infoLive}
              senderName="Andi Pratama"
              readAtMs={FIXED_READ_MS}
            />
          </Section>
        ) : null}

        {show("info-deleted") ? (
          <Section id="message-info-deleted" title="MessageInfoDialog — deleted">
            <MessageInfoDialog
              open
              onOpenChange={() => {}}
              message={infoDeleted}
              senderName="Citra"
              readAtMs={null}
            />
          </Section>
        ) : null}

        {show("list") ? (
          <Section id="conversation-list" title="Conversation list — mixed states">
          <ul className="divide-y">
            {conversationRows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="h-9 w-9 shrink-0 rounded-full bg-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{r.title}</span>
                    <span className="text-[11px] text-muted-foreground">{r.time}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{r.preview}</div>
                </div>
              </li>
            ))}
          </ul>
          </Section>
        ) : null}
      </div>
    </QueryClientProvider>
  );
}