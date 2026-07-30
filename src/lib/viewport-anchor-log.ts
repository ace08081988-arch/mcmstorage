/**
 * Perekam peristiwa viewport-anchor untuk debugging perangkat low-end.
 *
 * Ring buffer di memori (tanpa I/O per frame) yang mencatat perubahan
 * penting: klasifikasi mode (idle / address bar / keyboard), penyusutan
 * viewport, offset kompensasi, serta penyesuaian otomatis dari auto-tuning.
 * Isinya bisa diekspor sebagai JSON/teks untuk dikirim lewat WhatsApp.
 */
import {
  getViewportAnchorConfig,
  type ViewportAnchorConfig,
} from "@/lib/viewport-anchor-config";
import { getAutotuneHistory, getAutotuneStats } from "@/lib/viewport-anchor-autotune";
import { peekDeviceKeySync } from "@/lib/device-key";

export type AnchorLogKind = "mode" | "offset" | "autotune" | "note";

export type AnchorLogEvent = {
  /** ms sejak perekaman dimulai. */
  t: number;
  at: number;
  kind: AnchorLogKind;
  mode: string;
  shrinkPx: number;
  offsetPx: number;
  viewportPx: number;
  baselinePx: number;
  recentlyScrolled: boolean;
  detail?: string;
};

const MAX_EVENTS = 600;

let events: AnchorLogEvent[] = [];
let recording = false;
let startedAt = 0;
let snapshot: AnchorLogEvent[] = [];

type Sub = () => void;
const subs = new Set<Sub>();

function emit() {
  snapshot = events.slice();
  subs.forEach((fn) => fn());
}

export function subscribeAnchorLog(fn: Sub) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function getAnchorLogSnapshot(): AnchorLogEvent[] {
  return snapshot;
}

export function isAnchorLogging() {
  return recording;
}

export function startAnchorLog() {
  recording = true;
  startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  emit();
}

export function stopAnchorLog() {
  recording = false;
  emit();
}

export function clearAnchorLog() {
  events = [];
  startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  emit();
}

export type AnchorLogInput = Omit<AnchorLogEvent, "t" | "at">;

/** Dipanggil engine anchor. No-op saat perekaman mati (murah). */
export function recordAnchorEvent(input: AnchorLogInput) {
  if (!recording) return;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  events.push({ ...input, t: Math.round(now - startedAt), at: Date.now() });
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  emit();
}

/** Catatan manual dari user ("di sini bar-nya melompat"). */
export function noteAnchorEvent(detail: string, base?: Partial<AnchorLogInput>) {
  if (!recording) startAnchorLog();
  recordAnchorEvent({
    kind: "note",
    mode: base?.mode ?? "-",
    shrinkPx: base?.shrinkPx ?? 0,
    offsetPx: base?.offsetPx ?? 0,
    viewportPx: base?.viewportPx ?? 0,
    baselinePx: base?.baselinePx ?? 0,
    recentlyScrolled: base?.recentlyScrolled ?? false,
    detail,
  });
}

function deviceInfo() {
  if (typeof window === "undefined") return {};
  const vv = window.visualViewport;
  return {
    deviceKey: peekDeviceKeySync(),
    userAgent: navigator.userAgent,
    screen: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
    dpr: window.devicePixelRatio,
    layoutHeight: document.documentElement.clientHeight,
    visualHeight: vv ? Math.round(vv.height) : null,
    orientation: window.innerWidth > window.innerHeight ? "landscape" : "portrait",
  };
}

export type AnchorLogExport = {
  generatedAt: string;
  device: ReturnType<typeof deviceInfo>;
  config: ViewportAnchorConfig;
  autotune: { stats: ReturnType<typeof getAutotuneStats>; history: ReturnType<typeof getAutotuneHistory> };
  events: AnchorLogEvent[];
};

export function buildAnchorLogExport(): AnchorLogExport {
  return {
    generatedAt: new Date().toISOString(),
    device: deviceInfo(),
    config: getViewportAnchorConfig(),
    autotune: { stats: getAutotuneStats(), history: getAutotuneHistory() },
    events: events.slice(),
  };
}

export function buildAnchorLogText(): string {
  const data = buildAnchorLogExport();
  const lines: string[] = [
    "=== MCM · Log viewport-anchor ===",
    `Waktu   : ${new Date(data.generatedAt).toLocaleString("id-ID")}`,
    `Device  : ${data.device.deviceKey ?? "-"} · ${data.device.screen ?? "-"} @${data.device.dpr ?? "-"}x (${data.device.orientation ?? "-"})`,
    `UA      : ${data.device.userAgent ?? "-"}`,
    `Config  : buka>${data.config.keyboardOpenPx} tutup<${data.config.keyboardClosePx} grace ${data.config.scrollGraceMs}ms maxChrome ${data.config.maxChromePx} settle ${data.config.settleMs}ms hyst ${data.config.hysteresisPx}px enabled=${data.config.enabled}`,
    `Autotune: skor ${data.autotune.stats.score} · ${data.autotune.stats.windows} jendela · stabil ${data.autotune.stats.stableStreak}`,
    `Events  : ${data.events.length}`,
    "",
    "t(ms)\tkind\tmode\tshrink\toffset\tvv\tbase\tscroll\tdetail",
  ];
  for (const e of data.events) {
    lines.push(
      [
        e.t,
        e.kind,
        e.mode,
        e.shrinkPx,
        e.offsetPx,
        e.viewportPx,
        e.baselinePx,
        e.recentlyScrolled ? "y" : "n",
        e.detail ?? "",
      ].join("\t"),
    );
  }
  if (data.autotune.history.length) {
    lines.push("", "--- Penyesuaian auto-tuning ---");
    for (const h of data.autotune.history) {
      lines.push(
        `${new Date(h.at).toLocaleTimeString("id-ID")} [${h.reason}] ${h.label} :: ${h.changes
          .map((c) => `${String(c.key)} ${c.from}→${c.to}`)
          .join(", ")}`,
      );
    }
  }
  return lines.join("\n");
}