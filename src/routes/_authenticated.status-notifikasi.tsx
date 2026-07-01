import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { sendTestNotification } from "@/lib/push-client";

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
  hasWaiting: boolean;
  hasInstalling: boolean;
  version: string | null;
  scriptEtag: string | null;
  scriptLastModified: string | null;
};

const LS_SW_KEY = "notif.lastSwSetup";
const LS_PUSH_KEY = "notif.lastPushSetup";
const LS_SW_UPDATE_KEY = "notif.lastSwUpdateCheck";

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

async function fetchScriptMeta(scriptURL: string): Promise<{ etag: string | null; lastModified: string | null }> {
  try {
    const res = await fetch(scriptURL, { cache: "no-store", method: "GET" });
    return {
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
    };
  } catch {
    return { etag: null, lastModified: null };
  }
}

async function askWorkerVersion(worker: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), 800);
      ch.port1.onmessage = (e) => {
        clearTimeout(t);
        const v = e.data?.version ?? e.data?.v ?? null;
        resolve(typeof v === "string" ? v : null);
      };
      worker.postMessage({ type: "GET_VERSION" }, [ch.port2]);
    } catch {
      resolve(null);
    }
  });
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
  const [updateState, setUpdateState] = useState<
    "idle" | "checking" | "no-update" | "waiting" | "activated" | "error"
  >("idle");
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [lastUpdateCheck, setLastUpdateCheck] = useState<number | null>(null);

  const runChecks = async () => {
    setChecking(true);
    try {
      setPerm(readPermission());
      setFrame(detectFrame());
      setSecure(typeof window !== "undefined" ? window.isSecureContext !== false : true);
      setLastSwSetup(readTs(LS_SW_KEY));
      setLastPushSetup(readTs(LS_PUSH_KEY));
      setLastUpdateCheck(readTs(LS_SW_UPDATE_KEY));
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
      if (reg) {
        const scriptURL = worker?.scriptURL ?? "";
        const [meta, version] = await Promise.all([
          scriptURL ? fetchScriptMeta(scriptURL) : Promise.resolve({ etag: null, lastModified: null }),
          worker ? askWorkerVersion(worker) : Promise.resolve(null),
        ]);
        setSwDetails({
          scope: reg.scope,
          scriptURL,
          state,
          controlled: !!navigator.serviceWorker.controller,
          hasWaiting: !!reg.waiting,
          hasInstalling: !!reg.installing,
          version,
          scriptEtag: meta.etag,
          scriptLastModified: meta.lastModified,
        });
        if (reg.waiting) setUpdateState("waiting");
      } else {
        setSwDetails(null);
      }
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

  const requestSwUpdate = async () => {
    setUpdateState("checking");
    setUpdateMsg(null);
    try {
      if (!("serviceWorker" in navigator)) {
        setUpdateState("error");
        setUpdateMsg("Service worker tidak didukung browser ini.");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setUpdateState("error");
        setUpdateMsg("Belum ada registrasi service worker untuk origin ini.");
        return;
      }
      let updateFound = false;
      const onUpdate = () => {
        updateFound = true;
      };
      reg.addEventListener("updatefound", onUpdate);
      await reg.update();
      // Beri browser waktu memproses 'updatefound' + install.
      await new Promise((r) => setTimeout(r, 400));
      reg.removeEventListener("updatefound", onUpdate);
      const now = Date.now();
      writeTs(LS_SW_UPDATE_KEY, now);
      setLastUpdateCheck(now);
      if (reg.waiting) {
        setUpdateState("waiting");
        setUpdateMsg("Versi baru sudah ter-install dan menunggu diaktifkan.");
      } else if (reg.installing || updateFound) {
        setUpdateState("checking");
        setUpdateMsg("Sedang meng-install versi baru…");
      } else {
        setUpdateState("no-update");
        setUpdateMsg("Sudah menggunakan versi terbaru.");
      }
      void runChecks();
    } catch (e) {
      setUpdateState("error");
      setUpdateMsg(e instanceof Error ? e.message : "Gagal memeriksa pembaruan.");
    }
  };

  const activateWaiting = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const waiting = reg?.waiting;
      if (!waiting) {
        setUpdateMsg("Tidak ada worker yang menunggu.");
        return;
      }
      waiting.postMessage({ type: "SKIP_WAITING" });
      setUpdateState("activated");
      setUpdateMsg("Mengaktifkan versi baru — memuat ulang halaman…");
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      setUpdateState("error");
      setUpdateMsg(e instanceof Error ? e.message : "Gagal mengaktifkan versi baru.");
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

  const [exportCopied, setExportCopied] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewJson, setPreviewJson] = useState("");

  const openPreview = () => {
    try {
      setPreviewJson(serializeSnapshot());
      setExportError(null);
      setPreviewOpen(true);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Gagal membuat JSON.");
    }
  };

  const buildSnapshot = () => ({
    generatedAt: new Date().toISOString(),
    origin: typeof window !== "undefined" ? window.location.origin : null,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    permission: {
      state: perm,
      permissionsApi: permApiState,
      secureContext: secure,
      canPrompt,
      reason,
    },
    frame,
    serviceWorker: swDetails
      ? {
          registered: true,
          ready: swReady,
          ...swDetails,
          lastActiveAt: lastSwSetup ? new Date(lastSwSetup).toISOString() : null,
          lastUpdateCheckAt: lastUpdateCheck ? new Date(lastUpdateCheck).toISOString() : null,
          updateState,
        }
      : { registered: false, ready: swReady },
    pushSubscription: pushDetails
      ? {
          active: !!pushSub,
          ...pushDetails,
          lastSubscribedAt: lastPushSetup ? new Date(lastPushSetup).toISOString() : null,
        }
      : { active: !!pushSub },
  });

  // Safe replacer: handles BigInt, functions, and cyclic refs so JSON.stringify never throws.
  const makeSafeReplacer = () => {
    const seen = new WeakSet<object>();
    return (_key: string, value: unknown) => {
      if (typeof value === "bigint") return `${value.toString()}n`;
      if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
      if (typeof value === "undefined") return null;
      if (value && typeof value === "object") {
        if (seen.has(value as object)) return "[Circular]";
        seen.add(value as object);
      }
      return value;
    };
  };

  const serializeSnapshot = () => {
    // 2-space indent + trailing newline for POSIX-friendly files.
    return JSON.stringify(buildSnapshot(), makeSafeReplacer(), 2) + "\n";
  };

  const downloadSnapshot = () => {
    try {
      const json = serializeSnapshot();
      // Explicit UTF-8 charset so editors don't guess encoding; no BOM (breaks strict JSON parsers).
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const ts =
        `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
        `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
      a.href = url;
      a.download = `notifikasi-status-${ts}.json`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportError(null);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Gagal membuat file JSON.");
    }
  };

  const copySnapshot = async () => {
    let json = "";
    try {
      json = serializeSnapshot();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Gagal membuat JSON.");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
      } else {
        // Fallback for non-secure context / WebViews without Clipboard API.
        const ta = document.createElement("textarea");
        ta.value = json;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (!ok) throw new Error("execCommand copy gagal");
      }
      setExportCopied(true);
      setExportError(null);
      setTimeout(() => setExportCopied(false), 1500);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Clipboard tidak tersedia.");
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

          <div className="rounded-md border p-2 text-xs space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Versi & pembaruan</span>
              <Badge
                variant={
                  updateState === "waiting"
                    ? "secondary"
                    : updateState === "error"
                      ? "destructive"
                      : updateState === "no-update" || updateState === "activated"
                        ? "default"
                        : "outline"
                }
              >
                {updateState === "idle" && "belum diperiksa"}
                {updateState === "checking" && "memeriksa…"}
                {updateState === "no-update" && "terbaru"}
                {updateState === "waiting" && "versi baru menunggu"}
                {updateState === "activated" && "mengaktifkan…"}
                {updateState === "error" && "gagal"}
              </Badge>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Versi worker</span>
              <code className="text-[11px] break-all">
                {swDetails?.version ?? "—"}
              </code>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Script ETag</span>
              <code className="text-[11px] break-all">
                {swDetails?.scriptEtag ?? "—"}
              </code>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Last-Modified</span>
              <span className="text-[11px]">{swDetails?.scriptLastModified ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Cek pembaruan terakhir</span>
              <span title={lastUpdateCheck ? new Date(lastUpdateCheck).toLocaleString() : ""}>
                {formatRelative(lastUpdateCheck)}
              </span>
            </div>
            {updateMsg && (
              <p className="text-[11px] text-muted-foreground leading-snug">{updateMsg}</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={requestSwUpdate}
                disabled={updateState === "checking" || !swDetails}
              >
                {updateState === "checking" ? "Memeriksa…" : "Perbarui pendaftaran"}
              </Button>
              {swDetails?.hasWaiting && (
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={activateWaiting}
                  disabled={updateState === "activated"}
                >
                  Aktifkan versi baru
                </Button>
              )}
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
          <div className="rounded-md border bg-muted/40 p-2 text-xs space-y-1 font-mono">
            <div className="font-sans text-muted-foreground mb-1">Bukti mentah</div>
            <Evidence k="window.self !== window.top" v={String(frame.selfNeTop)} />
            <Evidence k="window.parent !== window" v={String(frame.hasParent)} />
            <Evidence
              k="location.ancestorOrigins.length"
              v={frame.ancestorCount === null ? "n/a" : String(frame.ancestorCount)}
            />
            <Evidence
              k="ancestorOrigins[0]"
              v={frame.ancestorOrigin ?? "—"}
            />
            <Evidence k="window.frameElement" v={frame.frameElementAccessible ? "<element>" : "null / SecurityError"} />
            <Evidence
              k="top.location access"
              v={frame.topAccessError ? `throws ${frame.topAccessError}` : "ok (same-origin)"}
            />
            <Evidence k="document.referrer" v={frame.referrer || "(kosong)"} />
          </div>
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

      <TestNotificationCard perm={perm} sub={pushSub} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ekspor snapshot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground leading-snug">
            Ringkasan permission, service worker, dan detail push subscription (endpoint dimasker) dalam format JSON.
          </p>
          <ExportReadinessNotice
            perm={perm}
            swReady={swReady}
            pushSub={pushSub}
            checking={checking}
            canPrompt={canPrompt}
            onRetry={() => void runChecks()}
            onRequestPerm={requestPerm}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={openPreview}>Pratinjau</Button>
            <Button size="sm" onClick={downloadSnapshot}>Unduh JSON</Button>
            <Button size="sm" variant="outline" onClick={copySnapshot}>
              {exportCopied ? "Tersalin" : "Salin JSON"}
            </Button>
          </div>
          {exportError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {exportError}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pratinjau snapshot JSON</DialogTitle>
            <DialogDescription>
              Periksa isi sebelum diunduh atau disalin. {previewJson.length.toLocaleString("id-ID")} karakter.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[55vh] overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-snug font-mono whitespace-pre-wrap break-all">
            {previewJson}
          </pre>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button size="sm" variant="outline" onClick={() => setPreviewOpen(false)}>
              Tutup
            </Button>
            <Button size="sm" variant="outline" onClick={copySnapshot}>
              {exportCopied ? "Tersalin" : "Salin JSON"}
            </Button>
            <Button size="sm" onClick={downloadSnapshot}>Unduh JSON</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function Evidence({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right break-all">{v}</span>
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
  if (perm === "default") return <p>Izin belum diminta. Tekan tombol "Minta izin notifikasi" untuk mengaktifkan.</p>;
  if (!sw) return <p>Izin sudah diberikan, tetapi service worker belum terdaftar.</p>;
  if (!sub) return <p>Izin sudah diberikan dan service worker aktif, tetapi push subscription belum dibuat.</p>;
  return <p className="font-medium text-primary">Siap menerima notifikasi push.</p>;
}

function ExportReadinessNotice({
  perm,
  swReady,
  pushSub,
  checking,
  canPrompt,
  onRetry,
  onRequestPerm,
}: {
  perm: PermState;
  swReady: boolean | null;
  pushSub: boolean | null;
  checking: boolean;
  canPrompt: boolean;
  onRetry: () => void;
  onRequestPerm: () => void;
}) {
  const issues: string[] = [];
  if (perm === "unsupported") issues.push("Browser tidak mendukung Notification API.");
  else if (perm === "denied") issues.push("Izin notifikasi diblokir — aktifkan ulang di pengaturan browser.");
  else if (perm === "default") issues.push("Izin notifikasi belum diminta.");
  if (swReady === false) issues.push("Service worker belum terdaftar.");
  if (pushSub === false) issues.push("Push subscription belum aktif.");
  if (!issues.length) return null;

  return (
    <div className="rounded-md border border-border bg-muted/50 p-3 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">Data belum lengkap</span>
        <Badge variant="secondary" className="text-[10px]">
          {issues.length} item
        </Badge>
      </div>
      <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground leading-snug">
        {issues.map((i) => <li key={i}>{i}</li>)}
      </ul>
      <p className="text-muted-foreground leading-snug">
        Snapshot tetap dapat diekspor; bagian yang tidak tersedia akan tercatat sebagai kosong.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={onRetry} disabled={checking}>
          {checking ? "Memeriksa…" : "Coba lagi"}
        </Button>
        {canPrompt && (
          <Button size="sm" onClick={onRequestPerm}>
            Minta izin notifikasi
          </Button>
        )}
      </div>
    </div>
  );
}

type TestResult = {
  ok: boolean;
  sent: number;
  message: string;
  at: number;
};

function TestNotificationCard({
  perm,
  sub,
}: {
  perm: PermState;
  sub: boolean | null;
}) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const disabled = sending || perm !== "granted" || !sub;

  const send = async () => {
    setSending(true);
    try {
      const r = await sendTestNotification();
      setResult({
        ok: r.sent > 0,
        sent: r.sent,
        message: r.message,
        at: Date.now(),
      });
    } catch (e) {
      setResult({
        ok: false,
        sent: 0,
        message: e instanceof Error ? e.message : "Gagal mengirim notifikasi uji.",
        at: Date.now(),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Kirim notifikasi uji</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Kirim satu banner uji ke semua perangkat yang telah berlangganan push
          milik akun ini. Butuh izin <b>granted</b> dan push subscription aktif.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={send} disabled={disabled}>
            {sending ? "Mengirim…" : "Kirim notifikasi uji"}
          </Button>
          {disabled && !sending && (
            <span className="text-xs text-muted-foreground">
              {perm !== "granted"
                ? "Aktifkan izin notifikasi dulu."
                : "Aktifkan push subscription dulu."}
            </span>
          )}
        </div>
        {result && (
          <div
            className={
              "rounded-md border p-3 text-xs " +
              (result.ok
                ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"
                : "border-destructive/40 bg-destructive/10 text-destructive")
            }
          >
            <div className="font-medium">
              {result.ok ? "Berhasil" : "Gagal"} · {new Date(result.at).toLocaleTimeString("id-ID")}
            </div>
            <div className="mt-1">{result.message}</div>
            <div className="mt-1 text-muted-foreground">
              Perangkat terkirim: <b>{result.sent}</b>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}