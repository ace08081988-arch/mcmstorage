import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/status-notifikasi")({
  head: () => ({
    meta: [
      { title: "Status Notifikasi — MCM Storage" },
      { name: "description", content: "Diagnostik izin notifikasi browser dan konteks tampilan (iframe atau tab utama)." },
    ],
  }),
  component: StatusNotifikasiPage,
});

type PermState = "granted" | "denied" | "default" | "unsupported";

function readPermission(): PermState {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return (Notification.permission as PermState) ?? "default";
}

function detectFrame() {
  if (typeof window === "undefined") return { inIframe: false, sameOrigin: true };
  const inIframe = window.self !== window.top;
  let sameOrigin = true;
  try {
    // Accessing top.location throws when cross-origin.
    void window.top?.location.href;
  } catch {
    sameOrigin = false;
  }
  return { inIframe, sameOrigin };
}

function StatusNotifikasiPage() {
  const [perm, setPerm] = useState<PermState>(() => readPermission());
  const [frame, setFrame] = useState(() => detectFrame());
  const [swReady, setSwReady] = useState<boolean | null>(null);
  const [pushSub, setPushSub] = useState<boolean | null>(null);

  useEffect(() => {
    setPerm(readPermission());
    setFrame(detectFrame());
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then(async (reg) => {
        setSwReady(!!reg);
        if (reg && "pushManager" in reg) {
          const sub = await reg.pushManager.getSubscription().catch(() => null);
          setPushSub(!!sub);
        } else {
          setPushSub(false);
        }
      });
    } else {
      setSwReady(false);
      setPushSub(false);
    }
  }, []);

  const requestPerm = async () => {
    if (!("Notification" in window)) return;
    const res = await Notification.requestPermission();
    setPerm(res as PermState);
  };

  const permVariant: Record<PermState, "default" | "secondary" | "destructive" | "outline"> = {
    granted: "default",
    denied: "destructive",
    default: "secondary",
    unsupported: "outline",
  };

  const canPrompt = perm === "default" && !frame.inIframe;

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold">Status Notifikasi</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Izin browser</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Notification API" value={"Notification" in window ? "Tersedia" : "Tidak tersedia"} />
          <Row
            label="Permission"
            value={<Badge variant={permVariant[perm]}>{perm}</Badge>}
          />
          <Row label="Service worker" value={swReady === null ? "…" : swReady ? "Terdaftar" : "Belum terdaftar"} />
          <Row label="Push subscription" value={pushSub === null ? "…" : pushSub ? "Aktif" : "Tidak ada"} />
          {canPrompt && (
            <Button size="sm" onClick={requestPerm}>Minta izin notifikasi</Button>
          )}
          {perm === "denied" && (
            <p className="text-xs text-muted-foreground">
              Izin diblokir. Buka pengaturan situs di browser untuk mengaktifkan ulang.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Konteks tampilan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row
            label="Berjalan di"
            value={
              <Badge variant={frame.inIframe ? "secondary" : "default"}>
                {frame.inIframe ? "Iframe (preview editor)" : "Tab utama"}
              </Badge>
            }
          />
          <Row label="Same-origin dengan parent" value={frame.sameOrigin ? "Ya" : "Tidak (cross-origin)"} />
          <Row label="Origin" value={<code className="text-xs">{typeof window !== "undefined" ? window.location.origin : "-"}</code>} />
          {frame.inIframe && (
            <p className="text-xs text-muted-foreground">
              Browser umumnya memblokir prompt izin notifikasi di dalam iframe editor.
              Untuk menguji banner sistem, buka domain published langsung di tab baru.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ringkasan kesiapan</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <Readiness perm={perm} inIframe={frame.inIframe} sw={swReady} sub={pushSub} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Readiness({
  perm,
  inIframe,
  sw,
  sub,
}: {
  perm: PermState;
  inIframe: boolean;
  sw: boolean | null;
  sub: boolean | null;
}) {
  if (perm === "unsupported") return <p>Perangkat/browser ini tidak mendukung notifikasi web.</p>;
  if (inIframe && perm !== "granted")
    return <p>Preview di iframe — banner sistem tidak akan muncul. Buka di tab utama untuk mengaktifkan.</p>;
  if (perm === "denied") return <p>Izin diblokir. Notifikasi tidak akan muncul sampai diaktifkan ulang di pengaturan browser.</p>;
  if (perm === "default") return <p>Izin belum diminta. Klik "Minta izin notifikasi" di atas.</p>;
  if (!sw) return <p>Izin sudah granted, tapi service worker belum terdaftar.</p>;
  if (!sub) return <p>Izin granted & service worker aktif, tapi push subscription belum dibuat.</p>;
  return <p className="text-green-600 dark:text-green-400">Siap menerima notifikasi push.</p>;
}