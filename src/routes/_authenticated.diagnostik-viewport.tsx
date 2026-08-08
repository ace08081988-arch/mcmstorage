/**
 * Diagnostik viewport-anchor: rekam & ekspor peristiwa posisi bar bawah.
 *
 * Dibuat untuk debugging perangkat low-end tanpa DevTools — user cukup
 * merekam, mereproduksi masalahnya, lalu Salin / Unduh / Bagikan log-nya.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChevronLeft,
  Circle,
  Copy,
  Download,
  Share2,
  Square,
  Trash2,
  Flag,
} from "lucide-react";
import {
  buildAnchorLogExport,
  buildAnchorLogText,
  clearAnchorLog,
  getAnchorLogSnapshot,
  isAnchorLogging,
  noteAnchorEvent,
  startAnchorLog,
  stopAnchorLog,
  subscribeAnchorLog,
  type AnchorLogEvent,
} from "@/lib/viewport-anchor-log";
import { useViewportAnchor, useViewportAnchorState } from "@/lib/use-viewport-anchor";
import { getViewportAnchorConfig } from "@/lib/viewport-anchor-config";
import { ScrollPerfCard } from "@/components/ScrollPerfCard";

export const Route = createFileRoute("/_authenticated/diagnostik-viewport")({
  head: () => ({
    meta: [
      { title: "Diagnostik viewport · Ace Storage" },
      {
        name: "description",
        content:
          "Rekam dan ekspor log peristiwa viewport-anchor: penyusutan, klasifikasi mode, dan offset bar bawah.",
      },
      { property: "og:title", content: "Diagnostik viewport · Ace Storage" },
      {
        property: "og:description",
        content: "Log shrink, klasifikasi, dan offset bar bawah untuk debugging perangkat low-end.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ViewportDiagnosticsPage,
});

const KIND_STYLE: Record<AnchorLogEvent["kind"], string> = {
  mode: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  offset: "border-border text-muted-foreground",
  autotune: "border-primary/40 text-primary",
  note: "border-amber-500/40 text-amber-600 dark:text-amber-400",
};

function ViewportDiagnosticsPage() {
  // Pastikan engine anchor hidup selama halaman ini dibuka.
  useViewportAnchor({ lock: true });
  const live = useViewportAnchorState();
  const cfg = getViewportAnchorConfig();

  const events = useSyncExternalStore(
    subscribeAnchorLog,
    getAnchorLogSnapshot,
    getAnchorLogSnapshot,
  );
  const recording = useSyncExternalStore(
    subscribeAnchorLog,
    isAnchorLogging,
    () => false,
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildAnchorLogText());
      toast.success("Log disalin ke papan klip");
    } catch {
      toast.error("Gagal menyalin — coba Unduh");
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(buildAnchorLogExport(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `viewport-anchor-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast.success("File log diunduh");
  };

  const share = async () => {
    const text = buildAnchorLogText();
    try {
      if (navigator.share) {
        await navigator.share({ title: "Log viewport-anchor", text });
        return;
      }
    } catch {
      /* dibatalkan user */
      return;
    }
    await copy();
  };

  return (
    <div className="px-ms-4 py-ms-4 space-y-ms-3">
      <div className="flex items-center justify-between gap-ms-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/pengaturan-tampilan">
            <ChevronLeft className="mr-1 h-4 w-4" />
            Pengaturan tampilan
          </Link>
        </Button>
        <Badge
          variant="outline"
          className={recording ? "border-red-500/50 text-red-500" : "text-muted-foreground"}
        >
          {recording ? "Merekam" : "Berhenti"}
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-ms-base">Diagnostik viewport-anchor</CardTitle>
          <CardDescription className="text-ms-xs">
            Tekan Rekam, lalu ulangi kejadiannya (scroll, buka keyboard). Setiap
            perubahan mode, offset, dan penyesuaian ambang tercatat lengkap dengan
            angka mentah, siap diekspor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-ms-3">
          <dl className="grid grid-cols-2 gap-x-ms-3 gap-y-1 text-[11px] tabular-nums sm:grid-cols-4">
            {[
              { k: "Mode", v: live.mode },
              { k: "Penyusutan", v: `${live.shrinkPx}px` },
              { k: "Offset", v: `${live.offsetPx}px` },
              { k: "Viewport", v: `${live.viewportPx}px` },
              { k: "Baseline", v: `${live.baselinePx}px` },
              { k: "Ambang buka", v: `${cfg.keyboardOpenPx}px` },
              { k: "Ambang tutup", v: `${cfg.keyboardClosePx}px` },
              { k: "Peristiwa", v: `${events.length}` },
            ].map((it) => (
              <div key={it.k} className="flex justify-between gap-2 sm:block">
                <dt className="text-muted-foreground">{it.k}</dt>
                <dd className="font-medium text-foreground">{it.v}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-ms-2 border-t pt-ms-3">
            {recording ? (
              <Button size="sm" variant="destructive" onClick={() => stopAnchorLog()}>
                <Square className="mr-1.5 h-3.5 w-3.5" />
                Berhenti
              </Button>
            ) : (
              <Button size="sm" onClick={() => startAnchorLog()}>
                <Circle className="mr-1.5 h-3.5 w-3.5" />
                Rekam
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                noteAnchorEvent("Ditandai user", live);
                toast.success("Penanda ditambahkan ke log");
              }}
            >
              <Flag className="mr-1.5 h-3.5 w-3.5" />
              Tandai momen
            </Button>
            <Button size="sm" variant="outline" onClick={copy} disabled={!events.length}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Salin
            </Button>
            <Button size="sm" variant="outline" onClick={download} disabled={!events.length}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Unduh JSON
            </Button>
            <Button size="sm" variant="outline" onClick={share} disabled={!events.length}>
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              Bagikan
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearAnchorLog();
                toast.success("Log dikosongkan");
              }}
              disabled={!events.length}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Kosongkan
            </Button>
          </div>
        </CardContent>
      </Card>

      <ScrollPerfCard />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-ms-sm">Peristiwa terekam</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="py-ms-4 text-center text-ms-xs text-muted-foreground">
              Belum ada peristiwa. Tekan <span className="font-medium">Rekam</span> lalu
              gulir halaman atau buka keyboard.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y overflow-y-auto text-[11px] tabular-nums">
              {events
                .slice()
                .reverse()
                .map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex items-start gap-ms-2 py-1.5">
                    <span className="w-14 shrink-0 text-muted-foreground">{e.t}ms</span>
                    <Badge variant="outline" className={`shrink-0 ${KIND_STYLE[e.kind]}`}>
                      {e.kind}
                    </Badge>
                    <span className="min-w-0 flex-1 break-words">
                      <span className="font-medium">{e.mode}</span> · shrink {e.shrinkPx}px ·
                      offset {e.offsetPx}px · vv {e.viewportPx}px · base {e.baselinePx}px
                      {e.recentlyScrolled ? " · scroll" : ""}
                      {e.detail ? (
                        <span className="block text-muted-foreground">{e.detail}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}