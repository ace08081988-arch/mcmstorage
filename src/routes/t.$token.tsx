import { createFileRoute } from "@tanstack/react-router";
import React, {
  Component,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ErrorInfo,
  type ReactNode,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { PhotoEditorV2 as PhotoEditor } from "@/components/photo-editor/PhotoEditorV2";
import {
  signedUrl,
  uploadPrepPhoto,
  type PrepItemRow,
  type PrepSubmissionRow,
  type PrepTaskRow,
} from "@/lib/prep";
import { uploadRequestPhotoViaToken } from "@/lib/request";
import { publicSupabase } from "@/lib/public-supabase";
import {
  subscribeDeferredReload,
  recheckBuildVersion,
  type DeferredReloadState,
} from "@/lib/build-cache-buster";
import {
  stageFile,
  buildStagedPhoto,
  formatFileSize,
  type StagedPhoto as StagedPhotoT,
} from "@/lib/prep-file-staging";
import { mergeStagedPhotos } from "@/lib/prep-photo-merge";
import {
  saveDraftPhotos,
  loadDraftPhotos,
  clearDraftPhotos,
  itemDraftKey,
  requestDraftKey,
} from "@/lib/prep-draft-store";
import {
  queryCameraPermission,
  permissionToastMessage,
  type MediaKind,
} from "@/lib/media-permission";
import { PermissionHelpDialog } from "@/components/prep/PermissionHelpDialog";
import { HelpCircle } from "lucide-react";
import {
  MapPin,
  Camera,
  ClipboardPaste,
  Image as ImageIcon,
  Edit3,
  Send,
  Loader2,
  Lock,
  ShieldCheck,
  Clock,
  CheckCircle2,
  Package,
  MessageCircle,
  ArrowLeft,
  AlertTriangle,
  RefreshCw,
  Wifi,
  WifiOff,
  Inbox,
  AlertCircle,
  X as XIcon,
  Trash2,
  ChevronDown,
  Layers,
  Info,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { displayUnit } from "@/lib/unit-label";
import { formatQty } from "@/lib/unit-kinds";
import { cn } from "@/lib/utils";


/**
 * Label satuan ringkas untuk tampilan worker portal mobile.
 * Aturan sweep Batch 2:
 *  - GS → "botol" (SSOT displayUnit)
 *  - gram/gr/g/grams → "g" (konsisten satu label pendek di seluruh flow)
 *  - lainnya → apa adanya (pcs, botol, kg, ons…)
 */
function shortUnitLabel(
  name: string | null | undefined,
  unit: string | null | undefined,
): string {
  const base = displayUnit(name, unit);
  const u = (base ?? "").trim().toLowerCase();
  if (u === "g" || u === "gr" || u === "gram" || u === "grams") return "g";
  return base ?? "";
}
function formatQtyShort(
  qty: number | string,
  unit: string | null | undefined,
  name?: string | null,
): string {
  return formatQty(qty, unit, name ?? undefined).replace(/\bgr\b/gi, "g");
}
import {
  getWorkerPortalConfig,
  fetchAndApplyWorkerPortalConfig,
  applyPreviewOverrideFromHash,
} from "@/lib/worker-portal-config";
import { StatusBadge } from "@/components/StatusBadge";
import { reportPortalError } from "@/lib/portal-error-report";
import { reportLovableError } from "@/lib/lovable-error-reporting";

export const Route = createFileRoute("/t/$token")({
  head: () => ({
    meta: [
      { title: "Tugas Siapkan Barang · MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicPrepPageWithBoundary,
});

type StagedPhoto = StagedPhotoT;

type VariantGroup = {
  key: string;
  label: string;
  category: string | null;
  entries: Array<{ it: PrepItemRow; idx: number }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberOrFallback(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSubmissions(value: unknown): PrepSubmissionRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((s, idx) => ({
    id: stringOrFallback(s.id, `submission-${idx}`),
    photo_path: stringOrNull(s.photo_path),
    location_url: stringOrNull(s.location_url),
    note: stringOrNull(s.note),
    submitted_at: stringOrFallback(s.submitted_at, new Date(0).toISOString()),
  }));
}

function normalizePrepItems(value: unknown): PrepItemRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((i, idx) => ({
    id: stringOrFallback(i.id, `item-${idx}`),
    name: stringOrFallback(i.name, "Item tanpa nama"),
    category: stringOrNull(i.category),
    qty_requested: numberOrFallback(i.qty_requested),
    qty_prepared: numberOrFallback(i.qty_prepared),
    unit_label: stringOrNull(i.unit_label),
    ref_photo_path: stringOrNull(i.ref_photo_path),
    note: stringOrNull(i.note),
    updated_at: stringOrNull(i.updated_at),
    submissions: normalizeSubmissions(i.submissions),
  }));
}

function normalizePrepTask(value: unknown): PrepTaskRow | null {
  if (!isRecord(value)) return null;
  const id = stringOrNull(value.id);
  if (!id) return null;
  return {
    id,
    title: stringOrFallback(value.title, "Tugas siapkan barang"),
    note: stringOrNull(value.note),
    status: stringOrFallback(value.status, "active"),
    expires_at: stringOrFallback(
      value.expires_at,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    ),
  };
}

type NativeCameraStatus = "fallback" | "cancelled" | "denied";

function isPermissionDeniedError(err: unknown): boolean {
  const msg = ((err as Error | undefined)?.message ?? "").toLowerCase();
  return (
    msg.includes("denied") ||
    msg.includes("not allowed") ||
    msg.includes("permission") ||
    msg.includes("izin") ||
    msg.includes("ditolak") ||
    msg.includes("no access")
  );
}

// Cek + minta izin Kamera/Galeri di native (Capacitor). Kembalikan status
// akhir agar caller bisa memutuskan menampilkan panduan atau tidak. Di web
// murni, selalu "unsupported" — biar fallback web picker jalan seperti biasa.
async function ensureNativeMediaPermission(
  kind: "camera" | "photos",
): Promise<"granted" | "denied" | "unsupported"> {
  if (typeof window === "undefined") return "unsupported";
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return "unsupported";
    const { Camera } = await import("@capacitor/camera");
    const current = await Camera.checkPermissions();
    const state = kind === "camera" ? current.camera : current.photos;
    if (state === "granted" || state === "limited") return "granted";
    if (state === "denied") return "denied";
    // "prompt" / "prompt-with-rationale" → minta izin sekarang.
    const asked = await Camera.requestPermissions({ permissions: [kind] });
    const nextState = kind === "camera" ? asked.camera : asked.photos;
    if (nextState === "granted" || nextState === "limited") return "granted";
    if (nextState === "denied") return "denied";
    return "unsupported";
  } catch {
    return "unsupported";
  }
}

type NativePickedPhoto = {
  webPath?: string;
  path?: string;
  uri?: string;
  format?: string;
  metadata?: { format?: string | null } | null;
};

async function beginPortalNativePicker(): Promise<() => void> {
  const { beginNativePicker, endNativePicker } = await import("@/lib/app-lock");
  beginNativePicker();
  return endNativePicker;
}

/**
 * Ambil lokasi GPS dengan pesan error yang jelas + tombol "Coba lagi".
 * Dipakai oleh takeLocation() di dua branch (prep task & request).
 */
function requestGeolocation(
  onSuccess: (pos: GeolocationPosition) => void,
  opts?: { retry?: () => void; onSettled?: () => void },
) {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    toast.error("GPS tidak tersedia di perangkat ini", {
      description: "Coba isi koordinat manual atau tempel link Google Maps.",
    });
    opts?.onSettled?.();
    return;
  }
  const id = toast.loading("Mengambil lokasi…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      try {
        onSuccess(pos);
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);
        const acc = pos.coords.accuracy
          ? ` · akurasi ±${Math.round(pos.coords.accuracy)} m`
          : "";
        toast.success("Lokasi terisi", {
          id,
          description: `Link Maps otomatis terisi: ${lat}, ${lng}${acc}`,
          duration: 5000,
        });
      } catch (e) {
        toast.error("Gagal memproses lokasi", {
          id,
          description: e instanceof Error ? e.message : String(e),
          action: opts?.retry ? { label: "Coba lagi", onClick: opts.retry } : undefined,
        });
      } finally {
        opts?.onSettled?.();
      }
    },
    (err) => {
      // GeolocationPositionError codes:
      // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
      let title = "Gagal mengambil lokasi";
      let description = err.message || "Coba lagi beberapa saat.";
      if (err.code === 1) {
        title = "Izin lokasi ditolak";
        description =
          "Aktifkan izin lokasi untuk aplikasi/browser di Pengaturan HP, lalu coba lagi. Atau isi koordinat manual di bawah.";
      } else if (err.code === 2) {
        title = "Lokasi tidak tersedia";
        description =
          "Sinyal GPS lemah. Pindah ke area terbuka atau nyalakan Lokasi/Wi-Fi, lalu coba lagi.";
      } else if (err.code === 3) {
        title = "GPS timeout";
        description = "Perangkat butuh waktu lebih lama. Coba lagi di area terbuka.";
      }
      toast.error(title, {
        id,
        description,
        duration: 8000,
        action: opts?.retry ? { label: "Coba lagi", onClick: opts.retry } : undefined,
      });
      opts?.onSettled?.();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
}

function pickedPhotoUrl(photo: NativePickedPhoto): string | null {
  return photo.webPath || photo.path || photo.uri || null;
}

function pickedPhotoFormat(photo: NativePickedPhoto, blob: Blob): string {
  return (
    photo.format ||
    photo.metadata?.format ||
    blob.type.split("/")[1] ||
    "jpg"
  );
}

async function cameraPhotoToFile(photo: NativePickedPhoto, prefix: string): Promise<File | null> {
  const url = pickedPhotoUrl(photo);
  if (!url) return null;
  const response = await fetch(url);
  // URL lokal dari Capacitor/Android kadang bukan respons HTTP normal
  // (status bisa 0), tapi blob-nya tetap valid. Tolak hanya error HTTP nyata.
  if (response.status >= 400) {
    throw new Error(`Foto native tidak bisa dibaca (${response.status})`);
  }
  const blob = await response.blob();
  const rawExt = pickedPhotoFormat(photo, blob).toLowerCase();
  const ext = rawExt === "jpeg" ? "jpg" : rawExt.replace(/[^a-z0-9]/g, "") || "jpg";
  const mime = blob.type || (ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`);
  return new File([blob], `${prefix}-${Date.now()}.${ext}`, { type: mime });
}

async function captureNativeCameraPhoto(): Promise<File | NativeCameraStatus> {
  if (typeof window === "undefined") return "fallback";
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return "fallback";
  const perm = await ensureNativeMediaPermission("camera");
  if (perm === "denied") return "denied";
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri,
      quality: 82,
      width: 2048,
      height: 2048,
      correctOrientation: true,
      allowEditing: false,
      saveToGallery: false,
    });
    return (await cameraPhotoToFile(photo, "pegawai-kamera")) ?? "cancelled";
  } catch (err) {
    const msg = (err as Error).message?.toLowerCase?.() ?? "";
    if (msg.includes("cancel") || msg.includes("dismiss") || msg.includes("batal")) {
      return "cancelled";
    }
    if (isPermissionDeniedError(err)) return "denied";
    throw err;
  }
}

async function pickNativeGalleryPhotos(): Promise<File[] | NativeCameraStatus> {
  if (typeof window === "undefined") return "fallback";
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return "fallback";
  const perm = await ensureNativeMediaPermission("photos");
  if (perm === "denied") return "denied";
  try {
    const { Camera, MediaTypeSelection } = await import("@capacitor/camera");
    const result = await Camera.chooseFromGallery({
      mediaType: MediaTypeSelection.Photo,
      allowMultipleSelection: true,
      quality: 82,
      targetWidth: 2048,
      targetHeight: 2048,
      correctOrientation: true,
      limit: 20,
    });
    const photos = Array.isArray(result.results) ? result.results : [];
    const files = await Promise.all(
      photos.map((photo) => cameraPhotoToFile(photo, "pegawai-galeri")),
    );
    return files.filter((file): file is File => !!file);
  } catch (err) {
    const msg = (err as Error).message?.toLowerCase?.() ?? "";
    if (msg.includes("cancel") || msg.includes("dismiss") || msg.includes("batal")) {
      return "cancelled";
    }
    if (isPermissionDeniedError(err)) return "denied";
    throw err;
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForPhotosRefLength(
  photosRef: RefObject<StagedPhoto[]>,
  minLength: number,
): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const len = photosRef.current.length;
    if (len >= minLength) return len;
    await nextFrame();
  }
  return photosRef.current.length;
}

function isObjectUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("blob:");
}

function revokePhotoPreview(photo: StagedPhoto | null | undefined) {
  if (!photo || !isObjectUrl(photo.dataUrl) || typeof URL === "undefined") return;
  try {
    URL.revokeObjectURL(photo.dataUrl);
  } catch {
    /* noop */
  }
}

class WorkerSectionBoundary extends Component<
  {
    children: ReactNode;
    renderFallback: (error: Error, reset: () => void) => ReactNode;
  },
  { error: Error | null; attempt: number; remountKey: number }
> {
  state: { error: Error | null; attempt: number; remountKey: number } = {
    error: null,
    attempt: 0,
    remountKey: 0,
  };
  private retryTimer: number | null = null;
  private handleManualReset = () => {
    if (this.retryTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    // Reset penuh: bersihkan error, nolkan hitungan retry otomatis, dan
    // remount subtree bersih supaya state komponen anak yang mungkin korup
    // ikut ter-reset. Dipicu manual oleh pengguna dari tombol fallback.
    this.setState((prev) => ({
      error: null,
      attempt: 0,
      remountKey: prev.remountKey + 1,
    }));
  };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Jangan biarkan 1 kartu / paket request meruntuhkan seluruh portal pegawai
    // dan memantulkan user kembali ke layar PIN.
    // eslint-disable-next-line no-console
    console.error("[t.$token] worker section render failed", error, info.componentStack);
    // Auto-heal untuk race DOM transien (mis. `removeChild` / `insertBefore`
    // pada Android WebView setelah balik dari kamera/galeri, atau race
    // unmount portal yang membuat React & DOM sesaat tidak sinkron). Kartu
    // tetangga tidak terpengaruh.
    //
    // Strategi retry:
    //  - Untuk error DOM-race yang khas (NotFoundError / "removeChild" /
    //    "insertBefore" / "The node to be removed") kita retry sampai 5×
    //    dengan backoff, karena race ini hampir selalu hilang setelah 1
    //    tick paint berikutnya.
    //  - Untuk error lain kita retry 2× lalu tampilkan fallback supaya bug
    //    betulan tetap terlihat.
    const msg = (error?.message || "") + " " + (error?.name || "");
    const isDomRace = /removeChild|insertBefore|NotFoundError|The node to be removed|Failed to execute/i.test(
      msg,
    );
    const maxAttempts = isDomRace ? 5 : 2;
    if (this.state.attempt < maxAttempts && typeof window !== "undefined") {
      if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
      const delay = 200 + this.state.attempt * 250;
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        // Untuk DOM-race transien: JANGAN bump remountKey — kalau kita
        // remount subtree, semua foto staged / upload yang sedang berjalan
        // di dalam ItemCard hilang. Cukup clear error dan biarkan render
        // berikutnya menyelesaikan diri.
        // Untuk error lain (bug betulan): remount subtree bersih supaya
        // state internal komponen anak yang mungkin korup ikut di-reset.
        this.setState((prev) => ({
          error: null,
          attempt: prev.attempt + 1,
          remountKey: isDomRace ? prev.remountKey : prev.remountKey + 1,
        }));
      }, delay);
    }
  }
  componentWillUnmount() {
    if (this.retryTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
  render() {
    if (this.state.error) return this.props.renderFallback(this.state.error, this.handleManualReset);
    // Key hanya di-bump untuk error non-DOM-race (bug betulan) supaya
    // subtree di-mount ulang bersih. Untuk DOM race transien, key tetap
    // sama sehingga draft foto & progress upload di ItemCard tidak hilang.
    return <Fragment key={this.state.remountKey}>{this.props.children}</Fragment>;
  }
}

// Top-level error boundary khusus untuk seluruh halaman portal pegawai.
// Tujuan: kalau ada throw sinkron di render (mis. race saat WebView Android
// baru saja di-recreate setelah kembali dari kamera / galeri), TANGKAP di
// sini — jangan biarkan naik ke root ErrorComponent yang menampilkan
// layar "Memuat ulang halaman… percobaan otomatis N dari 3" yang meresahkan
// pegawai. Boundary ini me-remount PublicPrepPage secara diam-diam; sesi
// PIN di sessionStorage sudah dirancang untuk bertahan lintas remount.
class PortalTopBoundary extends Component<
  { children: ReactNode; onError: (error: Error) => void; resetKey: number },
  { error: Error | null; lastResetKey: number }
> {
  state: { error: Error | null; lastResetKey: number } = {
    error: null,
    lastResetKey: this.props.resetKey,
  };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  static getDerivedStateFromProps(
    props: { resetKey: number },
    state: { error: Error | null; lastResetKey: number },
  ): { error: Error | null; lastResetKey: number } | null {
    if (props.resetKey !== state.lastResetKey) {
      return { error: null, lastResetKey: props.resetKey };
    }
    return null;
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[t.$token] portal top-level render failed", error, info.componentStack);
    this.props.onError(error);
  }
  render() {
    if (this.state.error) {
      // Fallback minimal: hanya spinner, tanpa teks alarming. Auto-retry
      // dijadwalkan oleh parent lewat bump `resetKey`.
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-ms-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      );
    }
    return this.props.children;
  }
}

type MiniMapCoords = { lat: number; lng: number };

function parseCoordsFromUrl(url: string): MiniMapCoords | null {
  const m = url.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

type MiniMapPreviewProps = {
  locUrl: string;
  gps?: { lat: number; lng: number; accuracy?: number | null } | null;
  className?: string;
};

function MiniMapPreview({ locUrl, gps, className }: MiniMapPreviewProps) {
  const coords: MiniMapCoords | null = gps ? { lat: gps.lat, lng: gps.lng } : parseCoordsFromUrl(locUrl);
  if (!coords) return null;
  const { lat, lng } = coords;
  return (
    <a
      href={`https://www.google.com/maps?q=${lat},${lng}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Buka lokasi di Google Maps"
      className={cn("relative block w-full overflow-hidden rounded-lg border bg-muted", className)}
    >
      <iframe
        title="Pratinjau lokasi"
        src={`https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`}
        className="pointer-events-none h-full w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <span className="absolute inset-x-0 bottom-0 truncate bg-background/80 px-2 py-1 text-center text-[11px] font-medium tabular-nums text-foreground backdrop-blur">
        {lat.toFixed(4)}, {lng.toFixed(4)}
      </span>
    </a>
  );
}

function PublicPrepPageWithBoundary() {

  const [resetKey, setResetKey] = useState(0);
  const attemptRef = useRef(0);
  const onError = useCallback((error: Error) => {
    try {
      // Kirim ke pipeline error-reporting global (sama dgn root ErrorComponent)
      // supaya kita masih punya jejak walau UI-nya dipulihkan diam-diam.
      reportLovableError(error, { boundary: "portal_top_boundary" });
    } catch {
      /* noop */
    }
    // Auto-retry silent: remount PublicPrepPage. Backoff 300ms → 800ms → 1500ms,
    // maksimum 3 percobaan. Setelah itu biarkan error naik ke root boundary.
    const n = attemptRef.current;
    if (n >= 3) return;
    attemptRef.current = n + 1;
    const delay = n === 0 ? 300 : n === 1 ? 800 : 1500;
    window.setTimeout(() => setResetKey((k) => k + 1), delay);
  }, []);
  return (
    <PortalTopBoundary onError={onError} resetKey={resetKey}>
      <PublicPrepPage key={resetKey} />
    </PortalTopBoundary>
  );
}

function PublicPrepPage() {
  const { token } = Route.useParams();
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);
  const [successFlash, setSuccessFlash] = useState(false);
  const [loading, setLoading] = useState(false);
  const [task, setTask] = useState<PrepTaskRow | null>(null);
  const [items, setItems] = useState<PrepItemRow[]>([]);
  const pinRef = useRef("");
  const autoTriedRef = useRef(false);
  const [closedReason, setClosedReason] = useState<
    null | "pin_changed" | "not_found" | "expired" | "closed"
  >(null);
  // Konfigurasi runtime (TTL sesi, retry, ambang stale). Dibaca via
  // useRef agar tidak bikin re-render saat dipakai dari callback dan
  // tidak berubah di tengah lifecycle satu mount. Override bisa via
  // `window.__WORKER_PORTAL_CONFIG__` atau env `VITE_WORKER_PORTAL_*`.
  // Terapkan override preview dari URL hash SEBELUM resolusi config.
  // Idempoten dan no-op kalau tidak ada hash. Memungkinkan admin
  // membuka portal pegawai dengan konfigurasi yang sedang diuji.
  if (typeof window !== "undefined") {
    applyPreviewOverrideFromHash();
  }
  const cfgRef = useRef(getWorkerPortalConfig());
  const [cfgTick, setCfgTick] = useState(0);
  const cfg = cfgRef.current;
  // Sinkron konfigurasi dari `app_settings` di backend agar perubahan
  // admin (TTL PIN, retry tolerance, dsb.) berlaku tanpa code change.
  useEffect(() => {
    let alive = true;
    void fetchAndApplyWorkerPortalConfig().then((next) => {
      if (!alive) return;
      cfgRef.current = next;
      setCfgTick((t) => t + 1);
    });
    return () => {
      alive = false;
    };
  }, []);
  void cfgTick;
  // Persistensi sesi pegawai (PIN + flag authed) di sessionStorage.
  // Tujuan: WebView Android yang dire-create setelah kembali dari aplikasi
  // kamera / galeri / share / pengunci layar TIDAK memantulkan pegawai
  // kembali ke layar PIN. PIN disimpan dalam scope per-token, TTL singkat.
  const SESSION_KEY = `prep_session:${token}`;
  const SESSION_TTL_MS = cfg.sessionTtlMs;
  // BroadcastChannel untuk sinkron antar-tab: countdown sesi PIN dan
  // status lock berlaku real-time tanpa reload. localStorage hanya bicara
  // antar-tab via `storage` event (cocok utk lock), tapi sessionStorage
  // per-tab — jadi countdown sesi butuh BroadcastChannel.
  const bcRef = useRef<BroadcastChannel | null>(null);
  const authedRef = useRef(false);
  useEffect(() => {
    authedRef.current = authed;
  }, [authed]);
  type PortalMsg =
    | { type: "session"; pin: string; ts: number }
    | { type: "session-clear" }
    | { type: "attempts"; attempts: number; lockedUntil: number | null };
  function broadcast(msg: PortalMsg) {
    try {
      bcRef.current?.postMessage(msg);
    } catch {
      /* noop */
    }
  }
  function readSession(): { pin: string; ts: number } | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { pin?: string; ts?: number };
      if (!parsed?.pin || !parsed?.ts) return null;
      if (Date.now() - parsed.ts > SESSION_TTL_MS) {
        window.sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return { pin: parsed.pin, ts: parsed.ts };
    } catch {
      return null;
    }
  }
  function writeSession(pin: string) {
    if (typeof window === "undefined") return;
    const ts = Date.now();
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ pin, ts }));
    } catch {}
    setSessionStartedAt(ts);
    broadcast({ type: "session", pin, ts });
  }
  function clearSession() {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    setSessionStartedAt(null);
    broadcast({ type: "session-clear" });
  }
  // Counter kegagalan berturut-turut untuk silentRefresh; baru flip ke layar
  // closedReason setelah 2x kegagalan kategori sama agar transient error
  // (DB hiccup, koneksi seluler putus sekejap) tidak menendang user balik.
  const silentFailRef = useRef<{ kind: string | null; count: number }>({ kind: null, count: 0 });
  // Hasil pengecekan otomatis status link saat halaman dibuka (sebelum PIN).
  // Memberi tahu pegawai segera kalau link tidak valid, kedaluwarsa, ditutup,
  // atau aksesnya sedang dikunci karena terlalu banyak salah PIN.
  const [peekStatus, setPeekStatus] = useState<
    | { state: "checking" }
    | { state: "ok"; title?: string; expiresAt?: string | null }
    | { state: "not_found" }
    | { state: "expired"; expiresAt?: string | null }
    | { state: "closed"; status?: string | null }
    | { state: "rate_limited"; retryAfter: number }
    | { state: "network"; message: string }
  >({ state: "checking" });
  // Pesan error terakhir dari proses verifikasi PIN; ditampilkan inline di kartu PIN.
  const [lastError, setLastError] = useState<null | {
    kind: "bad_pin" | "rate_limited" | "not_found" | "expired" | "closed" | "network" | "no_task";
    message: string;
    detail?: string;
    code?: string;
    ref?: string;
  }>(null);
  const [staleItemIds, setStaleItemIds] = useState<Record<string, true>>({});
  const itemsRef = useRef<PrepItemRow[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // ID item yang di-auto-open oleh flow "selesai satu, buka berikutnya di varian sama".
  // Nilai bertambah tiap trigger (nanoid-ish) supaya efek di ItemCard bisa bereaksi
  // meski id target sama dengan sebelumnya.
  const [autoOpen, setAutoOpen] = useState<{ id: string | null; tick: number }>({ id: null, tick: 0 });
  const collapsedStorageKey = `worker.collapsedGroups.${token}`;
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(collapsedStorageKey) : null;
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem(collapsedStorageKey, JSON.stringify(collapsedGroups)); } catch {}
  }, [collapsedGroups, collapsedStorageKey]);
  type SortMode = "index" | "pending-first" | "done-first" | "weight-desc" | "weight-asc";
  const sortStorageKey = `worker.sortMode.${token}`;
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(sortStorageKey) : null;
      return (raw as SortMode) || "index";
    } catch {
      return "index";
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem(sortStorageKey, sortMode); } catch {}
  }, [sortMode, sortStorageKey]);
  const [selectedGroup, setSelectedGroup] = useState<VariantGroup | null>(null);
  // Status koneksi realtime: 'connecting' saat awal, 'connected' setelah SUBSCRIBED,
  // 'error' bila channel gagal/terputus. lastSyncAt diisi setiap silentRefresh sukses.
  const [rtStatus, setRtStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncTick, setSyncTick] = useState(0); // memicu re-render label "x dtk lalu"
  const [resyncing, setResyncing] = useState(false);
  // Status "reload versi baru sedang ditahan" dari build-cache-buster.
  const [deferredReload, setDeferredReload] = useState<DeferredReloadState>({
    pending: false, reason: null, serverBuildId: null, since: null,
  });
  const [deferredTick, setDeferredTick] = useState(0);
  useEffect(() => subscribeDeferredReload(setDeferredReload), []);
  useEffect(() => {
    if (!deferredReload.pending || !deferredReload.since) return;
    const since = deferredReload.since;
    const update = () => setDeferredTick(Math.max(0, Math.round((Date.now() - since) / 1000)));
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [deferredReload.pending, deferredReload.since]);
  const autoResyncRef = useRef<{ lastAt: number; failCount: number }>({ lastAt: 0, failCount: 0 });
  const activeWorkerOpsRef = useRef(0);
  const lastKeepAliveAtRef = useRef(0);
  // Antrian pekerjaan yang harus ditunda selama busy > 0 (mis. auto-logout
  // TTL, kembali ke PIN). Dijalankan sekali setelah counter turun ke 0.
  const idleQueueRef = useRef<Array<() => void>>([]);
  const pendingSessionExpiryRef = useRef(false);
  const runIdleQueue = useCallback(() => {
    const q = idleQueueRef.current;
    idleQueueRef.current = [];
    for (const fn of q) {
      try { fn(); } catch { /* noop */ }
    }
  }, []);
  const setWorkerOperationActive = useCallback((active: boolean) => {
    activeWorkerOpsRef.current = Math.max(0, activeWorkerOpsRef.current + (active ? 1 : -1));
    // Naikkan flag global `__mcmBusy` supaya cache-buster tidak reload di
    // tengah proses ambil/edit/upload foto (lihat src/lib/build-cache-buster.ts).
    try {
      const w = window as unknown as { __mcmBusy?: number };
      const cur = typeof w.__mcmBusy === "number" ? w.__mcmBusy : 0;
      w.__mcmBusy = Math.max(0, cur + (active ? 1 : -1));
    } catch { /* ignore */ }
    // Ketika seluruh operasi selesai, jalankan aksi yang tadi ditunda
    // (misal auto-logout TTL, kembali ke PIN, atau silentRefresh yang
    // sempat dilewati saat busy).
    if (activeWorkerOpsRef.current === 0) {
      runIdleQueue();
      // Refresh ringan sekali setelah idle supaya data pasti terkini.
      try { void silentRefreshRef.current?.(); } catch { /* noop */ }
      // Cek versi sekali lagi: bila deploy baru sudah live sementara
      // kita sibuk, sekarang saatnya reload dengan aman.
      try { recheckBuildVersion(); } catch { /* noop */ }
    }
  }, [runIdleQueue]);
  // Ref ke silentRefresh untuk dipanggil dari setWorkerOperationActive
  // tanpa menciptakan siklus dependensi.
  const silentRefreshRef = useRef<null | (() => Promise<void>)>(null);
  const keepWorkerSessionAlive = useCallback(() => {
    const now = Date.now();
    if (now - lastKeepAliveAtRef.current < 30_000) return;
    const currentPin = pinRef.current;
    if (!currentPin || !authedRef.current) return;
    lastKeepAliveAtRef.current = now;
    writeSession(currentPin);
  }, []);
  const isWorkerOperationActive = () => activeWorkerOpsRef.current > 0;

  // Bungkus aksi yang tidak boleh mengganggu proses ambil/edit/upload foto.
  // Bila sedang busy, aksi ditunda sampai idle dan user diberi toast.
  const runWhenIdle = useCallback(
    (fn: () => void, busyMessage = "Selesaikan foto/editor dulu, aksi akan dilanjutkan otomatis.") => {
      if (!isWorkerOperationActive()) { fn(); return; }
      idleQueueRef.current.push(fn);
      toast.info(busyMessage);
    },
    [],
  );

  useEffect(() => {
    if (!authed) return;
    const onActivity = () => keepWorkerSessionAlive();
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("input", onActivity, true);
    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("input", onActivity, true);
    };
  }, [authed, keepWorkerSessionAlive]);

  // Paksa muat ulang data sekarang juga (dipakai tombol "Resync sekarang").
  async function manualResync() {
    if (resyncing) return;
    if (isWorkerOperationActive()) {
      toast.info("Selesaikan foto/editor dulu, lalu resync lagi.");
      return;
    }
    setResyncing(true);
    const toastId = toast.loading("Menyinkronkan ulang…");
    try {
      await silentRefresh();
      toast.success("Data terbaru dimuat", { id: toastId, duration: 2000 });
    } catch (e) {
      toast.error("Gagal menyinkronkan: " + (e as Error).message, { id: toastId });
    } finally {
      setResyncing(false);
    }
  }

  // Auto-resync saat indikator masuk kategori "Tertunda" (>30 dtk) atau
  // "Tidak sinkron" (>90 dtk / channel error). Dibatasi cooldown agar
  // tidak membanjiri server saat koneksi memang sedang bermasalah.
  useEffect(() => {
    if (!authed || resyncing) return;
    const age = lastSyncAt ? (Date.now() - lastSyncAt) / 1000 : null;
    const isStale = rtStatus === "error" || (age != null && age > cfg.staleThresholdSec);
    const isLag = !isStale && age != null && age > cfg.lagThresholdSec;
    if (!isStale && !isLag) {
      autoResyncRef.current.failCount = 0;
      return;
    }
    // Cooldown backoff: lag 10 dtk; stale mulai 5 dtk, naik hingga 30 dtk.
    const fc = autoResyncRef.current.failCount;
    const cooldownMs = isStale
      ? Math.min(cfg.staleCooldownMaxMs, cfg.staleCooldownBaseMs * Math.pow(2, fc))
      : cfg.lagCooldownMs;
    if (Date.now() - autoResyncRef.current.lastAt < cooldownMs) return;
    autoResyncRef.current.lastAt = Date.now();
    const prevSync = lastSyncAt;
    void (async () => {
      await silentRefresh();
      // Bila silentRefresh tidak memperbarui lastSyncAt (gagal/diam), naikkan
      // counter agar interval coba ulang merenggang.
      if (lastSyncAt === prevSync) autoResyncRef.current.failCount = fc + 1;
      else autoResyncRef.current.failCount = 0;
    })();
    // syncTick memicu evaluasi ulang tiap 5 dtk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, rtStatus, lastSyncAt, syncTick, resyncing]);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Timestamp mulai sesi PIN aktif. Dipakai utk countdown sisa waktu
  // sebelum re-login. Dipasang di writeSession dan rehydrate.
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  // Penanda bahwa sesi PIN baru saja kedaluwarsa otomatis. Dipakai
  // untuk menampilkan tombol "Re-login" yang menonjol di layar PIN.
  const [sessionJustExpired, setSessionJustExpired] = useState(false);
  const pinInputRef = useRef<HTMLInputElement | null>(null);
  function focusPinInput() {
    setTimeout(() => {
      try {
        pinInputRef.current?.focus();
      } catch {
        /* noop */
      }
    }, 50);
  }
  function reloginNow() {
    runWhenIdle(() => {
      goBackToPin();
      focusPinInput();
    });
  }
  // Pembatasan percobaan di sisi klien: maksimal MAX_ATTEMPTS PIN salah
  // berturut-turut sebelum input PIN dikunci selama LOCK_SECONDS.
  // Data disimpan di localStorage per-token agar reload halaman tidak
  // mem-bypass pembatasan. Server juga punya rate-limit terpisah
  // (mengembalikan "rate_limited" + retry_after).
  const MAX_ATTEMPTS = cfg.maxAttempts;
  const LOCK_SECONDS = cfg.lockSeconds;
  const STORAGE_KEY = `prep_pin_attempts:${token}`;
  const [attempts, setAttempts] = useState(0);
  const [justUnlocked, setJustUnlocked] = useState(false);

  type AttemptState = { attempts: number; lockedUntil: number | null };
  function readAttemptState(): AttemptState {
    if (typeof window === "undefined") return { attempts: 0, lockedUntil: null };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { attempts: 0, lockedUntil: null };
      const parsed = JSON.parse(raw) as AttemptState;
      return {
        attempts: Number(parsed.attempts) || 0,
        lockedUntil:
          parsed.lockedUntil && parsed.lockedUntil > Date.now() ? parsed.lockedUntil : null,
      };
    } catch {
      return { attempts: 0, lockedUntil: null };
    }
  }
  function writeAttemptState(state: AttemptState) {
    if (typeof window === "undefined") return;
    try {
      if (!state.attempts && !state.lockedUntil) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota */
    }
    broadcast({ type: "attempts", attempts: state.attempts, lockedUntil: state.lockedUntil });
  }
  // Reset total: state in-memory + localStorage benar-benar dibersihkan.
  // Dipanggil saat PIN benar agar refresh browser memulai dari 0 percobaan.
  function resetAttemptsFully() {
    setAttempts(0);
    setLockedUntil(null);
    setJustUnlocked(false);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        // jaga-jaga jika ada key lama dari versi sebelumnya
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  useEffect(() => {
    const s = readAttemptState();
    setAttempts(s.attempts);
    if (s.lockedUntil) setLockedUntil(s.lockedUntil);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sinkronkan antar-tab: jika tab lain berhasil verifikasi PIN dan
  // menghapus STORAGE_KEY, tab ini juga ikut reset.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue == null) {
        setAttempts(0);
        setLockedUntil(null);
        return;
      }
      // Tab lain memperbarui status lock (mis. salah PIN / dikunci server).
      try {
        const parsed = JSON.parse(e.newValue) as AttemptState;
        setAttempts(Number(parsed.attempts) || 0);
        const until =
          parsed.lockedUntil && parsed.lockedUntil > Date.now() ? parsed.lockedUntil : null;
        setLockedUntil(until);
      } catch {
        /* ignore corrupt payload */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BroadcastChannel: sinkron sesi (countdown PIN) dan status lock antar-tab.
  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(`prep-portal:${token}`);
    bcRef.current = bc;
    bc.onmessage = (ev: MessageEvent<PortalMsg>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "session") {
        // Tab lain berhasil login / refresh sesi → samakan countdown.
        setSessionStartedAt(msg.ts);
        pinRef.current = msg.pin;
        setPin(msg.pin);
        setClosedReason(null);
        if (!authedRef.current) {
          // Belum punya data tugas di tab ini → ambil senyap.
          setAuthed(true);
          void silentRefresh();
        }
      } else if (msg.type === "session-clear") {
        // Tab lain sign-out → ikut kembali ke layar PIN.
        setSessionStartedAt(null);
        if (authedRef.current) {
          setAuthed(false);
          setTask(null);
          setItems([]);
          setPin("");
          pinRef.current = "";
        }
      } else if (msg.type === "attempts") {
        setAttempts(Number(msg.attempts) || 0);
        const until = msg.lockedUntil && msg.lockedUntil > Date.now() ? msg.lockedUntil : null;
        setLockedUntil(until);
      }
    };
    return () => {
      try {
        bc.close();
      } catch {
        /* noop */
      }
      if (bcRef.current === bc) bcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (lockedUntil == null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (lockedUntil <= t) {
        setLockedUntil(null);
        setAttempts(0);
        writeAttemptState({ attempts: 0, lockedUntil: null });
        setJustUnlocked(true);
        setTimeout(() => setJustUnlocked(false), 6000);
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedUntil]);

  const lockedSecondsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  const isLocked = lockedSecondsLeft > 0;
  const lockedClock = `${String(Math.floor(lockedSecondsLeft / 60)).padStart(2, "0")}:${String(lockedSecondsLeft % 60).padStart(2, "0")}`;
  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attempts);

  // Countdown sisa waktu sesi PIN (hanya saat authed). Tick 1 detik agar
  // operator tahu kapan akan dimintai PIN lagi. Saat 0, paksa kembali ke
  // layar PIN — sejalan dgn TTL yang dipakai readSession().
  useEffect(() => {
    if (!authed || !sessionStartedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [authed, sessionStartedAt]);
  const sessionExpiresAt = sessionStartedAt ? sessionStartedAt + SESSION_TTL_MS : null;
  const sessionSecondsLeft = sessionExpiresAt
    ? Math.max(0, Math.ceil((sessionExpiresAt - now) / 1000))
    : 0;
  const sessionClock = `${String(Math.floor(sessionSecondsLeft / 60)).padStart(2, "0")}:${String(sessionSecondsLeft % 60).padStart(2, "0")}`;
  useEffect(() => {
    if (!authed || !sessionExpiresAt) return;
    if (sessionSecondsLeft > 0) return;
    // Jangan cabut sesi di tengah proses ambil/edit/upload foto — draft
    // foto & PIN hilang. Tandai sebagai pending; setWorkerOperationActive
    // akan menjalankannya begitu counter turun ke 0.
    if (isWorkerOperationActive()) {
      if (!pendingSessionExpiryRef.current) {
        pendingSessionExpiryRef.current = true;
        idleQueueRef.current.push(() => {
          pendingSessionExpiryRef.current = false;
          clearSession();
          setAuthed(false);
          setPin("");
          pinRef.current = "";
          setSessionJustExpired(true);
          toast.info("Sesi PIN berakhir — silakan masuk ulang.");
          focusPinInput();
        });
        toast.info("Sesi PIN habis, akan diakhiri setelah foto selesai.");
      }
      return;
    }
    // TTL habis → lepas sesi & kembalikan ke layar PIN.
    clearSession();
    setAuthed(false);
    setPin("");
    pinRef.current = "";
    setSessionJustExpired(true);
    toast.info("Sesi PIN berakhir — silakan masuk ulang.");
    focusPinInput();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, sessionExpiresAt, sessionSecondsLeft]);

  async function fetchTask(p: string) {
    if (isLocked) return false;
    setLoading(true);
    const { data, error } = await publicSupabase.rpc("prep_get_task", { _token: token, _pin: p });
    setLoading(false);
    if (error) {
      const msg = "Tidak bisa menghubungi server. Periksa koneksi internet lalu coba lagi.";
      const errCode = (error as { code?: string } | null)?.code ?? null;
      setLastError({ kind: "network", message: msg, code: errCode ?? undefined });
      void reportPortalError({ kind: "network", code: errCode, token }).then((ref) => {
        if (ref) setLastError((prev) => (prev ? { ...prev, ref } : prev));
      });
      toast.error(msg);
      return false;
    }
    const res = data as {
      ok: boolean;
      error?: string;
      retry_after?: number;
      expires_at?: string;
      status?: string;
      task?: unknown;
      items?: unknown;
    };
    if (!res?.ok) {
      if (res?.error === "rate_limited") {
        const secs = Math.max(1, res.retry_after ?? 600);
        const until = Date.now() + secs * 1000;
        setLockedUntil(until);
        writeAttemptState({ attempts: MAX_ATTEMPTS, lockedUntil: until });
        const mins = Math.floor(secs / 60);
        const remain = mins >= 1 ? `${mins} menit ${secs % 60} detik` : `${secs} detik`;
        const msg = `Akses terkunci oleh server. Coba lagi dalam ${remain}.`;
        setLastError({
          kind: "rate_limited",
          message: msg,
          code: "rate_limited",
          detail: `retry_after: ${secs} detik`,
        });
        toast.error(msg);
      } else {
        if (res?.error === "bad_pin") {
          const next = attempts + 1;
          if (next >= MAX_ATTEMPTS) {
            const until = Date.now() + LOCK_SECONDS * 1000;
            setAttempts(next);
            setLockedUntil(until);
            writeAttemptState({ attempts: next, lockedUntil: until });
            const msg = `PIN salah. Anda sudah ${MAX_ATTEMPTS} kali keliru — input dikunci ${LOCK_SECONDS} detik.`;
            setLastError({ kind: "bad_pin", message: msg, code: "bad_pin" });
            toast.error(msg);
          } else {
            setAttempts(next);
            writeAttemptState({ attempts: next, lockedUntil: null });
            const left = MAX_ATTEMPTS - next;
            const msg = `PIN salah. Sisa percobaan: ${left} dari ${MAX_ATTEMPTS}.`;
            setLastError({ kind: "bad_pin", message: msg, code: "bad_pin" });
            toast.error(msg);
          }
          setPin("");
        } else if (res?.error === "expired") {
          const expAt = res.expires_at ? new Date(res.expires_at) : null;
          const detail = expAt
            ? `Kedaluwarsa pada ${expAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}.`
            : undefined;
          const msg = "Link tugas sudah kedaluwarsa. Minta pemilik mengirim link / PIN baru.";
          setLastError({ kind: "expired", message: msg, detail, code: "expired" });
          toast.error(msg);
        } else if (res?.error === "closed") {
          const msg =
            res.status === "cancelled"
              ? "Tugas ini sudah dibatalkan pemilik."
              : "Tugas ini sudah ditutup pemilik (sudah selesai).";
          setLastError({
            kind: "closed",
            message: msg,
            code: "closed",
            detail: res.status ? `Status: ${res.status}` : undefined,
          });
          toast.error(msg);
        } else if (res?.error === "not_found") {
          const msg =
            "Link tugas tidak ditemukan. Pastikan link tidak terpotong atau minta link baru ke pemilik.";
          setLastError({ kind: "not_found", message: msg, code: "not_found" });
          toast.error(msg);
        } else {
          const code = res?.error || "unknown";
          const msg =
            "Tugas tidak bisa dibuka karena gangguan sesaat. Coba beberapa saat lagi, atau tunjukkan kode referensi di bawah ke pemilik.";
          setLastError({
            kind: "not_found",
            message: msg,
            code,
          });
          void reportPortalError({
            kind: "unknown",
            code,
            status: res?.status ?? null,
            token,
          }).then((ref) => {
            if (ref) setLastError((prev) => (prev ? { ...prev, ref } : prev));
          });
          toast.error(msg);
        }
      }
      return false;
    }
    // PIN valid (ok=true) tapi payload task hilang → tampilkan detail diagnostik
    const normalizedTask = normalizePrepTask(res.task);
    if (!normalizedTask) {
      const msg =
        "PIN benar, tetapi data tugas belum bisa dimuat. Coba lagi, atau tunjukkan kode referensi di bawah ke pemilik.";
      setLastError({
        kind: "no_task",
        message: msg,
        code: "missing_task",
      });
      void reportPortalError({
        kind: "missing_task",
        code: "missing_task",
        status: res?.status ?? null,
        token,
      }).then((ref) => {
        if (ref) setLastError((prev) => (prev ? { ...prev, ref } : prev));
      });
      toast.error(msg);
      return false;
    }
    const normalizedItems = normalizePrepItems(res.items);
    setLastError(null);
    // Selalu update payload tugas + items (dipakai oleh refresh() setelah
    // submit juga, bukan hanya saat login pertama).
    setTask(normalizedTask);
    setItems(normalizedItems);
    pinRef.current = p;
    // Efek "login": HANYA saat transisi belum-authed → authed. Kalau sudah
    // authed (mis. dipanggil oleh refresh() setelah submit foto), jangan
    // ulang toast/scroll/reset — itulah yang bikin layar terasa "mulai
    // ulang" setiap kali habis upload.
    if (!authed) {
      // Defensif: pastikan tidak ada layar "tugas ditutup" yang tersisa dari
      // silentRefresh sebelumnya, agar setelah authed=true tidak langsung
      // melompat balik ke screen closedReason.
      setClosedReason(null);
      // PIN benar → reset penuh, termasuk localStorage, sehingga refresh
      // browser tidak membawa sisa percobaan/lock.
      resetAttemptsFully();
      // Simpan PIN ke sessionStorage agar WebView yang di-recreate (mis. setelah
      // user buka kamera/galeri) bisa auto-rehydrate ke layar tugas.
      writeSession(p);
      // eslint-disable-next-line no-console
      console.log("[t.$token] PIN ok", {
        taskId: normalizedTask.id,
        itemsCount: normalizedItems.length,
        status: normalizedTask.status,
      });
      setAuthed(true);
      setSuccessFlash(false);
      toast.success("Masuk pegawai berhasil", { duration: 1500 });
      // Pastikan posisi scroll kembali ke atas halaman tugas.
      if (typeof window !== "undefined") {
        try {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch {
          window.scrollTo(0, 0);
        }
      }
    }
    return true;
  }

  // Kembali ke layar verifikasi PIN tanpa mengganggu data percobaan
  // (yang sudah di-reset sebelumnya saat PIN benar).
  function goBackToPin() {
    setAuthed(false);
    setTask(null);
    setItems([]);
    setPin("");
    pinRef.current = "";
    clearSession();
    if (typeof window !== "undefined") {
      try {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        window.scrollTo(0, 0);
      }
    }
  }

  // poll-ish refresh after submission
  async function refresh() {
    if (!pinRef.current) return;
    await fetchTask(pinRef.current);
  }

  /**
   * Dipanggil ItemCard setelah submit sukses. Selain refresh data,
   * kartu yang baru saja selesai akan auto-collapse dan kartu berikutnya
   * di varian yang sama akan auto-open + di-scroll ke tengah layar,
   * supaya pegawai tidak perlu manual tutup-buka setiap paket.
   */
  function handleItemSubmitted(justDoneId: string) {
    const stripSuffix = (s: string) =>
      s.replace(/\s*[\(\[]\s*\d+\s*[\/／of-]\s*\d+\s*[\)\]]\s*$/i, "")
       .replace(/\s*#\s*\d+\s*$/i, "")
       .trim();
    const cur = itemsRef.current;
    const done = cur.find((i) => i.id === justDoneId);
    let nextId: string | null = null;
    if (done) {
      const baseKey = `${stripSuffix(done.name) || done.name}::${done.category ?? ""}`;
      const isPending = (it: PrepItemRow) => (it.submissions?.length ?? 0) === 0;
      const sameVariant = (it: PrepItemRow) =>
        `${stripSuffix(it.name) || it.name}::${it.category ?? ""}` === baseKey;
      const justIdx = cur.findIndex((i) => i.id === justDoneId);
      // Prioritas: item berikutnya di varian sama (index > justIdx),
      // lalu item lain di varian sama, lalu item pending mana saja.
      const nextInVariantAfter =
        cur.find((it, idx) => it.id !== justDoneId && sameVariant(it) && isPending(it) && idx > justIdx) ??
        cur.find((it) => it.id !== justDoneId && sameVariant(it) && isPending(it));
      const anyPending = nextInVariantAfter ?? cur.find((it) => it.id !== justDoneId && isPending(it));
      nextId = anyPending?.id ?? null;
    }
    setAutoOpen((prev) => ({ id: nextId, tick: prev.tick + 1 }));
    void refresh();
  }

  // Refresh ringan untuk dipanggil oleh realtime / heartbeat / visibilitychange.
  // Bedanya: bila PIN telah diubah admin atau tugas ditutup, langsung pindah
  // ke layar yang sesuai tanpa menghapus state percobaan.
  async function silentRefresh() {
    if (!pinRef.current || !authed) return;
    if (isWorkerOperationActive()) return;
    let data: unknown = null;
    try {
      const r = await publicSupabase.rpc("prep_get_task", { _token: token, _pin: pinRef.current });
      if (r.error) {
        // Network / transport error → JANGAN flip ke closedReason. Biar status
        // realtime/sync badge yang memberi tahu user.
        // eslint-disable-next-line no-console
        console.warn("[t.$token] silentRefresh transport error", r.error);
        return;
      }
      data = r.data;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[t.$token] silentRefresh threw", e);
      return;
    }
    const res = data as { ok: boolean; error?: string; task?: unknown; items?: unknown };
    if (!res?.ok) {
      const kind = res?.error ?? "unknown";
      // Butuh 2x kegagalan berturut-turut dgn kind yang sama sebelum
      // benar-benar menendang user — hindari false positive saat owner
      // sedang rotate PIN / replikasi DB belum sinkron sepersekian detik.
      if (silentFailRef.current.kind === kind) silentFailRef.current.count += 1;
      else silentFailRef.current = { kind, count: 1 };
      if (silentFailRef.current.count < cfg.silentFailTolerance) {
        // eslint-disable-next-line no-console
        console.warn("[t.$token] silentRefresh non-ok (tolerated)", res);
        return;
      }
      if (kind === "bad_pin") setClosedReason("pin_changed");
      else if (kind === "expired") setClosedReason("expired");
      else if (kind === "closed") setClosedReason("closed");
      else if (kind === "not_found") setClosedReason("not_found");
      // PIN cached sudah tidak valid → buang supaya tidak auto-rehydrate
      // ke loop "Kembali ke PIN" lagi setelah WebView dire-create.
      clearSession();
      // eslint-disable-next-line no-console
      console.warn("[t.$token] silentRefresh non-ok (kicked)", res);
      return;
    }
    // Reset counter saat sukses.
    silentFailRef.current = { kind: null, count: 0 };
    // Deteksi item yang sedang dilihat pegawai tapi sudah berubah versinya.
    const normalizedTask = normalizePrepTask(res.task);
    if (!normalizedTask) {
      // Payload kosong / malformed pada refresh berkala tidak boleh memantulkan
      // user ke PIN; pertahankan data terakhir yang masih valid.
      // eslint-disable-next-line no-console
      console.warn("[t.$token] silentRefresh missing/malformed task", res);
      return;
    }
    const normalizedItems = normalizePrepItems(res.items);
    const prev = new Map(itemsRef.current.map((i) => [i.id, i.updated_at ?? null]));
    const nextStale: Record<string, true> = { ...staleItemIds };
    for (const it of normalizedItems) {
      const before = prev.get(it.id);
      if (before && it.updated_at && before !== it.updated_at) {
        nextStale[it.id] = true;
      }
    }
    setStaleItemIds(nextStale);
    setTask(normalizedTask);
    setItems(normalizedItems);
    setLastSyncAt(Date.now());
  }

  // Daftarkan silentRefresh ke ref agar setWorkerOperationActive dapat
  // memicu satu kali refresh saat semua operasi busy selesai.
  silentRefreshRef.current = silentRefresh;

  // Beri peringatan sebelum tab ditutup / reload saat foto masih diproses
  // agar draft tidak hilang tanpa disadari.
  useEffect(() => {
    if (!authed) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isWorkerOperationActive()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [authed]);

  function clearStale(itemId: string) {
    setStaleItemIds((s) => {
      if (!s[itemId]) return s;
      const copy = { ...s };
      delete copy[itemId];
      return copy;
    });
  }

  // Realtime broadcast + fallback heartbeat & visibility refresh.
  useEffect(() => {
    if (!authed) return;
    setRtStatus("connecting");
    const ch = publicSupabase
      .channel(`prep:${token}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "change" }, () => {
        void silentRefresh();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRtStatus("connected");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
          setRtStatus("error");
      });
    const onVis = () => {
      if (document.visibilityState === "visible") void silentRefresh();
    };
    document.addEventListener("visibilitychange", onVis);
    const hb = window.setInterval(() => {
      if (document.visibilityState === "visible") void silentRefresh();
    }, 15000);
    const tick = window.setInterval(() => setSyncTick((n) => n + 1), 5000);
    return () => {
      publicSupabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(hb);
      window.clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, token]);

  // Auto-buka tugas jika PIN diberikan via fragment URL ( #p=1234 ).
  // Fragment tidak dikirim ke server, jadi PIN tetap aman dari log.
  useEffect(() => {
    if (authed || autoTriedRef.current || typeof window === "undefined") return;
    // Prioritas 1: fragment URL (#p=1234) — link share/QR pertama kali.
    // Prioritas 2: sessionStorage — WebView yang dire-create setelah user
    //              kembali dari kamera/galeri/share/lock screen.
    const hash = window.location.hash || "";
    const m = hash.match(/(?:^#|[#&])p=(\d{4,8})/);
    const session = readSession();
    const autoPin = m?.[1] ?? session?.pin ?? null;
    if (!autoPin) return;
    if (session?.ts) setSessionStartedAt(session.ts);
    autoTriedRef.current = true;
    setPin(autoPin);
    void fetchTask(autoPin);
    if (m) {
      // Bersihkan fragment dari address bar agar PIN tidak terlihat lagi.
      try {
        const { pathname, search } = window.location;
        window.history.replaceState(null, "", `${pathname}${search}`);
      } catch {
        /* noop */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-validasi status link saat halaman dibuka. Tidak perlu PIN —
  // memanggil RPC `prep_peek_task` yang hanya mengembalikan status aman
  // (ok / not_found / expired / closed / rate_limited).
  useEffect(() => {
    let cancelled = false;
    async function check() {
      setPeekStatus({ state: "checking" });
      const { data, error } = await publicSupabase.rpc("prep_peek_task", { _token: token });
      if (cancelled) return;
      if (error) {
        setPeekStatus({ state: "network", message: error.message });
        return;
      }
      const res = data as {
        ok: boolean;
        error?: string;
        retry_after?: number;
        expires_at?: string;
        status?: string;
        title?: string;
      };
      if (res?.ok) {
        setPeekStatus({ state: "ok", title: res.title, expiresAt: res.expires_at ?? null });
        return;
      }
      if (res?.error === "rate_limited") {
        const secs = Math.max(1, res.retry_after ?? 600);
        setPeekStatus({ state: "rate_limited", retryAfter: secs });
        setLockedUntil(Date.now() + secs * 1000);
        return;
      }
      if (res?.error === "expired") {
        setPeekStatus({ state: "expired", expiresAt: res.expires_at ?? null });
        return;
      }
      if (res?.error === "closed") {
        setPeekStatus({ state: "closed", status: res.status ?? null });
        return;
      }
      if (res?.error === "not_found") {
        setPeekStatus({ state: "not_found" });
        return;
      }
      setPeekStatus({
        state: "network",
        message: `Kode tidak dikenal: ${res?.error ?? "unknown"}`,
      });
    }
    void check();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!authed) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background">
        <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-ms-4 py-8">
          {successFlash && (
            <div
              className="success-banner mb-4 w-full rounded-2xl border border-success/40 bg-success/10 p-ms-3.5 text-success shadow-lg shadow-success/10 sm:p-ms-5 dark:text-success"
              role="status"
              aria-live="polite"
            >
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-ms-3 sm:gap-ms-4">
                <div className="success-check-badge flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/20 ring-1 ring-success/40 sm:h-12 sm:w-12">
                  <CheckCircle2 className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-ms-sm font-semibold leading-snug sm:text-ms-base">
                    Masuk pegawai berhasil
                  </div>
                  <div className="truncate text-ms-xs opacity-80 sm:text-ms-sm">Memuat daftar tugas…</div>
                </div>
              </div>
            </div>
          )}
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <Package className="h-7 w-7 text-primary" />
            </div>
            <div className="text-ms-lg font-semibold tracking-tight">MCM Storage</div>
            <div className="text-ms-xs text-muted-foreground">Portal Tugas Pegawai</div>
          </div>
          <div className="w-full rounded-2xl border bg-card p-ms-6 shadow-lg shadow-black/5">
            <div className="mb-1 flex items-center gap-ms-2 text-ms-base font-semibold">
              <Lock className="h-4 w-4 text-primary" /> Verifikasi PIN
            </div>
            <p className="mb-5 text-ms-xs leading-relaxed text-muted-foreground">
              Masukkan PIN dari pemilik untuk membuka daftar barang yang harus disiapkan.
            </p>
            {peekStatus.state === "checking" && (
              <div
                className="mb-3 flex items-center gap-ms-2 rounded-md border border-muted bg-muted/30 px-ms-3 py-ms-2 text-ms-2xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memeriksa status link tugas…
              </div>
            )}
            {peekStatus.state === "ok" && (
              <div
                className="mb-3 rounded-md border border-success/40 bg-success/5 px-ms-3 py-ms-2 text-ms-2xs text-success dark:text-success"
                role="status"
              >
                <div className="flex items-start gap-ms-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold truncate">
                      Link tugas valid{peekStatus.title ? ` · ${peekStatus.title}` : ""}
                    </div>
                    {peekStatus.expiresAt && (
                      <div className="opacity-80">
                        Berlaku sampai{" "}
                        {new Date(peekStatus.expiresAt).toLocaleString("id-ID", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {(peekStatus.state === "not_found" ||
              peekStatus.state === "expired" ||
              peekStatus.state === "closed" ||
              peekStatus.state === "rate_limited" ||
              peekStatus.state === "network") && (
              <div
                className={
                  "mb-3 rounded-md border px-ms-3 py-ms-2 text-ms-2xs leading-relaxed " +
                  (peekStatus.state === "rate_limited" || peekStatus.state === "network"
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : "border-warning/40 bg-warning/5 text-warning dark:text-warning")
                }
                role="alert"
              >
                <div className="flex items-start gap-ms-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0">
                    {peekStatus.state === "not_found" && (
                      <>
                        <div className="font-semibold">Link tugas tidak ditemukan</div>
                        <div className="mt-0.5 opacity-90">
                          Pastikan URL tidak terpotong, atau minta pemilik mengirim link baru.
                        </div>
                      </>
                    )}
                    {peekStatus.state === "expired" && (
                      <>
                        <div className="font-semibold">Link tugas sudah kedaluwarsa</div>
                        <div className="mt-0.5 opacity-90">
                          {peekStatus.expiresAt
                            ? `Kedaluwarsa pada ${new Date(peekStatus.expiresAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}. `
                            : ""}
                          Minta pemilik mengirim link / PIN baru.
                        </div>
                      </>
                    )}
                    {peekStatus.state === "closed" && (
                      <>
                        <div className="font-semibold">
                          {peekStatus.status === "cancelled"
                            ? "Tugas dibatalkan pemilik"
                            : "Tugas sudah ditutup"}
                        </div>
                        <div className="mt-0.5 opacity-90">
                          {peekStatus.status === "cancelled"
                            ? "Pemilik membatalkan tugas ini sebelum selesai."
                            : "Tugas ini sudah ditandai selesai oleh pemilik."}
                        </div>
                      </>
                    )}
                    {peekStatus.state === "rate_limited" && (
                      <>
                        <div className="font-semibold">Akses sementara dikunci</div>
                        <div className="mt-0.5 opacity-90">
                          Terlalu banyak PIN salah. Coba lagi dalam{" "}
                          {Math.floor(peekStatus.retryAfter / 60)} menit{" "}
                          {peekStatus.retryAfter % 60} detik.
                        </div>
                      </>
                    )}
                    {peekStatus.state === "network" && (
                      <>
                        <div className="font-semibold">Tidak bisa memeriksa status link</div>
                        <div className="mt-0.5 opacity-90">{peekStatus.message}</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
            {lastError && !isLocked && (
              <div
                className={
                  "mb-3 rounded-md border px-ms-3 py-ms-2 text-ms-2xs leading-relaxed " +
                  (lastError.kind === "bad_pin"
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : lastError.kind === "expired" ||
                        lastError.kind === "closed" ||
                        lastError.kind === "not_found"
                      ? "border-warning/40 bg-warning/5 text-warning dark:text-warning"
                      : "border-destructive/40 bg-destructive/5 text-destructive")
                }
                role="alert"
              >
                <div className="flex items-start gap-ms-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold">{lastError.message}</div>
                    {lastError.detail && (
                      <div className="mt-0.5 break-words opacity-80">{lastError.detail}</div>
                    )}
                    {lastError.ref && (
                      <div className="mt-1.5 font-mono text-ms-2xs opacity-70">
                        Kode referensi: <span className="font-semibold">{lastError.ref}</span>
                        <button
                          type="button"
                          className="ml-2 rounded border px-ms-2 py-0.5 text-ms-2xs hover:bg-background/80"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(lastError.ref ?? "");
                              toast.success("Kode referensi disalin");
                            } catch {
                              toast.error("Gagal menyalin");
                            }
                          }}
                        >
                          Salin
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {(isLocked || attempts > 0) && (
              <div
                className={
                  "mb-4 grid grid-cols-2 gap-ms-2 rounded-lg border p-ms-2 text-center " +
                  (isLocked
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-warning/40 bg-warning/5")
                }
              >
                <div>
                  <div className="text-ms-2xs uppercase tracking-wider text-muted-foreground">
                    Sisa percobaan
                  </div>
                  <div
                    className={
                      "mt-0.5 text-ms-xl font-bold tabular-nums " +
                      (isLocked
                        ? "text-destructive"
                        : attemptsLeft <= 1
                          ? "text-destructive"
                          : "text-warning dark:text-warning")
                    }
                  >
                    {attemptsLeft}
                    <span className="text-ms-xs font-normal text-muted-foreground">
                      {" "}
                      / {MAX_ATTEMPTS}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-ms-2xs uppercase tracking-wider text-muted-foreground">
                    Tunggu
                  </div>
                  <div
                    className={
                      "mt-0.5 text-ms-xl font-bold tabular-nums " +
                      (isLocked ? "text-destructive" : "text-muted-foreground/60")
                    }
                  >
                    {isLocked
                      ? `${Math.floor(lockedSecondsLeft / 60)}:${String(lockedSecondsLeft % 60).padStart(2, "0")}`
                      : "—"}
                  </div>
                </div>
              </div>
            )}
            {sessionJustExpired && !isLocked && (
              <div
                className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-ms-3 text-warning dark:text-warning"
                role="alert"
              >
                <div className="flex items-start gap-ms-2">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-ms-xs font-semibold">Sesi PIN sudah berakhir</div>
                    <div className="mt-0.5 text-ms-2xs opacity-90">
                      Masukkan PIN lagi untuk melanjutkan tugas yang tadi.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSessionJustExpired(false);
                    focusPinInput();
                  }}
                  className="mt-2 inline-flex h-9 w-full items-center justify-center gap-ms-2 rounded-lg bg-warning text-ms-xs font-semibold text-white shadow-sm transition hover:bg-warning"
                >
                  <Lock className="h-4 w-4" /> Re-login sekarang
                </button>
              </div>
            )}
            <input
              ref={pinInputRef}
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                if (lastError?.kind === "bad_pin") setLastError(null);
                if (sessionJustExpired) setSessionJustExpired(false);
              }}
              placeholder="••••••"
              disabled={isLocked}
              className="mb-3 h-14 w-full rounded-lg border bg-background px-ms-3 text-center text-ms-2xl tracking-[0.6em] tabular-nums text-foreground shadow-inner placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />
            <button
              type="button"
              disabled={
                pin.length < 4 ||
                loading ||
                isLocked ||
                peekStatus.state === "not_found" ||
                peekStatus.state === "expired" ||
                peekStatus.state === "closed"
              }
              onClick={() => fetchTask(pin)}
              className="inline-flex h-11 w-full items-center justify-center gap-ms-2 rounded-lg bg-primary text-ms-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isLocked ? `Terkunci ${lockedClock} lagi` : "Buka Tugas"}
            </button>
            {isLocked && (
              <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-ms-3 py-ms-2 text-ms-2xs leading-relaxed text-destructive">
                <div className="font-semibold">Terkunci {lockedClock} lagi</div>
                <div className="mt-0.5 opacity-90">
                  Terlalu banyak PIN salah. Anda bisa mencoba lagi setelah hitungan mundur selesai.
                </div>
              </div>
            )}
            {!isLocked && justUnlocked && (
              <div className="mt-3 rounded-md border border-success/40 bg-success/5 px-ms-3 py-ms-2 text-ms-2xs leading-relaxed text-success dark:text-success">
                <div className="font-semibold">Kunci dibuka — silakan coba lagi</div>
                <div className="mt-0.5 opacity-90">
                  Pastikan PIN dari pemilik benar. Anda punya {MAX_ATTEMPTS} percobaan baru.
                </div>
              </div>
            )}
            {!isLocked && attempts > 0 && (
              <div className="mt-3 rounded-md border border-warning/40 bg-warning/5 px-ms-3 py-ms-2 text-ms-2xs leading-relaxed text-warning dark:text-warning">
                <div className="font-semibold">Silakan coba lagi</div>
                <div className="mt-0.5 opacity-90">
                  Sisa percobaan: <b>{attemptsLeft}</b> dari {MAX_ATTEMPTS}. Setelah {MAX_ATTEMPTS}{" "}
                  kali salah, input akan dikunci {LOCK_SECONDS} detik.
                </div>
              </div>
            )}
            {(isLocked || attempts > 0) && (
              <button
                type="button"
                onClick={async () => {
                  const pageUrl =
                    typeof window !== "undefined" ? window.location.href.split("#")[0] : "";
                  const text = [
                    "Halo, saya pegawai untuk tugas penyiapan barang.",
                    isLocked
                      ? "Akses saya terkunci karena PIN salah beberapa kali."
                      : "Sepertinya PIN yang saya terima tidak cocok / sudah kedaluwarsa.",
                    "Mohon kirim ulang PIN tugas yang baru.",
                    "",
                    `Link tugas: ${pageUrl}`,
                  ].join("\n");
                  const res = await shareToWhatsApp({
                    text,
                    title: "Minta PIN baru",
                    url: pageUrl,
                  });
                  notifyShareResult(res);
                }}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-ms-1.5 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 px-ms-3 text-ms-xs font-semibold text-[#128C7E] transition hover:bg-[#25D366]/20 dark:text-[#25D366]"
              >
                <MessageCircle className="h-4 w-4" /> Minta PIN baru ke pemilik
              </button>
            )}
            {(isLocked || attempts > 0) && (
              <p className="mt-2 text-center text-ms-2xs leading-relaxed text-muted-foreground">
                Tombol ini hanya membuka MCM dengan pesan siap kirim — pembatasan percobaan tetap
                berlaku sampai hitungan mundur selesai.
              </p>
            )}
            <div className="mt-4 flex items-center justify-center gap-ms-1.5 text-ms-2xs text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Koneksi terenkripsi · Sesi terbatas waktu
            </div>
          </div>
          <div className="mt-6 text-ms-2xs text-muted-foreground">© MCM Storage</div>
        </div>
      </div>
    );
  }

  const totalItems = items.length;
  const completedItems = items.filter((i) => (i.submissions?.length ?? 0) > 0).length;
  const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  // Tugas ditutup / PIN diubah pemilik → layar khusus
  if (closedReason) {
    const copy =
      closedReason === "pin_changed"
        ? {
            title: "PIN diperbarui pemilik",
            body: "PIN tugas baru saja diubah. Silakan minta PIN terbaru ke pemilik lalu masukkan kembali.",
          }
        : closedReason === "expired"
          ? {
              title: "Tugas sudah kedaluwarsa",
              body: "Masa berlaku link tugas sudah habis. Minta pemilik mengirim link / PIN baru.",
            }
          : closedReason === "closed"
            ? {
                title: "Tugas sudah ditutup pemilik",
                body: "Tugas ini telah ditandai selesai atau dibatalkan oleh pemilik. Hubungi pemilik bila masih perlu mengisi.",
              }
            : {
                title: "Tugas tidak ditemukan",
                body: "Link tugas tidak ditemukan. Pastikan link tidak terpotong atau minta link baru ke pemilik.",
              };
    return (
      <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background">
        <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-ms-4 py-8">
          <div className="w-full rounded-2xl border bg-card p-ms-6 text-center shadow-lg shadow-black/5">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-warning/10 text-warning ring-1 ring-warning/30">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="text-ms-base font-semibold">{copy.title}</div>
            <p className="mt-1 text-ms-xs leading-relaxed text-muted-foreground">{copy.body}</p>
            <button
              type="button"
              onClick={() => {
                runWhenIdle(() => {
                  setClosedReason(null);
                  goBackToPin();
                });
              }}
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-ms-1.5 rounded-lg border bg-background text-ms-xs font-semibold transition hover:bg-muted"
            >
              <ArrowLeft className="h-4 w-4" /> Kembali ke halaman PIN
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background pb-12">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-ms-2 px-ms-4 py-ms-3">
          <button
            type="button"
            onClick={() => runWhenIdle(goBackToPin)}
            aria-label="Kembali ke halaman awal"
            className="flex h-9 w-9 items-center justify-center rounded-lg border bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-ms-2xs font-medium uppercase tracking-wider text-muted-foreground">
              MCM Storage
            </div>
            <div className="truncate text-ms-sm font-semibold">Tugas Penyiapan Barang</div>
          </div>
          <SyncBadge
            status={rtStatus}
            lastSyncAt={lastSyncAt}
            tick={syncTick}
            onRefresh={() => {
              void manualResync();
            }}
          />
        </div>
        {sessionExpiresAt && (
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-ms-2 px-ms-4 pb-2 text-ms-2xs">
            <span
              className={
                "inline-flex items-center gap-ms-1 rounded-full border px-ms-2 py-0.5 font-medium tabular-nums " +
                (sessionSecondsLeft <= 60
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : sessionSecondsLeft <= 300
                    ? "border-warning/30 bg-warning/10 text-warning dark:text-warning"
                    : "border-border bg-muted/60 text-muted-foreground")
              }
              title={`Sesi PIN aktif sampai ${new Date(sessionExpiresAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`}
            >
              <Clock className="h-3 w-3" />
              Sesi {sessionClock}
            </span>
            {sessionSecondsLeft <= 300 ? (
              <button
                type="button"
                onClick={reloginNow}
                className={
                  "inline-flex items-center gap-ms-1 rounded-full px-ms-2.5 py-0.5 text-ms-2xs font-semibold text-white shadow-sm transition " +
                  (sessionSecondsLeft <= 60
                    ? "bg-destructive hover:bg-destructive/90"
                    : "bg-warning hover:bg-warning")
                }
                title="Masuk ulang dengan PIN sekarang"
              >
                <Lock className="h-3 w-3" />
                Re-login sekarang
              </button>
            ) : (
              <span className="text-muted-foreground">
                {`Re-login pada ${new Date(sessionExpiresAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`}
              </span>
            )}
          </div>
        )}
        {deferredReload.pending && (
          <div
            role="status"
            aria-live="polite"
            className="mx-auto max-w-2xl px-ms-4 pb-2"
          >
            <div className="flex items-start gap-ms-2 rounded-lg border border-warning/40 bg-warning/10 px-ms-3 py-ms-2 text-ms-2xs leading-snug text-warning dark:text-warning">
              <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Versi baru menunggu — refresh ditahan</div>
                <div className="opacity-90">
                  {deferredReload.reason === "worker-portal"
                    ? "Portal pegawai aktif: halaman tidak akan me-refresh sendiri agar draft foto & sesi PIN tetap aman."
                    : deferredReload.reason === "app-busy"
                      ? "Aplikasi sedang sibuk (foto / edit / unggah): refresh akan berjalan otomatis setelah proses selesai."
                      : "Anda sedang mengetik: refresh akan berjalan otomatis setelah selesai."}
                  {deferredReload.since && (
                    <span className="ml-1 opacity-70">
                      · ditahan {deferredTick} dtk
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="mx-auto max-w-2xl px-ms-3 pt-4">
        <div className="mb-4 overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b bg-gradient-to-r from-primary/5 to-transparent px-ms-4 py-ms-3">
            <div className="text-ms-base font-semibold leading-tight">{task?.title}</div>
            {task?.note && (
              <div className="mt-1 text-ms-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {task.note}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 divide-x text-center">
            <div className="px-ms-3 py-ms-2.5">
              <div className="text-ms-2xs uppercase tracking-wider text-muted-foreground">
                {totalItems > 0 ? "Progres" : "Tugas satuan"}
              </div>
              <div className="mt-0.5 text-ms-sm font-semibold tabular-nums">
                {totalItems > 0 ? `${completedItems} / ${totalItems}` : "—"}
              </div>
            </div>
            <div className="flex items-center justify-center gap-ms-1.5 px-ms-3 py-ms-2.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="text-left">
                <div className="text-ms-2xs uppercase tracking-wider text-muted-foreground">
                  Kedaluwarsa
                </div>
                <div className="text-ms-2xs font-medium tabular-nums">
                  {task
                    ? new Date(task.expires_at).toLocaleString("id-ID", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : ""}
                </div>
              </div>
            </div>
          </div>
          <div className="h-1.5 w-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-ms-2 border-t bg-muted/20 px-ms-3 py-ms-2">
            <div className="text-ms-2xs text-muted-foreground">
              {lastSyncAt ? (
                <>
                  Diperbarui {Math.max(0, Math.round((Date.now() - lastSyncAt) / 1000))} dtk lalu
                  <span className="hidden sm:inline">
                    {" "}
                    · {new Date(lastSyncAt).toLocaleTimeString("id-ID")}
                  </span>
                </>
              ) : (
                "Belum ada pembaruan"
              )}
              <span className="ml-1 hidden text-[9px] opacity-60 sm:inline">
                (otomatis tiap 15 dtk)
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                void manualResync();
              }}
              disabled={resyncing}
              className="inline-flex h-7 items-center gap-ms-1 rounded-md border bg-background px-ms-2 text-ms-2xs font-semibold transition hover:bg-muted disabled:opacity-60"
            >
              {resyncing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}{" "}
              Resync sekarang
            </button>
          </div>
        </div>

        {items.length > 0 ? (
          (() => {
            // Kelompokkan per varian berdasar nama tanpa suffix "(n/m)" / "#n".
            const stripSuffix = (s: string) =>
              s.replace(/\s*[\(\[]\s*\d+\s*[\/／of-]\s*\d+\s*[\)\]]\s*$/i, "")
               .replace(/\s*#\s*\d+\s*$/i, "")
               .trim();
            const groups: Array<{ key: string; label: string; category: string | null; entries: Array<{ it: typeof items[number]; idx: number }> }> = [];
            const map = new Map<string, number>();
            items.forEach((it, idx) => {
              const base = stripSuffix(it.name) || it.name;
              const key = `${base}::${it.category ?? ""}`;
              let gi = map.get(key);
              if (gi === undefined) {
                gi = groups.length;
                map.set(key, gi);
                groups.push({ key, label: base, category: it.category ?? null, entries: [] });
              }
              groups[gi].entries.push({ it, idx });
            });
            return (
              <div className="space-ms-4">
                <div className="-mb-2 flex flex-wrap items-center justify-end gap-ms-2">
                  <label className="inline-flex items-center gap-ms-1 text-ms-2xs text-muted-foreground">
                    <span>Urutkan:</span>
                    <select
                      value={sortMode}
                      onChange={(e) => setSortMode(e.target.value as SortMode)}
                      className="rounded-md border bg-background px-1.5 py-1 text-ms-2xs text-foreground"
                    >
                      <option value="index">Nomor urut</option>
                      <option value="pending-first">Belum siap dulu</option>
                      <option value="done-first">Sudah siap dulu</option>
                      <option value="weight-desc">Berat terbesar</option>
                      <option value="weight-asc">Berat terkecil</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<string, boolean> = {};
                      groups.forEach((g) => { next[g.key] = true; });
                      setCollapsedGroups(next);
                    }}
                    className="rounded-md border bg-background px-ms-2 py-1 text-ms-2xs text-muted-foreground hover:bg-muted"
                  >
                    Tutup semua
                  </button>
                  <button
                    type="button"
                    onClick={() => setCollapsedGroups({})}
                    className="rounded-md border bg-background px-ms-2 py-1 text-ms-2xs text-muted-foreground hover:bg-muted"
                  >
                    Buka semua
                  </button>
                </div>
                {groups.map((g) => {
                  const totalReq = g.entries.reduce((s, e) => s + (Number(e.it.qty_requested) || 0), 0);
                  const doneCount = g.entries.filter((e) => (e.it.submissions?.length ?? 0) > 0).length;
                  const totalCount = g.entries.length;
                  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
                  const doneReq = g.entries
                    .filter((e) => (e.it.submissions?.length ?? 0) > 0)
                    .reduce((s, e) => s + (Number(e.it.qty_requested) || 0), 0);
                  const allDone = doneCount === totalCount && totalCount > 0;
                  const unit = shortUnitLabel(g.entries[0].it.name, g.entries[0].it.unit_label);
                  const collapsed = !!collapsedGroups[g.key];
                  const sortedEntries = (() => {
                    const arr = [...g.entries];
                    const isDone = (e: typeof arr[number]) => (e.it.submissions?.length ?? 0) > 0;
                    const wt = (e: typeof arr[number]) => Number(e.it.qty_requested) || 0;
                    switch (sortMode) {
                      case "pending-first":
                        arr.sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || a.idx - b.idx);
                        break;
                      case "done-first":
                        arr.sort((a, b) => Number(isDone(b)) - Number(isDone(a)) || a.idx - b.idx);
                        break;
                      case "weight-desc":
                        arr.sort((a, b) => wt(b) - wt(a) || a.idx - b.idx);
                        break;
                      case "weight-asc":
                        arr.sort((a, b) => wt(a) - wt(b) || a.idx - b.idx);
                        break;
                      default:
                        arr.sort((a, b) => a.idx - b.idx);
                    }
                    return arr;
                  })();
                  return (
                    <section key={g.key} className="space-ms-2">
                      <div
                        className="sticky top-0 z-[1] -mx-1 rounded-md border bg-background/95 px-ms-2 py-1.5 backdrop-blur cursor-pointer"
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedGroup(g)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedGroup(g);
                          }
                        }}
                        aria-label={`Buka ringkasan detail ${g.label}`}
                      >
                        <div className="flex items-center justify-between gap-ms-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-ms-1 truncate text-ms-xs font-semibold">
                              <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`} aria-hidden="true" />
                              <span className="truncate">{g.label}</span>
                            </div>
                            {g.category && (
                              <div className="truncate text-ms-2xs uppercase tracking-wide text-muted-foreground">{g.category}</div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-ms-2">
                            <div className="flex items-baseline gap-ms-1 tabular-nums">
                              <span className={`text-ms-sm font-semibold ${allDone ? "text-success dark:text-success" : "text-foreground"}`}>
                                {doneCount}/{totalCount}
                              </span>
                              <span className="text-ms-2xs font-medium uppercase tracking-wide text-muted-foreground">
                                paket
                              </span>
                              <span className={`ml-1 rounded-md px-1.5 py-0.5 text-ms-2xs font-semibold tabular-nums ${allDone ? "bg-success/15 text-success dark:text-success" : "bg-primary/10 text-primary"}`}>
                                {pct}%
                              </span>
                              <Info className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCollapsedGroups((prev) => ({ ...prev, [g.key]: !prev[g.key] }));
                              }}
                              aria-expanded={!collapsed}
                              aria-label={collapsed ? `Buka ${g.label}` : `Tutup ${g.label}`}
                              className="rounded-md p-ms-1 hover:bg-muted"
                            >
                              <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`} aria-hidden />
                            </button>
                          </div>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full transition-[width] duration-300 ease-out ${allDone ? "bg-success" : "bg-primary"}`}
                            style={{ width: `${pct}%` }}
                            aria-hidden
                          />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-ms-2xs tabular-nums text-muted-foreground">
                          <span className="inline-flex items-baseline gap-ms-1">
                            <span className="uppercase tracking-wide">Siap</span>
                            <span className={`font-semibold ${allDone ? "text-success dark:text-success" : "text-foreground"}`}>{doneReq}</span>
                            <span>{unit}</span>
                          </span>
                          <span className="inline-flex items-baseline gap-ms-1">
                            <span className="uppercase tracking-wide">Diminta</span>
                            <span className="font-semibold text-foreground">{totalReq}</span>
                            <span>{unit}</span>
                          </span>
                          <span className="inline-flex items-baseline gap-ms-1">
                            <span className="uppercase tracking-wide">Sisa</span>
                            <span className="font-semibold text-foreground">{Math.max(0, totalReq - doneReq)}</span>
                            <span>{unit}</span>
                            <span className="ml-1">· {totalCount - doneCount} paket</span>
                          </span>
                        </div>
                      </div>
                      <div
                        className="grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out"
                        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div className="grid grid-cols-2 gap-ms-2 sm:gap-ms-3">
                            {sortedEntries.map(({ it, idx }) => (
                              <WorkerSectionBoundary
                                key={it.id}
                                renderFallback={(error, reset) => (
                                  <div className="col-span-2 rounded-xl border border-destructive/40 bg-destructive/5 p-ms-4 text-ms-sm text-destructive">
                                    <div className="flex items-start gap-ms-2">
                                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                      <div className="min-w-0">
                                        <div className="font-semibold">Item #{idx + 1} gagal ditampilkan</div>
                                        <div className="mt-1 text-ms-xs leading-relaxed opacity-90">
                                          PIN sudah benar dan tugas berhasil dibuka, tetapi ada data item yang tidak
                                          valid. Item lain tetap bisa dibuka.
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-ms-2">
                                          <button
                                            type="button"
                                            onClick={reset}
                                            className="rounded-md border border-destructive/40 bg-background px-ms-3 py-1.5 text-ms-xs font-semibold text-destructive hover:bg-destructive/10"
                                          >
                                            🔄 Coba lagi
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (typeof window !== "undefined") window.location.reload();
                                            }}
                                            className="rounded-md border border-destructive/40 bg-background px-ms-3 py-1.5 text-ms-xs text-destructive hover:bg-destructive/10"
                                          >
                                            ↻ Muat ulang halaman
                                          </button>
                                        </div>
                                        <details className="mt-2 text-ms-2xs">
                                          <summary className="cursor-pointer">Detail teknis</summary>
                                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/70 p-ms-2 font-mono">
                                            {error.message}
                                          </pre>
                                        </details>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              >
                                <ItemCard
                                  index={idx + 1}
                                  item={it}
                                  token={token}
                                  pin={pinRef.current}
                                  isStale={!!staleItemIds[it.id]}
                                  onAcknowledgeStale={() => clearStale(it.id)}
                                  onSubmitted={handleItemSubmitted}
                                  autoOpen={autoOpen.id === it.id ? autoOpen.tick : 0}
                                  onActivityChange={setWorkerOperationActive}
                                  onKeepAlive={keepWorkerSessionAlive}
                                />
                              </WorkerSectionBoundary>
                            ))}
                          </div>
                        </div>
                      </div>
                    </section>
                  );
                })}
                <Dialog open={!!selectedGroup} onOpenChange={(open) => { if (!open) setSelectedGroup(null); }}>
                  {selectedGroup && (
                    <DialogContent className="max-w-md">
                      {(() => {
                        const sg = groups.find((x) => x.key === selectedGroup.key) || selectedGroup;
                        const totalReq = sg.entries.reduce((s, e) => s + (Number(e.it.qty_requested) || 0), 0);
                        const doneCount = sg.entries.filter((e) => (e.it.submissions?.length ?? 0) > 0).length;
                        const totalCount = sg.entries.length;
                        const doneReq = sg.entries
                          .filter((e) => (e.it.submissions?.length ?? 0) > 0)
                          .reduce((s, e) => s + (Number(e.it.qty_requested) || 0), 0);
                        const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
                        const allDone = doneCount === totalCount && totalCount > 0;
                        const unit = shortUnitLabel(sg.entries[0].it.name, sg.entries[0].it.unit_label);
                        return (
                          <>
                            <DialogHeader>
                              <DialogTitle>{sg.label}</DialogTitle>
                              {sg.category && (
                                <DialogDescription>{sg.category}</DialogDescription>
                              )}
                            </DialogHeader>
                            <div className="space-ms-4">
                              <div className="grid grid-cols-3 gap-ms-2">
                                <div className="rounded-md border p-ms-2 text-center">
                                  <div className="text-ms-2xs uppercase tracking-wide text-muted-foreground">Diminta</div>
                                  <div className="text-ms-base font-semibold tabular-nums">{totalReq}</div>
                                  <div className="text-ms-2xs text-muted-foreground">{totalCount} paket</div>
                                </div>
                                <div className="rounded-md border p-ms-2 text-center">
                                  <div className="text-ms-2xs uppercase tracking-wide text-muted-foreground">Siap</div>
                                  <div className={`text-ms-base font-semibold tabular-nums ${allDone ? "text-success dark:text-success" : "text-foreground"}`}>{doneReq}</div>
                                  <div className="text-ms-2xs text-muted-foreground">{doneCount} paket</div>
                                </div>
                                <div className="rounded-md border p-ms-2 text-center">
                                  <div className="text-ms-2xs uppercase tracking-wide text-muted-foreground">Sisa</div>
                                  <div className="text-ms-base font-semibold tabular-nums text-foreground">{Math.max(0, totalReq - doneReq)}</div>
                                  <div className="text-ms-2xs text-muted-foreground">{totalCount - doneCount} paket</div>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <div className="flex justify-between text-ms-xs">
                                  <span className="text-muted-foreground">Progres</span>
                                  <span className="font-semibold tabular-nums">{doneCount}/{totalCount} · {pct}%</span>
                                </div>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                  <div className={`h-full rounded-full ${allDone ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                              <div className="max-h-60 overflow-y-auto rounded-md border">
                                <div className="divide-y">
                                  {sg.entries.map(({ it, idx }) => {
                                    const done = (it.submissions?.length ?? 0) > 0;
                                    return (
                                      <div key={it.id} className="flex items-center justify-between p-ms-2 text-ms-sm">
                                        <div className="flex items-center gap-ms-2 min-w-0">
                                          <div className={`h-2 w-2 shrink-0 rounded-full ${done ? "bg-success" : "bg-muted-foreground"}`} />
                                          <span className="truncate">{it.name}</span>
                                        </div>
                                        <div className="shrink-0 tabular-nums text-muted-foreground">
                                          {it.qty_requested} {unit}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </DialogContent>
                  )}
                </Dialog>
              </div>
            );
          })()
        ) : (
          <div className="grid grid-cols-2 gap-ms-2 sm:gap-ms-3">
            {
            (loading ? (
              <div className="col-span-2 space-ms-3" aria-busy="true" aria-label="Memuat daftar tugas">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-ms-3 rounded-xl border bg-card p-ms-4">
                    <div className="flex items-start gap-ms-3">
                      <Skeleton className="h-14 w-14 rounded-lg" />
                      <div className="flex-1 space-ms-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                    <Skeleton className="h-9 w-full rounded-md" />
                  </div>
                ))}
              </div>
            ) : (
              // Empty-state minimalis: kalau tidak ada tugas satuan, jangan
              // menghalangi pandangan. Panel "Permintaan Paket" (RequestSection
              // di bawah) mungkin masih punya pekerjaan aktif, jadi kita
              // cukup pasang strip tipis alih-alih blok besar "tidak ada tugas".
              <div className="col-span-2 flex items-center gap-ms-2 rounded-lg border border-dashed bg-muted/30 px-ms-3 py-ms-2 text-ms-2xs text-muted-foreground">
                <Inbox className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Belum ada tugas satuan.{" "}
                  <span className="text-foreground">
                    Lanjutkan lewat Permintaan Paket di bawah bila tersedia.
                  </span>
                </span>
              </div>
            ))
            }
          </div>
        )}

        <WorkerSectionBoundary
          renderFallback={(error, reset) => (
            <div className="mt-6 rounded-xl border border-warning/40 bg-warning/5 p-ms-4 text-ms-sm text-warning dark:text-warning">
              <div className="flex items-start gap-ms-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold">Paket request gagal ditampilkan</div>
                  <div className="mt-1 text-ms-xs leading-relaxed opacity-90">
                    Daftar tugas utama tetap bisa dipakai. Detail error disiapkan agar masalah data
                    paket bisa diperbaiki.
                  </div>
                  <div className="mt-2 flex flex-wrap gap-ms-2">
                    <button
                      type="button"
                      onClick={reset}
                      className="rounded-md border border-warning/40 bg-background px-ms-3 py-1.5 text-ms-xs font-semibold text-warning hover:bg-warning/10"
                    >
                      🔄 Coba lagi
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof window !== "undefined") window.location.reload();
                      }}
                      className="rounded-md border border-warning/40 bg-background px-ms-3 py-1.5 text-ms-xs text-warning hover:bg-warning/10"
                    >
                      ↻ Muat ulang halaman
                    </button>
                  </div>
                  <details className="mt-2 text-ms-2xs">
                    <summary className="cursor-pointer">Detail teknis</summary>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/70 p-ms-2 font-mono">
                      {error.message}
                    </pre>
                  </details>
                </div>
              </div>
            </div>
          )}
        >
          <RequestSection
            token={token}
            pin={pinRef.current}
            onActivityChange={setWorkerOperationActive}
            onKeepAlive={keepWorkerSessionAlive}
          />
        </WorkerSectionBoundary>

        <div className="mt-6 text-center text-ms-2xs text-muted-foreground">
          Tetap aman · Jangan bagikan PIN ke siapa pun
        </div>
      </div>
    </div>
  );
}

function ItemCard({
  item,
  index,
  token,
  pin,
  isStale,
  onAcknowledgeStale,
  onSubmitted,
  autoOpen,
  onActivityChange,
  onKeepAlive,
}: {
  item: PrepItemRow;
  index: number;
  token: string;
  pin: string;
  isStale?: boolean;
  onAcknowledgeStale?: () => void;
  onSubmitted: (justDoneId: string) => void;
  /** Berubah (tick > 0) ketika parent minta kartu ini otomatis terbuka. */
  autoOpen?: number;
  onActivityChange: (active: boolean) => void;
  onKeepAlive: () => void;
}) {
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [justOk, setJustOk] = useState<Set<Blob>>(new Set());
  const [uploads, setUploads] = useState<PhotoUploadStatus[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const [locUrl, setLocUrl] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy?: number | null } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refSigned, setRefSigned] = useState<string | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const fallbackPickerReleaseRef = useRef<null | (() => void)>(null);
  const [helpKind, setHelpKind] = useState<MediaKind | null>(null);
  // Persist expanded state per (token,item) di sessionStorage. Alasan:
  // pada Android WebView, native photo picker kadang me-recycle WebView
  // (OOM reclaim) — halaman tugas di-mount ulang dari nol dan auto-reauth
  // via PIN tersimpan. Tanpa persist, panel item yang tadi terbuka
  // "kembali ke awal", user harus tap header lagi + tap Galeri lagi.
  const expandedKey = `mcm.prep.item.expanded:${token}:${item.id}`;
  const [expanded, setExpandedRaw] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && window.sessionStorage.getItem(expandedKey) === "1";
    } catch {
      return false;
    }
  });
  const setExpanded: typeof setExpandedRaw = (v) => {
    setExpandedRaw((prev) => {
      const next = typeof v === "function" ? (v as (p: boolean) => boolean)(prev) : v;
      try {
        if (typeof window !== "undefined") {
          if (next) window.sessionStorage.setItem(expandedKey, "1");
          else window.sessionStorage.removeItem(expandedKey);
        }
      } catch { /* ignore quota */ }
      return next;
    });
  };
  const [manualCoordOpen, setManualCoordOpen] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  // Antrian foto galeri yang akan dibuka di PhotoEditor satu per satu.
  const editQueueRef = useRef<number[]>([]);
  const photosRef = useRef<StagedPhoto[]>([]);
  // useLayoutEffect: sinkronisasi ref harus terjadi sinkron setelah commit,
  // SEBELUM setTimeout(0) callback macrotask. Kalau pakai useEffect biasa,
  // sesekali PhotoEditor tidak muncul karena `photosRef.current` masih
  // stale saat `openEditForIdx` dipanggil via setTimeout.
  useLayoutEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => {
    photosRef.current.forEach(revokePhotoPreview);
  }, []);
  useEffect(() => () => {
    fallbackPickerReleaseRef.current?.();
  }, []);
  async function openFallbackPhotoPicker(inputRef: RefObject<HTMLInputElement | null>) {
    fallbackPickerReleaseRef.current?.();
    onActivityChange(true);
    const endNativePicker = await beginPortalNativePicker();
    let released = false;
    let timer: number | null = null;
    const release = () => {
      if (released) return;
      released = true;
      if (timer !== null) window.clearTimeout(timer);
      endNativePicker();
      onActivityChange(false);
      onKeepAlive();
      if (fallbackPickerReleaseRef.current === release) fallbackPickerReleaseRef.current = null;
    };
    timer = window.setTimeout(release, 120_000);
    fallbackPickerReleaseRef.current = release;
    if (inputRef.current) inputRef.current.click();
    else release();
  }
  function openEditForIdx(i: number) {
    const p = photosRef.current[i];
    if (!p) {
      // Fallback: kalau ref belum sempat ter-update (race pasca await
      // async yang memanggil setPhotos di frame yang sama), coba lagi
      // di microtask berikutnya sekali. Kalau masih kosong, diamkan —
      // artinya photo memang tidak ada.
      queueMicrotask(() => {
        const retry = photosRef.current[i];
        if (!retry) return;
        setEditingIdx(i);
        setEditorSrc(retry.dataUrl);
        setEditorOpen(true);
      });
      return;
    }
    setEditingIdx(i);
    setEditorSrc(p.dataUrl);
    setEditorOpen(true);
  }
  function tryOpenEditForIdx(i: number): boolean {
    const p = photosRef.current[i];
    if (!p) return false;
    setEditingIdx(i);
    setEditorSrc(p.dataUrl);
    setEditorOpen(true);
    return true;
  }
  function advanceEditQueue() {
    const q = editQueueRef.current;
    if (q.length === 0) {
      setEditingIdx(null);
      setEditorOpen(false);
      return;
    }
    const nextIdx = q.shift()!;
    // Tunggu 1 tick supaya setPhotos yang barusan sudah menyebar ke photosRef.
    setTimeout(() => openEditForIdx(nextIdx), 0);
  }
  // Status kirim per-item yang ditampilkan jelas di header kartu:
  // idle (belum pernah tekan Kirim), sending, success, failed.
  const [sendStatus, setSendStatus] = useState<
    | { kind: "idle" }
    | { kind: "sending"; phase: "upload" | "submit" }
    | { kind: "success"; at: number; count: number }
    | { kind: "failed"; error: string }
  >({ kind: "idle" });

  useEffect(() => {
    if (!editorOpen) return;
    onKeepAlive();
    onActivityChange(true);
    return () => onActivityChange(false);
  }, [editorOpen, onActivityChange, onKeepAlive]);

  async function withPhotoActivity<T>(fn: () => Promise<T>): Promise<T> {
    onKeepAlive();
    onActivityChange(true);
    try {
      return await fn();
    } finally {
      onKeepAlive();
      onActivityChange(false);
    }
  }

  useEffect(() => {
    signedUrl(item.ref_photo_path, 60 * 60 * 24 * 7, publicSupabase).then(setRefSigned);
  }, [item.ref_photo_path]);

  // Draft foto persisten: bertahan lintas refresh & pindah tab.
  const draftKey = itemDraftKey(token, item.id);
  const draftLoadedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const blobs = await loadDraftPhotos(draftKey);
        if (cancelled) return;
        if (blobs.length > 0) {
          const staged = await Promise.all(blobs.map((b) => stageFile(b)));
          if (!cancelled) {
            setPhotos(staged);
            // Buka sekali saat draft tersimpan dimuat, supaya user langsung
            // lihat foto yang belum sempat terkirim. Setelah itu, expand
            // sepenuhnya dikontrol tap user — tidak akan buka-tutup sendiri.
            setExpanded(true);
          }
        }
      } catch {
        /* abaikan draft rusak */
      } finally {
        draftLoadedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftKey]);
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    void saveDraftPhotos(
      draftKey,
      photos.map((p) => p.blob),
    );
  }, [photos, draftKey]);

  async function pickCamera() {
    onKeepAlive();
    onActivityChange(true);
    const endNativePicker = await beginPortalNativePicker();
    try {
      const nativePhoto = await captureNativeCameraPhoto();
      if (nativePhoto === "cancelled") return;
      if (nativePhoto !== "fallback") {
        await stageOne(nativePhoto, true);
        return;
      }
    } catch (err) {
      toast.error("Kamera native gagal, membuka kamera browser…", {
        description: (err as Error).message || undefined,
      });
    } finally {
      endNativePicker();
      onActivityChange(false);
      onKeepAlive();
    }
    const state = await queryCameraPermission();
    if (state === "denied") {
      toast.error(permissionToastMessage("camera", "denied"), {
        action: { label: "Panduan", onClick: () => setHelpKind("camera") },
      });
      setHelpKind("camera");
      return;
    }
    await openFallbackPhotoPicker(cameraRef);
  }
  async function pickGallery() {
    onKeepAlive();
    onActivityChange(true);
    const endNativePicker = await beginPortalNativePicker();
    try {
      const nativePhotos = await pickNativeGalleryPhotos();
      if (nativePhotos === "cancelled") return;
      if (nativePhotos !== "fallback") {
        await stageGalleryFiles(nativePhotos);
        return;
      }
    } catch (err) {
      toast.error("Galeri native gagal, membuka galeri browser…", {
        description: (err as Error).message || undefined,
      });
    } finally {
      endNativePicker();
      onActivityChange(false);
      onKeepAlive();
    }
    // Web tidak menyediakan Permissions API khusus untuk galeri; tetap
    // buka file picker, kalau kosong user bisa klik panduan di bawah.
    await openFallbackPhotoPicker(galleryRef);
  }

  function triggerAutoGps() {
    if (!gps && !locUrl && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setGps({ lat: latitude, lng: longitude });
          setLocUrl(`https://www.google.com/maps?q=${latitude},${longitude}`);
        },
        () => {
          /* abaikan */
        },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    }
  }
  function markSuccess(blob: Blob) {
    setJustOk((s) => {
      const n = new Set(s);
      n.add(blob);
      return n;
    });
    setTimeout(
      () =>
        setJustOk((s) => {
          const n = new Set(s);
          n.delete(blob);
          return n;
        }),
      1500,
    );
  }
  async function stageOne(f: File, openEditor: boolean): Promise<StagedPhoto | null> {
    return withPhotoActivity(async () => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPending((p) => [...p, { id, status: "loading", name: f.name || "foto", file: f }]);
      try {
        const staged = await stageFile(f);
        setPending((p) => p.filter((x) => x.id !== id));
        setPhotos((prev) => {
          if (openEditor) setEditingIdx(prev.length);
          return [...prev, staged];
        });
        markSuccess(staged.blob);
        if (openEditor) {
          setEditorSrc(staged.dataUrl);
          setEditorOpen(true);
        }
        triggerAutoGps();
        return staged;
      } catch (err) {
        const msg = (err as Error).message || "Gagal membaca foto";
        setPending((p) => p.map((x) => (x.id === id ? { ...x, status: "error", error: msg } : x)));
        toast.error("Gagal memuat foto: " + msg);
        return null;
      }
    });
  }
  async function retryPending(id: string) {
    const entry = pending.find((x) => x.id === id);
    if (!entry?.file) return;
    setPending((p) =>
      p.map((x) => (x.id === id ? { ...x, status: "loading", error: undefined } : x)),
    );
    try {
      const staged = await withPhotoActivity(() => stageFile(entry.file!));
      setPending((p) => p.filter((x) => x.id !== id));
      setPhotos((prev) => [...prev, staged]);
      markSuccess(staged.blob);
    } catch (err) {
      const msg = (err as Error).message || "Gagal membaca foto";
      setPending((p) => p.map((x) => (x.id === id ? { ...x, status: "error", error: msg } : x)));
    }
  }
  function dismissPending(id: string) {
    setPending((p) => p.filter((x) => x.id !== id));
  }
  async function onCameraFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    try {
      if (!f) return;
      await stageOne(f, true);
    } finally {
      fallbackPickerReleaseRef.current?.();
    }
  }
  async function onGalleryFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    try {
      if (files.length === 0) return;
      await stageGalleryFiles(files);
    } finally {
      fallbackPickerReleaseRef.current?.();
    }
  }
  async function stageGalleryFiles(files: File[]) {
    if (files.length === 0) return;
    const beforeLen = photosRef.current.length;
    const results = await Promise.all(files.map((f) => stageOne(f, false)));
    const okCount = results.filter(Boolean).length;
    if (okCount === 0) return;
    // Setelah semua foto ter-stage, buka PhotoEditor untuk tiap foto baru
    // secara berurutan. Pakai photosRef supaya index-nya akurat setelah
    // state selesai flush.
    const len = await waitForPhotosRefLength(photosRef, beforeLen + okCount);
    const startIdx = Math.max(0, len - okCount);
    const idxs = Array.from({ length: okCount }, (_, i) => startIdx + i);
    editQueueRef.current = idxs.slice(1);
    if (!tryOpenEditForIdx(idxs[0])) {
      toast.success(`${okCount} foto masuk. Ketuk foto untuk edit.`);
    }
  }

  function takeLocation() {
    if (gpsLoading) return;
    setGpsLoading(true);
    requestGeolocation(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setGps({ lat: latitude, lng: longitude, accuracy });
        setLocUrl(`https://www.google.com/maps?q=${latitude},${longitude}`);
      },
      { retry: () => takeLocation(), onSettled: () => setGpsLoading(false) },
    );
  }

  async function submit() {
    if (isStale) {
      toast.error("Item baru saja diubah admin. Tinjau ulang sebelum kirim.");
      return;
    }
    if (photos.length === 0) {
      toast.error("Wajib lampirkan foto bukti timbangan/barang");
      setSendStatus({ kind: "failed", error: "Belum ada foto bukti" });
      return;
    }
    if (locUrl) {
      if (locUrl.length > 2048) {
        toast.error("URL lokasi terlalu panjang");
        setSendStatus({ kind: "failed", error: "URL lokasi terlalu panjang" });
        return;
      }
      if (!/^https:\/\//i.test(locUrl)) {
        toast.error("URL lokasi harus diawali https://");
        setSendStatus({ kind: "failed", error: "URL lokasi harus diawali https://" });
        return;
      }
    }
    onKeepAlive();
    onActivityChange(true);
    setBusy(true);
    setSendStatus({ kind: "sending", phase: "upload" });
    // Preserve status "done" (dengan path yang sudah terunggah) dari
    // attempt sebelumnya, supaya klik "Coba lagi" hanya mengulang foto yang
    // gagal — sama sekali tidak menghitung ulang kuota storage untuk foto
    // yang sudah sukses.
    const state: PhotoUploadStatus[] =
      uploads.length === photos.length
        ? uploads.map((u) => (u.status === "done" ? u : { status: "idle" as const }))
        : photos.map(() => ({ status: "idle" as const }));
    setUploads(state);
    try {
      // Upload hanya index yang belum "done".
      for (let i = 0; i < photos.length; i++) {
        if (state[i].status === "done") continue;
        state[i] = { status: "uploading" };
        setUploads(state.slice());
        let uploadedPath: string | null = null;
        try {
          uploadedPath = await uploadPrepPhoto(
            token,
            item.id,
            photos[i].blob,
            "jpg",
            publicSupabase,
          );
        } catch (uerr) {
          const msg = (uerr as Error).message || "Gagal mengunggah";
          state[i] = { status: "error", error: msg };
          setUploads(state.slice());
          continue;
        }
        if (!uploadedPath) {
          state[i] = { status: "error", error: "Server menolak upload" };
          setUploads(state.slice());
          continue;
        }
        state[i] = { status: "done", path: uploadedPath };
        setUploads(state.slice());
      }
      const failed = state.filter((u) => u.status === "error").length;
      if (failed > 0) {
        toast.error(
          `${failed} foto gagal unggah. Tekan "Coba lagi" pada foto yang gagal — foto yang sudah sukses tidak akan diulang.`,
        );
        setSendStatus({
          kind: "failed",
          error: `${failed} foto gagal unggah`,
        });
        setBusy(false);
        return;
      }
      setSendStatus({ kind: "sending", phase: "submit" });
      const uploaded = state.map((u) =>
        u.status === "done" ? u.path : "",
      );
      const args = {
        _token: token,
        _pin: pin,
        _task_item_id: item.id,
        _photo_path: uploaded[0],
        _photo_paths: uploaded,
        _location_url: locUrl || null,
        _gps_lat: gps?.lat ?? null,
        _gps_lng: gps?.lng ?? null,
        _note: note || null,
        _qty_reported: null,
        _expected_updated_at: item.updated_at ?? null,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (publicSupabase.rpc as any)("prep_submit", args);
      if (error) throw error;
      const res = data as {
        ok: boolean;
        error?: string;
        available?: number;
        requested?: number;
        deducted?: number;
        current_updated_at?: string;
      };
      if (!res?.ok) {
        if (res?.error === "item_changed") {
          toast.error("Item baru saja diubah admin. Periksa kembali sebelum kirim.");
          onSubmitted(item.id); // muat ulang dari server
          return;
        }
        const msg =
          res?.error === "insufficient_stock"
            ? `Stok gudang tidak cukup (tersedia ${res.available}, diminta ${res.requested})`
            : res?.error === "item_not_found"
              ? "Barang tidak ditemukan di gudang"
              : res?.error === "bad_pin"
                ? "PIN salah"
                : res?.error === "task_exhausted"
                  ? "Link ini sudah dipakai untuk 1 paket. Minta link + PIN baru ke admin."
                  : res?.error || "submit_failed";
        throw new Error(msg);
      }
      toast.success(
        `Terkirim ${uploaded.length} foto. Stok gudang dikurangi ${formatQtyShort(res.deducted ?? item.qty_requested, item.unit_label, item.name)}`,
      );
      setSendStatus({ kind: "success", at: Date.now(), count: uploaded.length });
      setPhotos([]);
      setLocUrl("");
      setGps(null);
      setNote("");
      setUploads([]);
      void clearDraftPhotos(draftKey);
      onSubmitted(item.id);
    } catch (e) {
      const msg = (e as Error).message || "Gagal kirim";
      toast.error("Gagal kirim: " + msg);
      setSendStatus({ kind: "failed", error: msg });
    } finally {
      setBusy(false);
      onKeepAlive();
      onActivityChange(false);
    }
  }

  const isDone = (item.submissions?.length ?? 0) > 0;
  const hasDraft = photos.length > 0 || pending.length > 0;
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Auto-collapse HANYA sekali per mount, dan hanya pada transisi asli
  // "belum → sudah". silentRefresh berkala kadang mengembalikan blip
  // (submissions kosong sesaat lalu terisi lagi); tanpa guard ini panel
  // yang baru dibuka user akan tertutup sendiri setiap kali blip
  // membalik status false→true.
  const prevIsDoneRef = useRef<boolean | null>(null);
  const hasAutoCollapsedRef = useRef(false);
  useEffect(() => {
    const prev = prevIsDoneRef.current;
    prevIsDoneRef.current = isDone;
    if (hasAutoCollapsedRef.current) return;
    if (prev === false && isDone === true) {
      hasAutoCollapsedRef.current = true;
      const t = setTimeout(() => setExpanded(false), 900);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isDone]);
  // Auto-open bila parent minta (mis. paket ini adalah "berikutnya" setelah
  // paket lain di varian sama baru saja selesai). Trigger memakai tick agar
  // efek jalan tiap kali parent mengaktifkan lagi.
  useEffect(() => {
    if (!autoOpen) return;
    setExpanded(true);
    // Tunggu satu frame supaya konten sudah render, baru scroll ke tengah.
    const rafId = requestAnimationFrame(() => {
      try {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        cardRef.current?.scrollIntoView();
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [autoOpen]);
  return (
    <div
      ref={cardRef}
      className={`overflow-hidden rounded-2xl border bg-card shadow-sm transition ${isStale ? "border-warning/60 ring-1 ring-warning/30" : isDone ? "border-success/30" : ""}`}
    >
      {isStale && (
        <div className="flex items-start gap-ms-2 border-b border-warning/30 bg-warning/10 px-ms-3 py-ms-2 text-ms-2xs leading-relaxed text-warning dark:text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1">
            <b>Item ini baru saja diubah admin.</b> Periksa kembali sebelum kirim.
          </div>
          <button
            type="button"
            onClick={onAcknowledgeStale}
            className="inline-flex h-7 items-center gap-ms-1 rounded-md border border-warning/40 bg-background px-ms-2 text-ms-2xs font-semibold text-warning hover:bg-warning/10 dark:text-warning"
          >
            <RefreshCw className="h-3 w-3" /> Lanjutkan
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="block w-full text-left"
      >
        <div className="flex items-center justify-between gap-ms-2 border-b bg-muted/30 px-ms-2.5 py-1.5">
          <div className="text-ms-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            #{index}
          </div>
          <div className="flex items-center gap-ms-1.5">
            {sendStatus.kind === "sending" ? (
              <span className="inline-flex items-center gap-ms-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-ms-2xs font-semibold text-primary">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                {sendStatus.phase === "upload" ? "Mengunggah…" : "Mengirim…"}
              </span>
            ) : sendStatus.kind === "failed" && !isDone ? (
              <span className="inline-flex items-center gap-ms-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-ms-2xs font-semibold text-destructive">
                <AlertCircle className="h-3 w-3" aria-hidden="true" /> Gagal
              </span>
            ) : isDone || sendStatus.kind === "success" ? (
              <StatusBadge size="xs" variant="siap">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Berhasil
              </StatusBadge>
            ) : hasDraft ? (
              <span className="inline-flex items-center gap-ms-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-ms-2xs font-semibold text-warning dark:text-warning">
                <Clock className="h-3 w-3" aria-hidden="true" /> Menunggu {photos.length + pending.length}
              </span>
            ) : (
              <StatusBadge size="xs" variant="menunggu">Belum</StatusBadge>
            )}
            <ChevronDown
              className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </div>
        </div>
        <div className="p-ms-2.5">
          <div className="flex items-start gap-ms-2">
            {refSigned ? (
              <img src={refSigned} alt="" className="h-14 w-14 shrink-0 rounded-lg border object-cover" />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border bg-muted text-ms-2xs text-muted-foreground">
                No img
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-ms-sm font-semibold leading-tight">{item.name}</div>
              <div className="mt-0.5 truncate text-ms-2xs text-muted-foreground">{item.category ?? "—"}</div>
              <div className="mt-1 flex flex-wrap gap-ms-1">
                <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-ms-2xs font-medium text-primary">
                  {formatQtyShort(item.qty_requested, item.unit_label, item.name)}
                </span>
                {(item.qty_prepared ?? 0) > 0 && (
                  <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-ms-2xs font-medium text-muted-foreground">
                    Siap {item.qty_prepared}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </button>
      {expanded && (
      <div className="border-t px-ms-3 pb-3 pt-3">
        {sendStatus.kind === "sending" && (
          <div
            role="status"
            aria-live="polite"
            className="mb-2 flex items-center gap-ms-2 rounded-lg border border-primary/40 bg-primary/5 px-ms-3 py-ms-2 text-ms-xs font-medium text-primary"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {sendStatus.phase === "upload"
              ? "Mengunggah foto ke server…"
              : "Mengirim ke gudang…"}
          </div>
        )}
        {sendStatus.kind === "failed" && !isDone && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-2 flex items-start gap-ms-2 rounded-lg border border-destructive/40 bg-destructive/5 px-ms-3 py-ms-2 text-ms-xs leading-relaxed text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Gagal kirim</div>
              <div className="mt-0.5 break-words opacity-90">{sendStatus.error}</div>
            </div>
          </div>
        )}
        {sendStatus.kind === "success" && !isDone && (
          <div
            role="status"
            aria-live="polite"
            className="mb-2 flex items-start gap-ms-2 rounded-lg border border-success/40 bg-success/5 px-ms-3 py-ms-2 text-ms-xs leading-relaxed text-success dark:text-success"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Berhasil terkirim</div>
              <div className="mt-0.5 opacity-90">
                {sendStatus.count} foto sudah masuk folder <b>{item.name}</b>.
              </div>
            </div>
          </div>
        )}
        {item.note && (
          <div className="mb-2 rounded-md bg-muted/50 px-ms-2 py-1.5 text-ms-2xs text-muted-foreground">
            Catatan: {item.note}
          </div>
        )}
        {isDone && !isStale ? (
          <div className="mt-3 rounded-lg border border-success/40 bg-success/5 p-ms-3 text-ms-2xs leading-relaxed text-success dark:text-success">
            <div className="flex items-center gap-ms-1.5 font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Sudah terkirim
            </div>
            <div className="mt-1 text-success/80 dark:text-success/80">
              Foto & link sudah masuk folder <b>{item.name}</b>. Kolom
              penyiapan disembunyikan supaya tidak dikirim dua kali.
            </div>
          </div>
        ) : (
          <>
            <PhotoTileGrid
          photos={photos}
          pending={pending}
          justOk={justOk}
          uploads={uploads}
          onEdit={(i) => {
            setEditingIdx(i);
            setEditorSrc(photos[i].dataUrl);
            setEditorOpen(true);
          }}
          onRemove={(i) => setPhotos((prev) => {
            revokePhotoPreview(prev[i]);
            return prev.filter((_, j) => j !== i);
          })}
          onRetry={(id) => {
            void retryPending(id);
          }}
          onDismiss={dismissPending}
          onClearAll={() => {
            photos.forEach(revokePhotoPreview);
            setPhotos([]);
            setPending([]);
          }}
          onRetryUpload={(i) => {
            // Tandai foto ini idle supaya submit() mengulang HANYA foto
            // ini; foto lain yang sudah "done" tetap dipertahankan.
            setUploads((prev) =>
              prev.map((u, j) => (j === i ? { status: "idle" } : u)),
            );
            void submit();
          }}
          onRetryAllUploads={() => {
            void submit();
          }}
          onMerge={async () => {
            if (photos.length < 2) return;
            try {
              const merged = await mergeStagedPhotos(photos);
              photos.forEach(revokePhotoPreview);
              setPhotos([merged]);
              // Buka editor langsung supaya bisa tambah teks / panah.
              editQueueRef.current = [];
              setTimeout(() => openEditForIdx(0), 0);
            } catch (err) {
              toast.error("Gagal gabung foto: " + ((err as Error).message || "unknown"));
            }
          }}
        />
        <div className="mt-3 grid grid-cols-2 gap-ms-2">
          <button aria-label="Kamera"
            type="button"
            onClick={pickCamera}
            className="inline-flex h-11 items-center justify-center gap-ms-1.5 rounded-lg border bg-background text-ms-xs font-medium transition hover:bg-muted"
          >
            <Camera className="h-4 w-4" /> {photos.length ? "Tambah Kamera" : "Kamera"}
          </button>
          <button
            type="button"
            onClick={pickGallery}
            className="inline-flex h-11 items-center justify-center gap-ms-1.5 rounded-lg border bg-background text-ms-xs font-medium transition hover:bg-muted"
          >
            <ImageIcon className="h-4 w-4" /> {photos.length ? "Tambah Galeri" : "Galeri"}
          </button>
        </div>
        <p className="mt-1 text-ms-2xs text-muted-foreground">
          Bisa pilih beberapa foto sekaligus dari galeri.
        </p>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onCameraFile}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onGalleryFiles}
        />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-ms-2xs">
          <button
            type="button"
            onClick={() => setHelpKind("camera")}
            className="inline-flex items-center gap-ms-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <HelpCircle className="h-3 w-3" /> Kamera tidak bisa dibuka?
          </button>
          <button
            type="button"
            onClick={() => setHelpKind("gallery")}
            className="inline-flex items-center gap-ms-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <HelpCircle className="h-3 w-3" /> Galeri tidak muncul?
          </button>
        </div>

        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-ms-2.5 text-ms-2xs leading-relaxed text-warning dark:text-warning">
          Siapkan{" "}
          <b>
            {formatQtyShort(item.qty_requested, item.unit_label, item.name)}
          </b>{" "}
          sesuai instruksi pemilik. Setelah foto + lokasi terkirim, stok gudang otomatis berkurang
          sebanyak itu — Anda tidak perlu mengisi angka apa pun.
        </div>

        <div className="mt-3 grid grid-cols-1 gap-ms-2">
          <input
            value={locUrl}
            onChange={(e) => setLocUrl(e.target.value)}
            placeholder="Link Google Maps (opsional)"
            className="h-10 w-full rounded-lg border bg-background px-ms-3 text-ms-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="grid grid-cols-2 gap-ms-2">
            <button
              type="button"
              onClick={takeLocation}
              disabled={gpsLoading}
              aria-busy={gpsLoading}
              aria-live="polite"
              className="inline-flex h-10 w-full items-center justify-center gap-ms-1 rounded-lg border bg-background px-ms-3 text-ms-xs font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
            >
              {gpsLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  <span className="truncate">Mengambil lokasi…</span>
                </>
              ) : gps ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                  <span className="truncate">Lokasi terisi</span>
                </>
              ) : (
                <>
                  <MapPin className="h-4 w-4" aria-hidden /> GPS otomatis
                </>
              )}
            </button>
            <button
              type="button"
              title="Tempel link dari papan klip"
              onClick={async () => {
                try {
                  if (!navigator.clipboard?.readText) {
                    toast.error("Clipboard tidak tersedia — tempel manual di kolom");
                    return;
                  }
                  const text = (await navigator.clipboard.readText()).trim();
                  if (!text) { toast.error("Papan klip kosong"); return; }
                  if (!/^https:\/\//i.test(text)) {
                    toast.error("Isi papan klip bukan URL https://");
                    return;
                  }
                  setLocUrl(text.slice(0, 2048));
                  toast.success("Link ditempel");
                } catch {
                  toast.error("Gagal membaca papan klip");
                }
              }}
              className="inline-flex h-10 w-full items-center justify-center gap-ms-1 rounded-lg border bg-background px-ms-3 text-ms-xs font-medium transition hover:bg-muted"
            >
              <ClipboardPaste className="h-4 w-4" /> Tempel
            </button>
          </div>
          {gps && (
            <div className="text-ms-2xs text-muted-foreground tabular-nums">
              {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
              {gps.accuracy ? ` · ±${Math.round(gps.accuracy)} m` : null}
            </div>
          )}
          <MiniMapPreview locUrl={locUrl} gps={gps} className="h-40" />
          <div>

            <button
              type="button"
              onClick={() => setManualCoordOpen((v) => !v)}
              className="inline-flex items-center gap-ms-1 text-ms-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              <MapPin className="h-3 w-3" /> {manualCoordOpen ? "Tutup" : "Isi koordinat manual"} (bila GPS ditolak)
            </button>
            {manualCoordOpen && (
              <div className="mt-2 flex flex-wrap gap-ms-2">
                <input
                  inputMode="decimal"
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  placeholder="Lat (mis. -7.257)"
                  className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-ms-3 text-ms-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <input
                  inputMode="decimal"
                  value={manualLng}
                  onChange={(e) => setManualLng(e.target.value)}
                  placeholder="Lng (mis. 112.752)"
                  className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-ms-3 text-ms-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => {
                    const lat = Number.parseFloat(manualLat.replace(",", "."));
                    const lng = Number.parseFloat(manualLng.replace(",", "."));
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                      toast.error("Lat/Lng tidak valid");
                      return;
                    }
                    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                      toast.error("Lat harus -90..90, Lng harus -180..180");
                      return;
                    }
                    setGps({ lat, lng });
                    setLocUrl(`https://www.google.com/maps?q=${lat},${lng}`);
                    toast.success("Koordinat manual dipakai");
                  }}
                  className="inline-flex h-10 items-center gap-ms-1 rounded-lg border bg-background px-ms-3 text-ms-xs font-medium transition hover:bg-muted"
                >
                  Pakai
                </button>
              </div>
            )}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan (opsional)"
            className="h-10 w-full rounded-lg border bg-background px-ms-3 text-ms-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="mt-3 inline-flex h-11 w-full items-center justify-center gap-ms-1.5 rounded-lg bg-primary text-ms-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {busy && uploads.some((u) => u.status !== "idle")
            ? `Mengunggah ${uploads.filter((u) => u.status === "done").length}/${photos.length}…`
            : "Kirim"}
        </button>
          </>
        )}

        {item.submissions.length > 0 && (
          <div className="mt-3 border-t pt-2">
            <div className="mb-1.5 text-ms-2xs font-medium uppercase tracking-wider text-muted-foreground">
              Sudah terkirim ({item.submissions.length})
            </div>
            <div className="flex gap-ms-1 overflow-x-auto">
              {item.submissions.map((s) => (
                <SubmissionThumb key={s.id} path={s.photo_path} />
              ))}
            </div>
          </div>
        )}

        {editorOpen && editorSrc && (
          <PhotoEditor
            src={editorSrc}
            onCancel={() => {
              // Batalkan seluruh antrian edit galeri saat pengguna menutup editor.
              editQueueRef.current = [];
              setEditingIdx(null);
              setEditorOpen(false);
            }}
            onSave={(blob, dataUrl) => {
              setPhotos((prev) => {
                if (editingIdx !== null && editingIdx >= 0 && editingIdx < prev.length) {
                  const next = prev.slice();
                  revokePhotoPreview(next[editingIdx]);
                  next[editingIdx] = buildStagedPhoto(dataUrl, blob);
                  return next;
                }
                return [...prev, buildStagedPhoto(dataUrl, blob)];
              });
              onKeepAlive();
              // Lanjut ke foto berikutnya dalam antrian galeri (kalau ada),
              // atau tutup editor.
              advanceEditQueue();
            }}
          />
        )}
        <PermissionHelpDialog
          open={helpKind !== null}
          kind={helpKind ?? "camera"}
          onClose={() => setHelpKind(null)}
        />
      </div>
      )}
    </div>
  );
}

function SubmissionThumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    signedUrl(path, 60 * 60, publicSupabase).then(setUrl);
  }, [path]);
  if (!url) return <div className="h-12 w-12 shrink-0 rounded border bg-muted" />;
  return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded border object-cover" />;
}

// Item foto yang sedang / gagal dimuat oleh stageFile. Dipisah dari
// StagedPhoto agar tetap kompatibel dengan draft store & flow submit.
type PendingPhoto = {
  id: string;
  status: "loading" | "error";
  name: string;
  error?: string;
  file?: File;
};

// Status upload per-foto saat submit. `idle` = belum antre, `uploading` =
// sedang diunggah, `done` = sukses, `error` = gagal dengan pesan.
export type PhotoUploadStatus =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "done"; path: string }
  | { status: "error"; error: string };

// Grid tile foto dengan indikator status per foto (loading / sukses / gagal).
// Dipakai oleh ItemCard maupun RequestForm supaya perilaku UI konsisten.
function PhotoTileGrid({
  photos,
  pending,
  justOk,
  uploads,
  onEdit,
  onRemove,
  onRetry,
  onDismiss,
  onClearAll,
  onRetryUpload,
  onRetryAllUploads,
  onMerge,
}: {
  photos: StagedPhotoT[];
  pending: PendingPhoto[];
  justOk: Set<Blob>;
  uploads?: PhotoUploadStatus[];
  onEdit: (i: number) => void;
  onRemove: (i: number) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onRetryUpload?: (i: number) => void;
  onRetryAllUploads?: () => void;
  onMerge?: () => void;
}) {
  const total = photos.length + pending.length;
  // Lacak ubin yang <img> onError → tampilkan overlay "Foto rusak" agar
  // pegawai tidak melihat noise dan bisa langsung hapus & foto ulang.
  const [brokenIdx, setBrokenIdx] = useState<Set<number>>(new Set());
  useEffect(() => {
    // Reset saat set foto berubah (indeks bergeser setelah hapus/tambah).
    setBrokenIdx(new Set());
  }, [photos]);
  if (total === 0) return null;
  const loadingCount = pending.filter((p) => p.status === "loading").length;
  const errorCount = pending.filter((p) => p.status === "error").length;
  const uploadingCount = uploads?.filter((u) => u.status === "uploading").length ?? 0;
  const uploadDoneCount = uploads?.filter((u) => u.status === "done").length ?? 0;
  const uploadErrCount = uploads?.filter((u) => u.status === "error").length ?? 0;
  const isUploading = uploads !== undefined && uploads.some((u) => u.status !== "idle");
  return (
    <div className="mt-3 space-ms-2">
      <div className="flex flex-wrap items-center justify-between gap-ms-2 text-ms-2xs text-muted-foreground">
        <span aria-live="polite">
          {photos.length} foto siap
          {loadingCount > 0 ? ` · ${loadingCount} memuat…` : ""}
          {errorCount > 0 ? ` · ${errorCount} gagal` : ""}
          {isUploading ? ` · ${uploadDoneCount}/${photos.length} terunggah` : ""}
          {uploadingCount > 0 ? " · mengunggah…" : ""}
          {uploadErrCount > 0 ? ` · ${uploadErrCount} gagal unggah` : ""}
        </span>
        <div className="flex items-center gap-ms-1.5">
          {uploadErrCount > 0 && !isUploading && onRetryAllUploads && (
            <button
              type="button"
              onClick={onRetryAllUploads}
              className="inline-flex h-7 items-center gap-ms-1 rounded-md border border-primary/40 bg-primary/5 px-ms-2 text-ms-2xs font-medium text-primary hover:bg-primary/10"
            >
              <RefreshCw className="h-3 w-3" /> Coba lagi {uploadErrCount} foto gagal
            </button>
          )}
          {onMerge && photos.length >= 2 && !isUploading && (
            <button
              type="button"
              onClick={onMerge}
              className="inline-flex h-7 items-center gap-ms-1 rounded-md border border-primary/40 bg-primary/5 px-ms-2 text-ms-2xs font-medium text-primary hover:bg-primary/10"
              title="Gabungkan semua foto menjadi satu"
            >
              <Layers className="h-3 w-3" /> Gabung foto
            </button>
          )}
          <button
            type="button"
            onClick={onClearAll}
            disabled={isUploading}
            className="inline-flex h-7 items-center gap-ms-1 rounded-md border border-destructive/40 px-ms-2 text-ms-2xs text-destructive hover:bg-destructive/10"
          >
            Hapus semua
          </button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-ms-1.5">
        {photos.map((p, i) => {
          const ok = justOk.has(p.blob);
          const up = uploads?.[i]?.status ?? "idle";
          const upErr =
            uploads?.[i]?.status === "error" ? (uploads[i] as { error: string }).error : undefined;
          return (
            <div
              key={`ok-${i}`}
              className={`group relative aspect-square overflow-hidden rounded-md border bg-muted transition ${
                up === "error"
                  ? "ring-2 ring-destructive"
                  : up === "uploading"
                    ? "ring-2 ring-primary"
                    : up === "done"
                      ? "ring-2 ring-success"
                      : ok
                        ? "ring-2 ring-success"
                        : ""
              }`}
            >
              <img
                src={p.dataUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={() =>
                  setBrokenIdx((prev) => {
                    if (prev.has(i)) return prev;
                    const next = new Set(prev);
                    next.add(i);
                    return next;
                  })
                }
              />
              {brokenIdx.has(i) && (
                <div
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-ms-1 bg-destructive/90 p-ms-2 text-center text-white"
                  role="alert"
                  aria-live="polite"
                >
                  <AlertCircle className="h-5 w-5" aria-hidden />
                  <div className="text-ms-2xs font-semibold leading-tight">
                    Foto rusak
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    className="mt-0.5 inline-flex h-6 items-center gap-ms-1 rounded bg-white/95 px-1.5 text-ms-2xs font-semibold text-destructive"
                  >
                    <Trash2 className="h-3 w-3" /> Hapus & foto ulang
                  </button>
                </div>
              )}
              <div className="absolute left-1 top-1 z-10 rounded bg-black/55 px-1 py-0.5 text-[9px] font-medium text-white shadow">
                {p.originalFormat && p.originalFormat !== p.format
                  ? `${p.originalFormat} → ${p.format}`
                  : p.format}{" "}
                · {formatFileSize(p.size)}
              </div>
              {up === "uploading" && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-ms-1 bg-black/55 text-white"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  <div className="text-ms-2xs font-medium">Mengunggah…</div>
                </div>
              )}
              {up === "done" && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-success/25">
                  <div
                    className="rounded-full bg-success p-ms-1 text-white shadow"
                    aria-label="Foto terunggah"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                </div>
              )}
              {up === "error" && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-destructive/85 p-ms-1 text-center text-white"
                  role="status"
                  aria-live="polite"
                >
                  <AlertCircle className="h-5 w-5" aria-hidden />
                  <div className="text-ms-2xs font-semibold">Gagal unggah</div>
                  <div className="line-clamp-2 text-[9px] opacity-90">{upErr}</div>
                  {onRetryUpload && !isUploading && (
                    <button
                      type="button"
                      onClick={() => onRetryUpload(i)}
                      className="mt-0.5 inline-flex h-5 items-center gap-0.5 rounded bg-white/90 px-1.5 text-[9px] font-semibold text-destructive"
                    >
                      <RefreshCw className="h-2.5 w-2.5" /> Coba lagi
                    </button>
                  )}
                </div>
              )}
              {ok && up === "idle" && (
                <div
                  className="pointer-events-none absolute right-1 top-1 rounded-full bg-success p-0.5 text-white shadow"
                  aria-label="Foto siap"
                >
                  <CheckCircle2 className="h-3 w-3" />
                </div>
              )}
              {up !== "uploading" && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-ms-1.5 bg-gradient-to-t from-black/70 via-black/40 to-transparent p-ms-1.5">
                  <button
                    type="button"
                    onClick={() => onEdit(i)}
                    disabled={isUploading}
                    aria-label="Edit foto"
                    className="pointer-events-auto inline-flex h-8 min-w-[3.5rem] items-center justify-center gap-ms-1 rounded-md bg-white/95 px-ms-2 text-ms-2xs font-semibold text-slate-900 shadow ring-1 ring-black/10 active:scale-95 disabled:opacity-50"
                  >
                    <Edit3 className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    disabled={isUploading}
                    aria-label="Hapus foto"
                    className="pointer-events-auto inline-flex h-8 min-w-[3.5rem] items-center justify-center gap-ms-1 rounded-md bg-destructive px-ms-2 text-ms-2xs font-semibold text-destructive-foreground shadow ring-1 ring-black/10 active:scale-95 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Hapus
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {pending.map((p) => (
          <div
            key={`pend-${p.id}`}
            className={`relative flex aspect-square flex-col items-center justify-center gap-ms-1 overflow-hidden rounded-md border p-ms-1.5 text-center text-ms-2xs ${
              p.status === "loading"
                ? "border-primary/40 bg-primary/5 text-primary"
                : "border-destructive/50 bg-destructive/10 text-destructive"
            }`}
            role="status"
            aria-live="polite"
          >
            {p.status === "loading" ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                <div className="line-clamp-2 break-all text-[9px] opacity-80">{p.name}</div>
                <div className="text-[9px] font-medium">Memuat…</div>
              </>
            ) : (
              <>
                <AlertCircle className="h-5 w-5" aria-hidden />
                <div className="line-clamp-2 break-all text-[9px] font-medium">{p.name}</div>
                <div className="line-clamp-2 text-[9px] opacity-80">
                  {p.error || "Gagal membaca foto"}
                </div>
                <div className="mt-0.5 flex items-center gap-ms-1">
                  {p.file && (
                    <button
                      type="button"
                      onClick={() => onRetry(p.id)}
                      className="inline-flex h-5 items-center gap-0.5 rounded bg-destructive/80 px-1.5 text-[9px] font-medium text-white"
                    >
                      <RefreshCw className="h-2.5 w-2.5" /> Coba lagi
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDismiss(p.id)}
                    aria-label="Buang foto gagal"
                    className="inline-flex h-5 w-5 items-center justify-center rounded bg-background/80 text-foreground"
                  >
                    <XIcon className="h-2.5 w-2.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Indikator status sinkron realtime di header halaman pegawai.
// connected: channel SUBSCRIBED dan data ≤ 30 dtk.
// lag: channel SUBSCRIBED tapi data 30–90 dtk lalu (heartbeat masih jalan).
// stale: data > 90 dtk lalu atau channel error/terputus.
function SyncBadge({
  status,
  lastSyncAt,
  tick,
  onRefresh,
}: {
  status: "connecting" | "connected" | "error";
  lastSyncAt: number | null;
  tick: number;
  onRefresh: () => void;
}) {
  void tick; // memaksa re-render tiap detak
  const ageSec = lastSyncAt ? Math.max(0, Math.round((Date.now() - lastSyncAt) / 1000)) : null;
  let kind: "connecting" | "connected" | "lag" | "stale";
  if (status === "connecting" && lastSyncAt == null) kind = "connecting";
  else if (status === "error") kind = "stale";
  else if (ageSec != null && ageSec > 90) kind = "stale";
  else if (ageSec != null && ageSec > 30) kind = "lag";
  else kind = "connected";

  const map = {
    connecting: {
      cls: "bg-muted text-muted-foreground ring-border",
      label: "Menyambung…",
      Icon: Loader2,
      spin: true,
    },
    connected: {
      cls: "bg-success/10 text-success ring-success/20 dark:text-success",
      label: "Sinkron",
      Icon: Wifi,
      spin: false,
    },
    lag: {
      cls: "bg-warning/10 text-warning ring-warning/30 dark:text-warning",
      label: ageSec != null ? `Tertunda ${ageSec}d` : "Tertunda",
      Icon: Wifi,
      spin: false,
    },
    stale: {
      cls: "bg-rose-500/10 text-rose-700 ring-rose-500/30 dark:text-rose-400",
      label: "Tidak sinkron",
      Icon: WifiOff,
      spin: false,
    },
  }[kind];

  const title = lastSyncAt
    ? `Pembaruan terakhir: ${new Date(lastSyncAt).toLocaleTimeString("id-ID")}`
    : "Belum ada pembaruan";

  return (
    <button
      type="button"
      onClick={onRefresh}
      title={title}
      aria-label={`Status sinkron: ${map.label}. Klik untuk muat ulang.`}
      className={`inline-flex items-center gap-ms-1 rounded-full px-ms-2 py-1 text-ms-2xs font-medium ring-1 transition hover:opacity-80 ${map.cls}`}
    >
      <map.Icon className={`h-3 w-3 ${map.spin ? "animate-spin" : ""}`} />
      <span>{map.label}</span>
    </button>
  );
}

// ------------------------------------------------------------------
// REQUEST section: paket multi-produk untuk pegawai
// ------------------------------------------------------------------
type RequestTitleDTO = {
  id: string;
  name: string;
  note: string | null;
  submitted_count: number;
  items: Array<{
    id: string;
    warehouse_item_id: string;
    product_name: string | null;
    target_grams: number;
    unit_label: string | null;
    note: string | null;
  }>;
};

function normalizeRequestTitles(value: unknown): RequestTitleDTO[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((t, titleIdx) => {
    const rawItems = Array.isArray(t.items) ? t.items : [];
    return {
      id: stringOrFallback(t.id, `request-title-${titleIdx}`),
      name: stringOrFallback(t.name, "Paket request"),
      note: stringOrNull(t.note),
      submitted_count: numberOrFallback(t.submitted_count),
      items: rawItems.filter(isRecord).map((i, itemIdx) => ({
        id: stringOrFallback(i.id, `request-item-${titleIdx}-${itemIdx}`),
        warehouse_item_id: stringOrFallback(i.warehouse_item_id, ""),
        product_name: stringOrNull(i.product_name),
        target_grams: numberOrFallback(i.target_grams),
        unit_label: stringOrNull(i.unit_label),
        note: stringOrNull(i.note),
      })),
    };
  });
}

function RequestSection({
  token,
  pin,
  onActivityChange,
  onKeepAlive,
}: {
  token: string;
  pin: string;
  onActivityChange: (active: boolean) => void;
  onKeepAlive: () => void;
}) {
  const [titles, setTitles] = useState<RequestTitleDTO[] | null>(null);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  // Persist panel request yang sedang dibuka. Android WebView bisa me-recreate
  // halaman setelah balik dari Galeri; tanpa ini form request kembali tertutup
  // dan terlihat seperti layar bolak-balik / tidak ada perubahan.
  const openStorageKey = `mcm.prep.request.open:${token}`;
  const [openId, setOpenIdRaw] = useState<string | null>(() => {
    try {
      return typeof window !== "undefined"
        ? window.sessionStorage.getItem(openStorageKey)
        : null;
    } catch {
      return null;
    }
  });
  const setOpenId = (next: string | null) => {
    setOpenIdRaw(next);
    try {
      if (typeof window === "undefined") return;
      if (next) window.sessionStorage.setItem(openStorageKey, next);
      else window.sessionStorage.removeItem(openStorageKey);
    } catch {
      /* ignore quota */
    }
  };

  async function load() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (publicSupabase.rpc as any)("request_list_titles_via_task", {
        _token: token,
        _pin: pin,
      });
      if (error) {
        toast.error("Gagal muat request: " + error.message);
        setTitles((prev) => prev ?? []);
        return;
      }
      const res = data as { ok: boolean; titles?: unknown; owner_user_id?: unknown };
      if (res?.ok) {
        setTitles(normalizeRequestTitles(res.titles));
        setOwnerUserId(stringOrNull(res.owner_user_id));
      } else {
        setTitles([]);
      }
    } catch (e) {
      // Jangan biarkan promise rejection meruntuhkan boundary.
      // eslint-disable-next-line no-console
      console.error("[RequestSection.load]", e);
      toast.error("Gagal muat request: " + ((e as Error)?.message ?? "unknown"));
      setTitles((prev) => prev ?? []);
    }
  }
  useEffect(() => {
    void load();
  }, [token, pin]);

  useEffect(() => {
    if (!titles || !openId) return;
    const stillOpenable = titles.some((t) => t.id === openId && (t.submitted_count ?? 0) <= 0);
    if (!stillOpenable) setOpenId(null);
  }, [titles, openId]);

  if (!titles) return null;
  if (titles.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-ms-2">
        <Package className="h-4 w-4 text-primary" />
        <div className="text-ms-sm font-semibold">Paket Request</div>
        <span className="rounded-full bg-primary/10 px-ms-2 py-0.5 text-ms-2xs font-medium text-primary">
          {titles.length}
        </span>
      </div>
      <div className="space-ms-2">
        {titles.map((t, titleIndex) => {
          let renderedRow: ReactNode;
          try {
            const requestItems = Array.isArray(t.items) ? t.items : [];
            const isDone = (t.submitted_count ?? 0) > 0;
            renderedRow = (
            <div key={t.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
              {isDone ? (
                <div className="flex w-full items-center justify-between px-ms-3 py-ms-2 text-left opacity-75">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-ms-1.5">
                      <div className="truncate text-ms-sm font-semibold">{t.name}</div>
                      <span className="inline-flex shrink-0 items-center gap-ms-1 rounded-full bg-success/15 px-1.5 py-0.5 text-ms-2xs font-semibold text-success ring-1 ring-success/30 dark:text-success">
                        <CheckCircle2 className="h-3 w-3" /> Selesai
                      </span>
                    </div>
                    <div className="truncate text-ms-2xs text-muted-foreground">
                      {requestItems
                        .map(
                          (i) =>
                            `${i.product_name ?? "?"} ${formatQtyShort(i.target_grams, i.unit_label, i.product_name)}`,
                        )
                        .join(" · ") || "Tidak ada item"}
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpenId(openId === t.id ? null : t.id)}
                  className="flex w-full items-center justify-between px-ms-3 py-ms-2 text-left hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ms-sm font-semibold">{t.name}</div>
                    <div className="truncate text-ms-2xs text-muted-foreground">
                      {requestItems
                        .map(
                          (i) =>
                            `${i.product_name ?? "?"} ${formatQtyShort(i.target_grams, i.unit_label, i.product_name)}`,
                        )
                        .join(" · ") || "Tidak ada item"}
                    </div>
                  </div>
                  <span className="ml-2 rounded-md bg-primary px-ms-2 py-1 text-ms-2xs font-semibold text-primary-foreground">
                    {openId === t.id ? "Tutup" : "Siapkan"}
                  </span>
                </button>
              )}
              {openId === t.id && !isDone && (
                <div className="border-t bg-muted/20 p-ms-3">
                  <RequestForm
                    title={t}
                    token={token}
                    pin={pin}
                    ownerUserId={ownerUserId}
                    onDone={() => {
                      setOpenId(null);
                      void load();
                    }}
                    onActivityChange={onActivityChange}
                    onKeepAlive={onKeepAlive}
                  />
                </div>
              )}
            </div>
            );
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error("[RequestSection] render title failed", t?.id, err);
            renderedRow = (
              <div
                key={t?.id ?? `request-title-error-${titleIndex}`}
                className="rounded-xl border border-warning/40 bg-warning/5 px-ms-3 py-ms-2 text-ms-2xs text-warning dark:text-warning"
              >
                Paket &quot;{t?.name ?? "tanpa nama"}&quot; tidak bisa ditampilkan. Muat ulang portal atau hubungi admin.
              </div>
            );
          }
          return renderedRow;
        })}
      </div>
    </div>
  );
}

function RequestForm({
  title,
  token,
  pin,
  ownerUserId,
  onDone,
  onActivityChange,
  onKeepAlive,
}: {
  title: RequestTitleDTO;
  token: string;
  pin: string;
  ownerUserId: string | null;
  onDone: () => void;
  onActivityChange: (active: boolean) => void;
  onKeepAlive: () => void;
}) {
  const [rows, setRows] = useState(
    title.items.map((i) => ({
      warehouse_item_id: i.warehouse_item_id,
      product_name: i.product_name,
      unit_label: i.unit_label,
      actual_grams: String(i.target_grams),
    })),
  );
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [justOk, setJustOk] = useState<Set<Blob>>(new Set());
  const [uploads, setUploads] = useState<PhotoUploadStatus[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const [locUrl, setLocUrl] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy?: number | null } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const fallbackPickerReleaseRef = useRef<null | (() => void)>(null);
  const [helpKind, setHelpKind] = useState<MediaKind | null>(null);
  const [manualCoordOpen, setManualCoordOpen] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");

  useEffect(() => {
    if (!editorOpen) return;
    onKeepAlive();
    onActivityChange(true);
    return () => onActivityChange(false);
  }, [editorOpen, onActivityChange, onKeepAlive]);

  async function withPhotoActivity<T>(fn: () => Promise<T>): Promise<T> {
    onKeepAlive();
    onActivityChange(true);
    try {
      return await fn();
    } finally {
      onKeepAlive();
      onActivityChange(false);
    }
  }

  // Draft foto persisten untuk paket request.
  const draftKey = requestDraftKey(token, title.id);
  // Antrian foto galeri yang dibuka di PhotoEditor satu per satu.
  const editQueueRef = useRef<number[]>([]);
  const photosRef = useRef<StagedPhoto[]>([]);
  // Sama seperti di ItemCard: sinkron pakai useLayoutEffect supaya
  // photosRef selalu segar sebelum setTimeout(0) → openEditForIdx.
  useLayoutEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => {
    photosRef.current.forEach(revokePhotoPreview);
  }, []);
  useEffect(() => () => {
    fallbackPickerReleaseRef.current?.();
  }, []);
  async function openFallbackPhotoPicker(inputRef: RefObject<HTMLInputElement | null>) {
    fallbackPickerReleaseRef.current?.();
    onActivityChange(true);
    const endNativePicker = await beginPortalNativePicker();
    let released = false;
    let timer: number | null = null;
    const release = () => {
      if (released) return;
      released = true;
      if (timer !== null) window.clearTimeout(timer);
      endNativePicker();
      onActivityChange(false);
      onKeepAlive();
      if (fallbackPickerReleaseRef.current === release) fallbackPickerReleaseRef.current = null;
    };
    timer = window.setTimeout(release, 120_000);
    fallbackPickerReleaseRef.current = release;
    if (inputRef.current) inputRef.current.click();
    else release();
  }
  function openEditForIdx(i: number) {
    const p = photosRef.current[i];
    if (!p) {
      queueMicrotask(() => {
        const retry = photosRef.current[i];
        if (!retry) return;
        setEditingIdx(i);
        setEditorSrc(retry.dataUrl);
        setEditorOpen(true);
      });
      return;
    }
    setEditingIdx(i);
    setEditorSrc(p.dataUrl);
    setEditorOpen(true);
  }
  function tryOpenEditForIdx(i: number): boolean {
    const p = photosRef.current[i];
    if (!p) return false;
    setEditingIdx(i);
    setEditorSrc(p.dataUrl);
    setEditorOpen(true);
    return true;
  }
  function advanceEditQueue() {
    const q = editQueueRef.current;
    if (q.length === 0) {
      setEditingIdx(null);
      setEditorOpen(false);
      return;
    }
    const nextIdx = q.shift()!;
    setTimeout(() => openEditForIdx(nextIdx), 0);
  }
  const draftLoadedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const blobs = await loadDraftPhotos(draftKey);
        if (cancelled) return;
        if (blobs.length > 0) {
          const staged = await Promise.all(blobs.map((b) => stageFile(b)));
          if (!cancelled) setPhotos(staged);
        }
      } catch {
        /* abaikan */
      } finally {
        draftLoadedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftKey]);
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    void saveDraftPhotos(
      draftKey,
      photos.map((p) => p.blob),
    );
  }, [photos, draftKey]);

  async function pickCamera() {
    onKeepAlive();
    onActivityChange(true);
    const endNativePicker = await beginPortalNativePicker();
    try {
      const nativePhoto = await captureNativeCameraPhoto();
      if (nativePhoto === "cancelled") return;
      if (nativePhoto !== "fallback") {
        await stageOne(nativePhoto, true);
        return;
      }
    } catch (err) {
      toast.error("Kamera native gagal, membuka kamera browser…", {
        description: (err as Error).message || undefined,
      });
    } finally {
      endNativePicker();
      onActivityChange(false);
      onKeepAlive();
    }
    const state = await queryCameraPermission();
    if (state === "denied") {
      toast.error(permissionToastMessage("camera", "denied"), {
        action: { label: "Panduan", onClick: () => setHelpKind("camera") },
      });
      setHelpKind("camera");
      return;
    }
    await openFallbackPhotoPicker(cameraRef);
  }
  async function pickGallery() {
    onKeepAlive();
    onActivityChange(true);
    const endNativePicker = await beginPortalNativePicker();
    try {
      const nativePhotos = await pickNativeGalleryPhotos();
      if (nativePhotos === "cancelled") return;
      if (nativePhotos !== "fallback") {
        await stageGalleryFiles(nativePhotos);
        return;
      }
    } catch (err) {
      toast.error("Galeri native gagal, membuka galeri browser…", {
        description: (err as Error).message || undefined,
      });
    } finally {
      endNativePicker();
      onActivityChange(false);
      onKeepAlive();
    }
    await openFallbackPhotoPicker(galleryRef);
  }

  function triggerAutoGps() {
    if (!gps && !locUrl && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocUrl(`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 },
      );
    }
  }
  function markSuccess(blob: Blob) {
    setJustOk((s) => {
      const n = new Set(s);
      n.add(blob);
      return n;
    });
    setTimeout(
      () =>
        setJustOk((s) => {
          const n = new Set(s);
          n.delete(blob);
          return n;
        }),
      1500,
    );
  }
  async function stageOne(f: File, openEditor: boolean): Promise<StagedPhoto | null> {
    return withPhotoActivity(async () => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPending((p) => [...p, { id, status: "loading", name: f.name || "foto", file: f }]);
      try {
        const staged = await stageFile(f);
        setPending((p) => p.filter((x) => x.id !== id));
        setPhotos((prev) => {
          if (openEditor) setEditingIdx(prev.length);
          return [...prev, staged];
        });
        markSuccess(staged.blob);
        if (openEditor) {
          setEditorSrc(staged.dataUrl);
          setEditorOpen(true);
        }
        triggerAutoGps();
        return staged;
      } catch (err) {
        const msg = (err as Error).message || "Gagal membaca foto";
        setPending((p) => p.map((x) => (x.id === id ? { ...x, status: "error", error: msg } : x)));
        toast.error("Gagal memuat foto: " + msg);
        return null;
      }
    });
  }
  async function retryPending(id: string) {
    const entry = pending.find((x) => x.id === id);
    if (!entry?.file) return;
    setPending((p) =>
      p.map((x) => (x.id === id ? { ...x, status: "loading", error: undefined } : x)),
    );
    try {
      const staged = await withPhotoActivity(() => stageFile(entry.file!));
      setPending((p) => p.filter((x) => x.id !== id));
      setPhotos((prev) => [...prev, staged]);
      markSuccess(staged.blob);
    } catch (err) {
      const msg = (err as Error).message || "Gagal membaca foto";
      setPending((p) => p.map((x) => (x.id === id ? { ...x, status: "error", error: msg } : x)));
    }
  }
  function dismissPending(id: string) {
    setPending((p) => p.filter((x) => x.id !== id));
  }
  async function onCameraFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    try {
      if (!f) return;
      await stageOne(f, true);
    } finally {
      fallbackPickerReleaseRef.current?.();
    }
  }
  async function onGalleryFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    try {
      if (files.length === 0) return;
      await stageGalleryFiles(files);
    } finally {
      fallbackPickerReleaseRef.current?.();
    }
  }
  async function stageGalleryFiles(files: File[]) {
    if (files.length === 0) return;
    const beforeLen = photosRef.current.length;
    const results = await Promise.all(files.map((f) => stageOne(f, false)));
    const okCount = results.filter(Boolean).length;
    if (okCount === 0) return;
    const len = await waitForPhotosRefLength(photosRef, beforeLen + okCount);
    const startIdx = Math.max(0, len - okCount);
    const idxs = Array.from({ length: okCount }, (_, i) => startIdx + i);
    editQueueRef.current = idxs.slice(1);
    if (!tryOpenEditForIdx(idxs[0])) {
      toast.success(`${okCount} foto masuk. Ketuk foto untuk edit.`);
    }
  }

  function takeLocation() {
    if (gpsLoading) return;
    setGpsLoading(true);
    requestGeolocation(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setLocUrl(
          `https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`,
        );
      },
      { retry: () => takeLocation(), onSettled: () => setGpsLoading(false) },
    );
  }

  async function submit() {
    if (photos.length === 0) {
      toast.error("Wajib lampirkan foto bukti");
      return;
    }
    const validRows = rows.filter((r) => Number(r.actual_grams) > 0);
    if (validRows.length === 0) {
      toast.error("Minimal 1 item dengan jumlah > 0");
      return;
    }
    // Validasi Maps URL client-side: kosong OK, tapi kalau diisi harus https://...
    // (mencocokkan validasi RPC). Short-link maps.app.goo.gl valid karena
    // sudah https. Trim spasi & newline dari clipboard.
    const trimmedLoc = (locUrl || "").trim();
    if (trimmedLoc.length > 0) {
      if (trimmedLoc.length > 2048) {
        toast.error("Link Maps terlalu panjang. Kosongkan atau perpendek.");
        return;
      }
      if (!/^https:\/\//i.test(trimmedLoc)) {
        toast.error("Link Maps belum valid. Harus diawali https:// atau kosongkan.");
        return;
      }
    }
    onKeepAlive();
    onActivityChange(true);
    setBusy(true);
    try {
      if (!ownerUserId) {
        toast.error("Sesi belum siap, coba muat ulang");
        setBusy(false);
        return;
      }
      const state: PhotoUploadStatus[] =
        uploads.length === photos.length
          ? uploads.map((u) => (u.status === "done" ? u : { status: "idle" as const }))
          : photos.map(() => ({ status: "idle" as const }));
      setUploads(state);
      for (let i = 0; i < photos.length; i++) {
        if (state[i].status === "done") continue;
        state[i] = { status: "uploading" };
        setUploads(state.slice());
        let uploadedPath: string | null = null;
        try {
          uploadedPath = await uploadRequestPhotoViaToken(
            ownerUserId,
            token,
            photos[i].blob,
            "jpg",
            publicSupabase,
          );
        } catch (uerr) {
          const msg = (uerr as Error).message || "Gagal mengunggah";
          state[i] = { status: "error", error: msg };
          setUploads(state.slice());
          continue;
        }
        if (!uploadedPath) {
          state[i] = { status: "error", error: "Server menolak upload" };
          setUploads(state.slice());
          continue;
        }
        state[i] = { status: "done", path: uploadedPath };
        setUploads(state.slice());
      }
      const failed = state.filter((u) => u.status === "error").length;
      if (failed > 0) {
        toast.error(
          `${failed} foto gagal unggah. Tekan "Coba lagi" pada foto yang gagal — foto yang sudah sukses tidak akan diulang.`,
        );
        setBusy(false);
        return;
      }
      const uploaded = state.map((u) => (u.status === "done" ? u.path : ""));
      const itemsPayload = validRows.map((r) => ({
        warehouse_item_id: r.warehouse_item_id,
        actual_grams: Number(r.actual_grams),
      }));
      const args = {
        _token: token,
        _pin: pin,
        _title_id: title.id,
        _items: itemsPayload,
        _photo_path: uploaded[0],
        _photo_paths: uploaded,
        _location_url: trimmedLoc || null,
        _gps_lat: gps?.lat ?? null,
        _gps_lng: gps?.lng ?? null,
        _note: note || null,
        _prep_task_item_id: null,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (publicSupabase.rpc as any)("request_submit_via_task", args);
      if (error) throw error;
      const res = data as { ok: boolean; error?: string };
      if (!res?.ok) {
        const code = res?.error || "submit_failed";
        const msg =
          code === "task_exhausted"
            ? "Link ini sudah dipakai untuk 1 paket. Minta link + PIN baru ke admin."
            : code === "bad_pin"
              ? "PIN salah"
              : code === "invalid_url"
                ? "Link Maps belum valid. Kosongkan link Maps jika tidak ada."
                : code === "url_too_long"
                  ? "Link Maps terlalu panjang."
                  : code === "photo_required"
                    ? "Foto bukti wajib dilampirkan."
                    : code === "grams_exceed_target"
                      ? "Jumlah melebihi target paket. Periksa qty."
                      : code === "not_found"
                        ? "Link tugas sudah tidak aktif. Minta link baru ke admin."
                        : code === "internal_error"
                          ? "Server menolak paket. Coba lagi atau hubungi admin."
                          : code;
        throw new Error(msg);
      }
      toast.success(`Paket terkirim (${uploaded.length} foto). Status berubah ke Selesai.`);
      setPhotos([]);
      setUploads([]);
      void clearDraftPhotos(draftKey);
      onDone();
    } catch (e) {
      const raw = (e as Error)?.message ?? "unknown";
      toast.error(`Paket belum terkirim: ${raw}. Foto & isian tetap tersimpan — coba kirim lagi.`);
    } finally {
      setBusy(false);
      onKeepAlive();
      onActivityChange(false);
    }
  }

  return (
    <div className="space-ms-3">
      <div className="space-y-1.5">
        {rows.map((r, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-ms-1.5">
            <div className="col-span-8 flex items-center rounded-md border bg-background px-ms-2 text-ms-xs">
              {r.product_name ?? "?"}
            </div>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={r.actual_grams}
              onChange={(e) =>
                setRows((rs) =>
                  rs.map((x, i) => (i === idx ? { ...x, actual_grams: e.target.value } : x)),
                )
              }
              className="col-span-3 h-9 rounded-md border bg-background px-ms-2 text-ms-xs"
            />
            <div className="col-span-1 flex items-center text-ms-2xs text-muted-foreground">
              {shortUnitLabel(r.product_name, r.unit_label)}
            </div>
          </div>
        ))}
      </div>

      <PhotoTileGrid
        photos={photos}
        pending={pending}
        justOk={justOk}
        uploads={uploads}
        onEdit={(i) => {
          setEditingIdx(i);
          setEditorSrc(photos[i].dataUrl);
          setEditorOpen(true);
        }}
        onRemove={(i) => setPhotos((prev) => {
          revokePhotoPreview(prev[i]);
          return prev.filter((_, j) => j !== i);
        })}
        onRetry={(id) => {
          void retryPending(id);
        }}
        onDismiss={dismissPending}
        onClearAll={() => {
          photos.forEach(revokePhotoPreview);
          setPhotos([]);
          setPending([]);
        }}
        onRetryUpload={(i) => {
          setUploads((prev) =>
            prev.map((u, j) => (j === i ? { status: "idle" } : u)),
          );
          void submit();
        }}
        onRetryAllUploads={() => {
          void submit();
        }}
        onMerge={async () => {
          if (photos.length < 2) return;
          try {
            const merged = await mergeStagedPhotos(photos);
            photos.forEach(revokePhotoPreview);
            setPhotos([merged]);
            editQueueRef.current = [];
            setTimeout(() => openEditForIdx(0), 0);
          } catch (err) {
            toast.error("Gagal gabung foto: " + ((err as Error).message || "unknown"));
          }
        }}
      />
      <div className="grid grid-cols-2 gap-ms-2">
        <button aria-label="Kamera"
          type="button"
          onClick={pickCamera}
          className="inline-flex h-11 items-center justify-center gap-ms-1.5 rounded-lg border bg-background text-ms-xs font-medium hover:bg-muted"
        >
          <Camera className="h-4 w-4" /> {photos.length ? "Tambah Kamera" : "Kamera"}
        </button>
        <button
          type="button"
          onClick={pickGallery}
          className="inline-flex h-11 items-center justify-center gap-ms-1.5 rounded-lg border bg-background text-ms-xs font-medium hover:bg-muted"
        >
          <ImageIcon className="h-4 w-4" /> {photos.length ? "Tambah Galeri" : "Galeri"}
        </button>
      </div>
      <p className="-mt-1 text-ms-2xs text-muted-foreground">
        Bisa pilih beberapa foto sekaligus dari galeri.
      </p>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onCameraFile}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onGalleryFiles}
      />
      <div className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-ms-2xs">
        <button
          type="button"
          onClick={() => setHelpKind("camera")}
          className="inline-flex items-center gap-ms-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <HelpCircle className="h-3 w-3" /> Kamera tidak bisa dibuka?
        </button>
        <button
          type="button"
          onClick={() => setHelpKind("gallery")}
          className="inline-flex items-center gap-ms-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <HelpCircle className="h-3 w-3" /> Galeri tidak muncul?
        </button>
      </div>

      {(() => {
        const m = locUrl.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
        const lat = m ? parseFloat(m[1]) : null;
        const lng = m ? parseFloat(m[2]) : null;
        const valid =
          lat !== null && lng !== null &&
          Number.isFinite(lat) && Number.isFinite(lng) &&
          Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        return (
          <div className="flex items-stretch gap-ms-2">
            <div className="flex flex-1 flex-col gap-ms-2">
              <input
                value={locUrl}
                onChange={(e) => setLocUrl(e.target.value)}
                placeholder="Link Google Maps (opsional)"
                className="h-10 w-full rounded-lg border bg-background px-ms-3 text-ms-xs"
              />
              <div className="grid grid-cols-2 gap-ms-2">
                <button
                  onClick={takeLocation}
                  type="button"
                  disabled={gpsLoading}
                  aria-busy={gpsLoading}
                  aria-live="polite"
                  className="inline-flex h-10 w-full items-center justify-center gap-ms-1 rounded-lg border bg-background px-ms-3 text-ms-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {gpsLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      <span className="truncate">Mengambil…</span>
                    </>
                  ) : gps ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                      <span className="truncate">Terisi</span>
                    </>
                  ) : (
                    <>
                      <MapPin className="h-4 w-4" aria-hidden /> GPS
                    </>
                  )}
                </button>
                <button
                  type="button"
                  title="Tempel link dari papan klip"
                  onClick={async () => {
                    try {
                      if (!navigator.clipboard?.readText) {
                        toast.error("Clipboard tidak tersedia — tempel manual di kolom");
                        return;
                      }
                      const text = (await navigator.clipboard.readText()).trim();
                      if (!text) { toast.error("Papan klip kosong"); return; }
                      if (!/^https:\/\//i.test(text)) {
                        toast.error("Isi papan klip bukan URL https://");
                        return;
                      }
                      setLocUrl(text.slice(0, 2048));
                      toast.success("Link ditempel");
                    } catch {
                      toast.error("Gagal membaca papan klip");
                    }
                  }}
                  className="inline-flex h-10 w-full items-center justify-center gap-ms-1 rounded-lg border bg-background px-ms-3 text-ms-xs font-medium hover:bg-muted"
                >
                  <ClipboardPaste className="h-4 w-4" /> Tempel
                </button>
              </div>
              {gps && (
                <div className="text-ms-2xs text-muted-foreground tabular-nums">
                  {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
                  {gps.accuracy ? ` · ±${Math.round(gps.accuracy)} m` : null}
                </div>
              )}
            </div>
            {valid ? (
              <a
                href={`https://www.google.com/maps?q=${lat},${lng}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Buka lokasi di Google Maps"
                className="relative block h-[88px] w-[88px] shrink-0 overflow-hidden rounded-lg border bg-muted"
              >
                <iframe
                  title="Pratinjau lokasi"
                  src={`https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`}
                  className="pointer-events-none absolute inset-0 h-full w-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
                <span className="absolute inset-x-0 bottom-0 truncate bg-background/80 px-1 py-0.5 text-center text-[9px] font-medium tabular-nums text-foreground backdrop-blur">
                  {lat.toFixed(4)}, {lng.toFixed(4)}
                </span>
              </a>
            ) : (
              <div className="flex h-[88px] w-[88px] shrink-0 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/40 px-1 text-center text-ms-2xs text-muted-foreground">
                <MapPin className="mb-0.5 h-4 w-4 opacity-60" />
                <span className="leading-tight">Belum ada titik</span>
              </div>
            )}
          </div>
        );
      })()}
      <div>
        <button
          type="button"
          onClick={() => setManualCoordOpen((v) => !v)}
          className="inline-flex items-center gap-ms-1 text-ms-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <MapPin className="h-3 w-3" /> {manualCoordOpen ? "Tutup" : "Isi koordinat manual"} (bila GPS ditolak)
        </button>
        {manualCoordOpen && (
          <div className="mt-2 flex flex-wrap gap-ms-2">
            <input
              inputMode="decimal"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              placeholder="Lat (mis. -7.257)"
              className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-ms-3 text-ms-xs"
            />
            <input
              inputMode="decimal"
              value={manualLng}
              onChange={(e) => setManualLng(e.target.value)}
              placeholder="Lng (mis. 112.752)"
              className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-ms-3 text-ms-xs"
            />
            <button
              type="button"
              onClick={() => {
                const lat = Number.parseFloat(manualLat.replace(",", "."));
                const lng = Number.parseFloat(manualLng.replace(",", "."));
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                  toast.error("Lat/Lng tidak valid");
                  return;
                }
                if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                  toast.error("Lat harus -90..90, Lng harus -180..180");
                  return;
                }
                setGps({ lat, lng });
                setLocUrl(`https://www.google.com/maps?q=${lat},${lng}`);
                toast.success("Koordinat manual dipakai");
              }}
              className="inline-flex h-10 items-center gap-ms-1 rounded-lg border bg-background px-ms-3 text-ms-xs font-medium hover:bg-muted"
            >
              Pakai
            </button>
          </div>
        )}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Catatan (opsional)"
        className="h-10 w-full rounded-lg border bg-background px-ms-3 text-ms-xs"
      />

      {(() => {
        const hasQty = rows.some((r) => Number(r.actual_grams) > 0);
        const hasPhoto = photos.length > 0;
        const uploading =
          busy && uploads.some((u) => u.status !== "idle");
        const disabled = busy || !hasQty || !hasPhoto;
        const reason = !hasPhoto
          ? "Tambahkan minimal 1 foto bukti"
          : !hasQty
            ? "Isi jumlah dulu"
            : null;
        return (
          <div className="sticky bottom-0 z-10 -mx-3 -mb-3 mt-2 border-t bg-background/95 px-ms-3 py-ms-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {reason ? (
              <p className="mb-1.5 text-center text-ms-2xs font-medium text-warning dark:text-warning">
                {reason}
              </p>
            ) : null}
            <button
              type="button"
              disabled={disabled}
              onClick={submit}
              aria-label="Kirim Paket"
              className="inline-flex h-11 w-full items-center justify-center gap-ms-1.5 rounded-lg bg-primary text-ms-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {uploading
                ? `Mengunggah ${uploads.filter((u) => u.status === "done").length}/${photos.length}…`
                : "Kirim Paket"}
            </button>
          </div>
        );
      })()}

      {editorOpen && editorSrc && (
        <PhotoEditor
          src={editorSrc}
          onCancel={() => {
            editQueueRef.current = [];
            setEditingIdx(null);
            setEditorOpen(false);
          }}
          onSave={(blob, dataUrl) => {
            setPhotos((prev) => {
              if (editingIdx !== null && editingIdx >= 0 && editingIdx < prev.length) {
                const next = prev.slice();
                revokePhotoPreview(next[editingIdx]);
                next[editingIdx] = buildStagedPhoto(dataUrl, blob);
                return next;
              }
              return [...prev, buildStagedPhoto(dataUrl, blob)];
            });
            onKeepAlive();
            advanceEditQueue();
          }}
        />
      )}
      <PermissionHelpDialog
        open={helpKind !== null}
        kind={helpKind ?? "camera"}
        onClose={() => setHelpKind(null)}
      />
    </div>
  );
}
