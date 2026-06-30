import { test, expect } from "@playwright/test";

/**
 * Visual regression for chat "(pesan dihapus)" surfaces.
 *
 * Renders deterministic fixtures via /lovable/visual/chat-deleted?part=...
 * (public, no auth, no network) and snapshots:
 *   - PinnedBanner (live / deleted+attachment / mixed)
 *   - MessageInfoDialog (live / deleted)
 *   - Conversation list (live + deleted + attachment-only)
 *
 * Runs under the `mobile-public` project (matches *public.spec.ts).
 */

const HARNESS = "/lovable/visual/chat-deleted";

const PARTS: { name: string; part: "pinned" | "info-live" | "info-deleted" | "list" }[] = [
  { name: "pinned-banner", part: "pinned" },
  { name: "message-info-live", part: "info-live" },
  { name: "message-info-deleted", part: "info-deleted" },
  { name: "conversation-list", part: "list" },
];

test.describe("chat-deleted — visual", () => {
  for (const { name, part } of PARTS) {
    test(`${name}`, async ({ page }) => {
      await page.goto(`${HARNESS}?part=${part}`, { waitUntil: "networkidle" });
      await page.evaluate(() => (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
      // Dialogs render via Portal — wait until they're attached before shooting.
      if (part.startsWith("info-")) {
        await page.getByRole("dialog").waitFor({ state: "visible" });
      }
      await expect(page).toHaveScreenshot(`chat-deleted-${name}.png`, { fullPage: true });
    });
  }
});