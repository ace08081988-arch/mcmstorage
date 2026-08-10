import { createFileRoute, Link } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { Activity, ArrowRight, Gauge } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollPerfAlertsCard } from "@/components/ScrollPerfAlertsCard";
import {
  DEFAULT_ALERT_PREFS,
  loadAlertPrefs,
  saveAlertPrefs,
  subscribeScrollPerfAlerts,
} from "@/lib/scroll-perf-alerts";

export const Route = createFileRoute("/_authenticated/pengaturan-performa")({
  head: () => ({
    meta: [
      { title: "Notifikasi Performa · Ace Storage" },
      {
        name: "description",
        content:
          "Aktifkan atau matikan peringatan performa seperti \u201CScroll terasa berat\u201D, dan atur ambang FPS serta latensinya.",
      },
      { property: "og:title", content: "Notifikasi Performa · Ace Storage" },
      {
        property: "og:description",
        content:
          "Kontrol penuh atas peringatan performa scroll: nyalakan, matikan, atau atur ambangnya.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PengaturanPerformaPage,
});

function PengaturanPerformaPage() {
  const prefs = useSyncExternalStore(
    subscribeScrollPerfAlerts,
    loadAlertPrefs,
    () => DEFAULT_ALERT_PREFS,
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-ms-4 py-ms-4 sm:px-ms-6 sm:py-ms-6 space-ms-4 sm:space-ms-5">
      <div>
        <h1 className="text-ms-lg font-semibold tracking-tight">Notifikasi Performa</h1>
        <p className="text-ms-sm text-muted-foreground leading-snug">
          Atur peringatan seperti &ldquo;Scroll terasa berat&rdquo;. Secara bawaan
          peringatan ini mati agar tidak mengganggu; nyalakan hanya saat sedang
          menelusuri masalah performa.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-ms-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-ms-2 text-ms-base">
                <Gauge className="h-4 w-4" aria-hidden />
                Peringatan &ldquo;Scroll terasa berat&rdquo;
              </CardTitle>
              <CardDescription className="text-ms-xs">
                {prefs.enabled
                  ? "Aktif — toast muncul saat gulir terasa lambat."
                  : "Mati — tidak ada toast performa yang muncul."}
              </CardDescription>
            </div>
            <Switch
              checked={prefs.enabled}
              onCheckedChange={(v) => saveAlertPrefs({ enabled: v })}
              aria-label="Aktifkan notifikasi performa scroll"
            />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-ms-2xs text-muted-foreground">
            Kejadian performa tetap dicatat meski notifikasi dimatikan, jadi Anda
            bisa memeriksanya kapan saja tanpa terganggu pop-up.
          </p>
        </CardContent>
      </Card>

      <ScrollPerfAlertsCard />

      <Card>
        <CardContent className="flex items-center justify-between gap-ms-3 py-ms-4">
          <div className="min-w-0">
            <p className="text-ms-sm font-medium">Diagnostik lanjutan</p>
            <p className="text-ms-2xs text-muted-foreground">
              Grafik FPS waktu nyata, riwayat sesi, dan ekspor CSV.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/diagnostik-viewport" search={{ teknis: "1" } as never}>
              <Activity className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Buka
              <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default PengaturanPerformaPage;
