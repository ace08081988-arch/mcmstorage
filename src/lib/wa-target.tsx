import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { buildWhatsAppUrl, buildWhatsAppBusinessIntentUrl } from "./share-wa";
import { copyText } from "./share-wa";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { AppLauncher } from "@capacitor/app-launcher";
import {
  MessageCircle,
  Briefcase,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  ShieldCheck,
  Download,
  RefreshCw,
} from "lucide-react";

export type WaInstallStatus = {
  business: boolean | null;
  regular: boolean | null;
  native: boolean;
};

let _installCache: WaInstallStatus | null = null;

export async function detectWhatsAppInstalled(force = false): Promise<WaInstallStatus> {
  if (_installCache && !force) return _installCache;
  const native = typeof Capacitor !== "undefined" && Capacitor.isNativePlatform?.() === true;
  if (!native) {
    _installCache = { business: null, regular: null, native: false };
    return _installCache;
  }
  const check = async (url: string) => {
    try {
      const res = await AppLauncher.canOpenUrl({ url });
      return !!res.value;
    } catch {
      return false;
    }
  };
  const [business, regular] = await Promise.all([
    check("com.whatsapp.w4b://"),
    check("com.whatsapp://"),
  ]);
  _installCache = { business, regular, native: true };
  return _installCache;
}

export type WaTarget = "business" | "regular";
export type WaTargetPref = "ask" | WaTarget;

const PREF_KEY = "wa-target-pref";
const SKIP_CONFIRM_KEY = "wa-skip-confirm";

export function getWaTargetPref(): WaTargetPref {
  if (typeof window === "undefined") return "ask";
  try {
    const v = window.localStorage.getItem(PREF_KEY);
    if (v === "business" || v === "regular" || v === "ask") return v;
  } catch { /* ignore */ }
  return "ask";
}

export function setWaTargetPref(v: WaTargetPref) {
  try { window.localStorage.setItem(PREF_KEY, v); } catch { /* ignore */ }
}

export function getWaSkipConfirm(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(SKIP_CONFIRM_KEY) === "1"; } catch { return false; }
}

export function setWaSkipConfirm(v: boolean) {
  try {
    if (v) window.localStorage.setItem(SKIP_CONFIRM_KEY, "1");
    else window.localStorage.removeItem(SKIP_CONFIRM_KEY);
  } catch { /* ignore */ }
}

type Request = {
  text?: string;
  phone?: string;
  resolve: (v: WaTarget | null) => void;
};

let openRequest: ((req: Request) => void) | null = null;
const queue: Request[] = [];

/**
 * Tanyakan target WhatsApp (Business / biasa). Mengembalikan pilihan, atau
 * null jika user membatalkan. Jika preferensi sudah disimpan (bukan "ask"),
 * langsung mengembalikan preferensi tanpa membuka dialog.
 */
export function pickWhatsAppTarget(ctx?: { text?: string; phone?: string }): Promise<WaTarget | null> {
  const pref = getWaTargetPref();
  if (pref !== "ask" && getWaSkipConfirm()) {
    return detectWhatsAppInstalled().then((s) => {
      const missing =
        s.native &&
        ((pref === "business" && s.business === false) ||
         (pref === "regular" && s.regular === false));
      if (!missing) return pref;
      // Fall through to dialog so user sees the help message.
      return new Promise<WaTarget | null>((resolve) => {
        const req: Request = { resolve, text: ctx?.text, phone: ctx?.phone };
        if (openRequest) openRequest(req);
        else queue.push(req);
      });
    });
  }
  return new Promise((resolve) => {
    const req: Request = { resolve, text: ctx?.text, phone: ctx?.phone };
    if (openRequest) openRequest(req);
    else queue.push(req);
  });
}

export function WhatsAppTargetHost() {
  const [current, setCurrent] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const [confirming, setConfirming] = useState<WaTarget | null>(null);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [install, setInstall] = useState<WaInstallStatus>({ business: null, regular: null, native: false });

  useEffect(() => {
    openRequest = (req) => {
      setRemember(false);
      setConfirming(null);
      setSkipConfirm(false);
      setCurrent(req);
      setOpen(true);
      detectWhatsAppInstalled(true).then(setInstall);
    };
    while (queue.length) {
      const req = queue.shift()!;
      setRemember(false);
      setConfirming(null);
      setSkipConfirm(false);
      setCurrent(req);
      setOpen(true);
      detectWhatsAppInstalled(true).then(setInstall);
    }
    detectWhatsAppInstalled().then(setInstall);
    return () => { openRequest = null; };
  }, []);

  const finish = (v: WaTarget | null) => {
    setOpen(false);
    if (v && remember) setWaTargetPref(v);
    if (v && skipConfirm) setWaSkipConfirm(true);
    current?.resolve(v);
    setTimeout(() => {
      setCurrent(null);
      setConfirming(null);
    }, 150);
  };

  const text = current?.text ?? "";
  const phone = current?.phone;
  const businessUrl = buildWhatsAppBusinessIntentUrl(text, phone);
  const regularUrl = buildWhatsAppUrl(text, phone);
  const confirmUrl = confirming === "business" ? businessUrl : confirming === "regular" ? regularUrl : "";
  const confirmLabel = confirming === "business" ? "WhatsApp Business" : "WhatsApp biasa";
  const businessMissing = install.native && install.business === false;
  const regularMissing = install.native && install.regular === false;
  const bothMissing = businessMissing && regularMissing;
  const confirmMissing =
    (confirming === "business" && businessMissing) ||
    (confirming === "regular" && regularMissing);

  const PLAY_BUSINESS = "https://play.google.com/store/apps/details?id=com.whatsapp.w4b";
  const PLAY_REGULAR = "https://play.google.com/store/apps/details?id=com.whatsapp";

  const InstallHelp = ({ kind }: { kind: WaTarget }) => {
    const isBiz = kind === "business";
    const label = isBiz ? "WhatsApp Business" : "WhatsApp";
    const pkg = isBiz ? "com.whatsapp.w4b" : "com.whatsapp";
    const url = isBiz ? PLAY_BUSINESS : PLAY_REGULAR;
    return (
      <div className="rounded-lg border border-amber-300/60 bg-amber-50/80 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-3.5 w-3.5" />
          Cara memasang {label}
        </div>
        <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed">
          <li>Buka Google Play Store di HP Anda.</li>
          <li>Cari <span className="font-mono">{pkg}</span> atau gunakan tombol di bawah.</li>
          <li>Tekan <span className="font-semibold">Install</span> dan tunggu selesai.</li>
          <li>Buka aplikasi dan selesaikan verifikasi nomor.</li>
          <li>Kembali ke sini dan tekan <span className="font-semibold">Verifikasi ulang</span>.</li>
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            asChild
            size="sm"
            className="h-8 bg-amber-600 text-white hover:bg-amber-700"
          >
            <a href={url} target="_blank" rel="noopener noreferrer">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Play Store
            </a>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => detectWhatsAppInstalled(true).then(setInstall)}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Verifikasi ulang
          </Button>
        </div>
      </div>
    );
  };

  const copy = async (url: string) => {
    const res = await copyText(url);
    if (res.ok) toast.success("URL disalin");
    else toast.error("Gagal menyalin URL");
  };

  const truncateMid = (s: string, head = 56, tail = 24) =>
    s.length > head + tail + 3 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;

  type OptionProps = {
    kind: WaTarget;
    url: string;
    missing: boolean;
  };
  const Option = ({ kind, url, missing }: OptionProps) => {
    const isBiz = kind === "business";
    const label = isBiz ? "WhatsApp Business" : "WhatsApp";
    const sublabel = isBiz ? "Untuk akun bisnis (com.whatsapp.w4b)" : "Aplikasi WhatsApp standar (com.whatsapp)";
    const Icon = isBiz ? Briefcase : MessageCircle;
    const [showUrl, setShowUrl] = useState(false);
    const status = install.native
      ? missing
        ? { tone: "danger", label: "Belum terpasang", Icon: XCircle }
        : install[isBiz ? "business" : "regular"] === true
          ? { tone: "ok", label: "Terpasang", Icon: CheckCircle2 }
          : { tone: "muted", label: "Memeriksa…", Icon: RefreshCw }
      : { tone: "muted", label: "Tidak terdeteksi (browser)", Icon: ShieldCheck };
    const toneCls =
      status.tone === "ok"
        ? "text-emerald-600 dark:text-emerald-400"
        : status.tone === "danger"
          ? "text-destructive"
          : "text-muted-foreground";

    return (
      <div
        className={`group relative overflow-hidden rounded-xl border bg-card transition-colors ${
          missing ? "opacity-80" : "hover:border-primary/50"
        }`}
      >
        <button
          type="button"
          onClick={() => !missing && setConfirming(kind)}
          disabled={missing}
          className="flex w-full items-center gap-3 p-3 text-left disabled:cursor-not-allowed"
        >
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
              isBiz
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
            }`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{label}</span>
              {!isBiz && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">biasa</span>}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">{sublabel}</div>
            <div className={`mt-1 inline-flex items-center gap-1 text-[11px] font-medium ${toneCls}`}>
              <status.Icon className="h-3 w-3" />
              {status.label}
            </div>
          </div>
        </button>
        <div className="border-t bg-muted/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowUrl((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {showUrl ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Pratinjau URL
            </button>
            <div className="flex items-center gap-1">
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => copy(url)}>
                <Copy className="mr-1 h-3 w-3" /> Salin
              </Button>
              <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-[11px]">
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1 h-3 w-3" /> Buka
                </a>
              </Button>
            </div>
          </div>
          {showUrl ? (
            <code className="mt-2 block max-h-28 overflow-auto break-all rounded-md bg-background/80 p-2 font-mono text-[10.5px] leading-snug text-muted-foreground">
              {url}
            </code>
          ) : (
            <code className="mt-1 block truncate font-mono text-[10.5px] text-muted-foreground/70">
              {truncateMid(url)}
            </code>
          )}
        </div>
        {missing && (
          <div className="border-t bg-amber-50/60 p-3 dark:bg-amber-950/20">
            <InstallHelp kind={kind} />
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish(null)}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-md">
        {confirming ? (
          <div className="flex flex-col">
            <DialogHeader className="border-b bg-muted/30 px-5 pb-4 pt-5">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    confirming === "business"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                  }`}
                >
                  {confirming === "business" ? <Briefcase className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <DialogTitle className="text-base">Konfirmasi: buka {confirmLabel}</DialogTitle>
                  <DialogDescription className="mt-0.5 text-xs">
                    Tinjau pratinjau URL sebelum aplikasi dibuka.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-3 px-5 py-4">
              {confirmMissing && (
                <>
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {confirmLabel} belum terpasang di perangkat ini. Pasang dari Play Store atau pilih opsi lain.
                    </span>
                  </div>
                  <InstallHelp kind={confirming} />
                </>
              )}
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    URL yang akan dibuka
                  </div>
                  <div className="flex items-center gap-1">
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => copy(confirmUrl)}>
                      <Copy className="mr-1 h-3 w-3" /> Salin
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-[11px]">
                      <a href={confirmUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3 w-3" /> Buka
                      </a>
                    </Button>
                  </div>
                </div>
                <code className="block max-h-32 overflow-auto break-all rounded-md bg-background p-2 font-mono text-[10.5px] leading-snug text-muted-foreground">
                  {confirmUrl}
                </code>
              </div>
              <div className="space-y-2 rounded-lg border p-3">
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={remember} onCheckedChange={(c) => setRemember(c === true)} className="mt-0.5" />
                  <span>Ingat pilihan aplikasi saya untuk berikutnya</span>
                </label>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={skipConfirm} onCheckedChange={(c) => setSkipConfirm(c === true)} className="mt-0.5" />
                  <span>Lewati layar konfirmasi pratinjau ini lain kali</span>
                </label>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-5 py-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                Kembali
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => finish(null)}>
                  Batal
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={confirmMissing}
                  onClick={() => finish(confirming)}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  Buka {confirmLabel}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <DialogHeader className="border-b bg-muted/30 px-5 pb-4 pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <DialogTitle className="text-base">Pilih aplikasi WhatsApp</DialogTitle>
                  <DialogDescription className="mt-0.5 text-xs">
                    Tentukan aplikasi yang akan digunakan untuk mengirim pesan ini.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-3 px-5 py-4">
              {bothMissing && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Tidak ada aplikasi WhatsApp yang terdeteksi. Pasang WhatsApp atau WhatsApp Business dari Play Store terlebih dahulu.
                  </span>
                </div>
              )}
              {!install.native && (
                <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-[11px] text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Di browser, ketersediaan aplikasi tidak bisa dideteksi otomatis. Pastikan WhatsApp atau WhatsApp Business sudah terpasang.
                  </span>
                </div>
              )}
              <Option kind="business" url={businessUrl} missing={businessMissing} />
              <Option kind="regular" url={regularUrl} missing={regularMissing} />
              <label className="flex items-center gap-2 px-1 pt-1 text-xs text-muted-foreground">
                <Checkbox checked={remember} onCheckedChange={(c) => setRemember(c === true)} />
                <span>Ingat pilihan saya (bisa diubah lagi nanti)</span>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-5 py-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => finish(null)}>
                Batal
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}