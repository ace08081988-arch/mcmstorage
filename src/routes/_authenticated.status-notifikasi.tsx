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

type PushDetails = {
  endpoint: string | null;
  expirationTime: number | null;
  hasP256dh: boolean;
  hasAuth: boolean;
};

type SwDetails = {
  scope: string;
  scriptURL: string;
  state: "installing" | "waiting" | "active" | "redundant" | "none";
  controlled: boolean;
};

const LS_SW_KEY = "notif.lastSwSetup";
const LS_PUSH_KEY = "notif.lastPushSetup";

function readTs(k: string): number | null {
  try {
    const v = localStorage.getItem(k);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeTs(k: string, v: number) {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* ignore */
  }
}

function formatRelative(ts: number | null): string {
  if (!ts) return "Belum tercatat";
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} dtk lalu`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} mnt lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.floor(hr / 24);
  return `${day} hari lalu`;
}

type PermReason = {
  code:
    | "granted"
    | "denied_by_user"
    | "blocked_by_iframe"
    | "insecure_context"
    | "unsupported_api"
    | "not_prompted"
    | "unknown";
  detail: string;
};

function readPermission(): PermState {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return (Notification.permission as PermState) ?? "default";
}

type FrameInfo = {
  inIframe: boolean;
  sameOrigin: boolean;
  // Individual signals (evidence)
  selfNeTop: boolean;
  hasParent: boolean;
  ancestorCount: number | null; // window.location.ancestorOrigins length
  frameElementAccessible: boolean; // true = same-origin frame element reachable
  topAccessError: string | null;
  ancestorOrigin: string | null;
  referrer: string;
};

function detectFrame(): FrameInfo {
  if (typeof window === "undefined") {
    return {
      inIframe: false,
      sameOrigin: true,
      selfNeTop: false,
      hasParent: false,
      ancestorCount: null,
      frameElementAccessible: false,
      topAccessError: null,
      ancestorOrigin: null,
      referrer: "",
    };
  }
  const selfNeTop = window.self !== window.top;
  const hasParent = window.parent !== window;

  let sameOrigin = true;
  let topAccessError: string | null = null;
  try {
    void window.top?.location.href;
  } catch (e) {
    sameOrigin = false;
    topAccessError = e instanceof Error ? e.name : String(e);
  }

  let frameElementAccessible = false;
  try {
    frameElementAccessible = window.frameElement !== null;
  } catch {
    // SecurityError => cross-origin iframe (still an iframe)
    frameElementAccessible = false;
  }

  const ao = (window.location as unknown as { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  const ancestorCount = ao ? ao.length : null;
  const ancestorOrigin = ao && ao.length > 0 ? ao[0] : null;

  // Aggregate: any positive signal means we're framed.
  const inIframe =
    selfNeTop ||
    hasParent ||
    frameElementAccessible ||
    (ancestorCount !== null && ancestorCount > 0);

  return {
    inIframe,
    sameOrigin,
    selfNeTop,
    hasParent,
    ancestorCount,
    frameElementAccessible,
    topAccessError,
    ancestorOrigin,
    referrer: document.referrer || "",
  };
}

function explainPermission(
  perm: PermState,
  inIframe: boolean,
  secure: boolean,
): PermReason {
  if (perm === "unsupported")
    return {
      code: "unsupported_api",
      detail:
        "Browser/WebView ini tidak expose objek `Notification`. Umum di WebView lama atau mode privat tertentu.",
    };
  if (perm === "granted")
    return { code: "granted", detail: "Izin sudah diberikan pengguna untuk origin ini." };
  if (!secure)
    return {
      code: "insecure_context",
      detail:
        "Halaman tidak berjalan di secure context (HTTPS/localhost). Browser memblokir prompt izin.",
    };
  if (perm === "denied")
    return {
      code: "denied_by_user",
      detail:
        "Pengguna menolak izin sebelumnya, atau browser memblokir otomatis (mis. terlalu sering diminta). Reset lewat site settings.",
    };
  if (perm === "default" && inIframe)
    return {
      code: "blocked_by_iframe",
      detail:
        "Halaman berjalan di iframe. Chromium hanya mengizinkan prompt saat parent memberi `allow=\"notifications\"` — editor Lovable tidak mengizinkannya.",
    };
  if (perm === "default")
    return {
      code: "not_prompted",
      detail: "Belum pernah meminta izin di origin ini. Klik tombol untuk memicu prompt browser.",
    };
  return { code: "unknown", detail: "Status permission tidak dikenal." };
}

async function queryPermissionApi(): Promise<string | null> {
  try {
    if (typeof navigator === "undefined" || !("permissions" in navigator)) return null;
    const p = await navigator.permissions.query({ name: "notifications" as PermissionName });
    return p.state; // 'granted' | 'denied' | 'prompt'
  } catch {
    return null;
  }
}

function StatusNotifikasiPage() {
  const [perm, setPerm] = useState<PermState>(() => readPermission());
  const [frame, setFrame] = useState(() => detectFrame());
  const [swReady, setSwReady] = useState<boolean | null>(null);
  const [pushSub, setPushSub] = useState<boolean | null>(null);
  const [pushDetails, setPushDetails] = useState<PushDetails | null>(null);
  const [swDetails, setSwDetails] = useState<SwDetails | null>(null);
  const [lastSwSetup, setLastSwSetup] = useState<number | null>(null);
  const [lastPushSetup, setLastPushSetup] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [permApiState, setPermApiState] = useState<string | null>(null);
  const [secure, setSecure] = useState(true);
  const [copied, setCopied] = useState(false);

  const runChecks = async () => {
    setChecking(true);
    try {
      setPerm(readPermission());
      setFrame(detectFrame());
      setSecure(typeof window !== "undefined" ? window.isSecureContext !== false : true);
      setLastSwSetup(readTs(LS_SW_KEY));
      setLastPushSetup(readTs(LS_PUSH_KEY));
      void queryPermissionApi().then(setPermApiState);

      if (!("serviceWorker" in navigator)) {
        setSwReady(false);
        setPushSub(false);
        setSwDetails(null);
        setPushDetails(null);
        return;
      }
      const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
      const reg =
        (await navigator.serviceWorker.getRegistration().catch(() => null)) ??
        regs[0] ??
        null;
      const active = reg?.active ?? null;
      const worker = active ?? reg?.waiting ?? reg?.installing ?? null;
      const state: SwDetails["state"] = active
        ? "active"
        : reg?.waiting
          ? "waiting"
          : reg?.installing
            ? "installing"
            : reg
              ? "redundant"
              : "none";
      const isReady = !!reg && state === "active";
      setSwReady(isReady);
      setSwDetails(
        reg
          ? {
              scope: reg.scope,
              scriptURL: worker?.scriptURL ?? "",
              state,
              controlled: !!navigator.serviceWorker.controller,
            }
          : null,
      );
      if (isReady) {
        const now = Date.now();
        writeTs(LS_SW_KEY, now);
        setLastSwSetup(now);
      }

      if (reg && "pushManager" in reg) {
        const sub = await reg.pushManager.getSubscription().catch(() => null);
        setPushSub(!!sub);
        if (sub) {
          const json = sub.toJSON() as {
            endpoint?: string;
            expirationTime?: number | null;
            keys?: { p256dh?: string; auth?: string };
          };
          setPushDetails({
            endpoint: sub.endpoint ?? json.endpoint ?? null,
            expirationTime: json.expirationTime ?? sub.expirationTime ?? null,
            hasP256dh: !!json.keys?.p256dh,
            hasAuth: !!json.keys?.auth,
          });
          const now = Date.now();
          writeTs(LS_PUSH_KEY, now);
          setLastPushSetup(now);
        } else {
          setPushDetails(null);
        }
      } else {
        setPushSub(false);
        setPushDetails(null);
      }
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPerm = async () => {
    if (!("Notification" in window)) return;
    const res = await Notification.requestPermission();
    setPerm(res as PermState);
    void queryPermissionApi().then(setPermApiState);
    void runChecks();
  };

  const permVariant: Record<PermState, "default" | "secondary" | "destructive" | "outline"> = {
    granted: "default",
    denied: "destructive",
    default: "secondary",
    unsupported: "outline",
  };

  const canPrompt = perm === "default" && !frame.inIframe;
  const reason = explainPermission(perm, frame.inIframe, secure);

  const maskEndpoint = (ep: string) => {
    if (ep.length <= 32) return ep;
    return `${ep.slice(0, 24)}…${ep.slice(-12)}`;
  };

  const copyEndpoint = async () => {
    if (!pushDetails?.endpoint) return;
    try {
      await navigator.clipboard.writeText(pushDetails.endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

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
          <Row
            label="Permissions API"
            value={permApiState ? <code className="text-xs">{permApiState}</code> : <span className="text-xs text-muted-foreground">tidak tersedia</span>}
          />
          <Row label="Secure context" value={secure ? "Ya (HTTPS/localhost)" : "Tidak"} />
          <Row label="Service worker" value={swReady === null ? "…" : swReady ? "Terdaftar" : "Belum terdaftar"} />
          <Row label="Push subscription" value={pushSub === null ? "…" : pushSub ? "Aktif" : "Tidak ada"} />
          {canPrompt && (
            <Button size="sm" onClick={requestPerm}>Minta izin notifikasi</Button>
          )}
          <div className="rounded-md border bg-muted/40 p-2 text-xs space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">Alasan:</span>
              <code className="text-[11px]">{reason.code}</code>
            </div>
            <p className="text-muted-foreground leading-snug">{reason.detail}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Kesiapan service worker & push</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => void runChecks()}
              disabled={checking}
            >
              {checking ? "Memeriksa…" : "Periksa ulang"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row
            label="Service worker"
            value={
              <Badge variant={swReady ? "default" : "secondary"}>
                {swDetails ? swDetails.state : swReady === null ? "…" : "none"}
              </Badge>
            }
          />
          {swDetails && (
            <>
              <Row
                label="Scope"
                value={<code className="text-[11px] break-all">{swDetails.scope}</code>}
              />
              <Row
                label="Script"
                value={
                  <code className="text-[11px] break-all">
                    {swDetails.scriptURL
                      ? new URL(swDetails.scriptURL, location.origin).pathname
                      : "-"}
                  </code>
                }
              />
              <Row
                label="Page controlled"
                value={swDetails.controlled ? "Ya" : "Belum (butuh reload)"}
              />
            </>
          )}
          <Row
            label="Push subscription"
            value={
              <Badge variant={pushSub ? "default" : "secondary"}>
                {pushSub === null ? "…" : pushSub ? "aktif" : "tidak ada"}
              </Badge>
            }
          />
          <div className="rounded-md border bg-muted/40 p-2 text-xs space-y-1">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">SW terakhir aktif</span>
              <span title={lastSwSetup ? new Date(lastSwSetup).toLocaleString() : ""}>
                {formatRelative(lastSwSetup)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Push terakhir ter-subscribe</span>
              <span title={lastPushSetup ? new Date(lastPushSetup).toLocaleString() : ""}>
                {formatRelative(lastPushSetup)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detail push subscription</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!pushSub || !pushDetails ? (
            <p className="text-xs text-muted-foreground">
              Belum ada push subscription aktif di perangkat/browser ini.
            </p>
          ) : (
            <>
              <Row
                label="Provider"
                value={
                  <span className="text-xs">
                    {pushDetails.endpoint
                      ? new URL(pushDetails.endpoint).host
                      : "-"}
                  </span>
                }
              />
              <div className="space-y-1">
                <div className="text-muted-foreground">Endpoint</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-[11px]">
                    {maskEndpoint(pushDetails.endpoint ?? "")}
                  </code>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={copyEndpoint}>
                    {copied ? "Tersalin" : "Salin"}
                  </Button>
                </div>
              </div>
              <Row
                label="Expiration"
                value={
                  pushDetails.expirationTime
                    ? new Date(pushDetails.expirationTime).toLocaleString()
                    : "Tidak diatur"
                }
              />
              <Row
                label="Kunci enkripsi"
                value={
                  <span className="text-xs">
                    p256dh: {pushDetails.hasP256dh ? "ok" : "—"} · auth:{" "}
                    {pushDetails.hasAuth ? "ok" : "—"}
                  </span>
                }
              />
            </>
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