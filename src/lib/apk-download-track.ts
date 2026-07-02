// Client-side helper: fire-and-forget tracking for APK download clicks.
// Uses navigator.sendBeacon so navigation to the APK URL does not cancel the request.
export type ApkTrackVariant = "storage" | "chat";
export type ApkTrackSource = "button" | "copy_page" | "copy_file";

export function trackApkDownload(
  variant: ApkTrackVariant,
  source: ApkTrackSource = "button",
): void {
  if (typeof window === "undefined") return;
  try {
    const url = "/api/public/apk-download-track";
    const payload = JSON.stringify({ variant, source });
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      const ok = navigator.sendBeacon(url, blob);
      if (ok) return;
    }
    // Fallback: keepalive fetch so it survives navigation.
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}