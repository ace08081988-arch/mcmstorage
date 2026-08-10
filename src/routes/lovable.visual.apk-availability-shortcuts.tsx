/**
 * Harness publik no-auth untuk E2E alur ketersediaan APK pada tombol:
 *   - <DownloadChatApkShortcut>
 *   - <DownloadStorageApkShortcut>
 *   - <CopyChatApkLinksButton variant="shortcut">
 *
 * Setiap tombol dibungkus wrapper dengan `data-testid` stabil sehingga
 * test bisa membedakan tombol utama dan tombol ikon refresh yang punya
 * aria-label serupa antar varian Chat/Storage.
 *
 * URL: /lovable/visual/apk-availability-shortcuts
 * Test menyetel `page.route('**\/_serverFn/**')` untuk mensimulasikan
 * respons "belum tersedia" (releases kosong) → "tersedia" (ada rilis).
 */
import { createFileRoute } from "@tanstack/react-router";
import { DownloadChatApkShortcut } from "@/components/DownloadChatApkShortcut";
import { DownloadStorageApkShortcut } from "@/components/DownloadStorageApkShortcut";
import { CopyChatApkLinksButton } from "@/components/CopyChatApkLinksButton";

export const Route = createFileRoute(
  "/lovable/visual/apk-availability-shortcuts",
)({
  head: () => ({
    meta: [
      { title: "Harness · APK availability shortcuts" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ApkAvailabilityShortcutsHarness,
});

function ApkAvailabilityShortcutsHarness() {
  return (
    <div className="mx-auto max-w-md space-ms-4 p-ms-4">
      <h1 className="text-ms-lg font-semibold">
        APK availability shortcuts (harness)
      </h1>
      <p className="text-ms-xs text-muted-foreground">
        Halaman ini hanya untuk E2E; jangan diindeks.
      </p>

      <section
        data-testid="apk-shortcut-download-chat"
        className="rounded-md border p-ms-3"
      >
        <div className="mb-2 text-ms-xs font-medium">Download APK Chat</div>
        <DownloadChatApkShortcut />
      </section>

      <section
        data-testid="apk-shortcut-download-storage"
        className="rounded-md border p-ms-3"
      >
        <div className="mb-2 text-ms-xs font-medium">Download APK Storage</div>
        <DownloadStorageApkShortcut />
      </section>

      <section
        data-testid="apk-shortcut-copy-chat-links"
        className="rounded-md border p-ms-3"
      >
        <div className="mb-2 text-ms-xs font-medium">Copy semua link APK Chat</div>
        <CopyChatApkLinksButton variant="shortcut" />
      </section>
    </div>
  );
}