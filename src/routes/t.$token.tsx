import { createFileRoute } from "@tanstack/react-router";
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { toast } from "sonner";
import { PhotoEditor } from "@/components/PhotoEditor";
import { signedUrl, uploadPrepPhoto, type PrepItemRow, type PrepSubmissionRow, type PrepTaskRow } from "@/lib/prep";
import { uploadRequestPhotoViaToken } from "@/lib/request";
import { publicSupabase } from "@/lib/public-supabase";
import { MapPin, Camera, Image as ImageIcon, Edit3, Send, Loader2, Lock, ShieldCheck, Clock, CheckCircle2, Package, MessageCircle, ArrowLeft, AlertTriangle, RefreshCw, Wifi, WifiOff, Inbox } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { displayUnit } from "@/lib/unit-label";

export const Route = createFileRoute("/t/$token")({
  head: () => ({
    meta: [
      { title: "Tugas Siapkan Barang · MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicPrepPage,
});

type StagedPhoto = { dataUrl: string; blob: Blob };

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
    expires_at: stringOrFallback(value.expires_at, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
  };
}

class WorkerSectionBoundary extends Component<{
  children: ReactNode;
  renderFallback: (error: Error) => ReactNode;
}, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Jangan biarkan 1 kartu / paket request meruntuhkan seluruh portal pegawai
    // dan memantulkan user kembali ke layar PIN.
    // eslint-disable-next-line no-console
    console.error("[t.$token] worker section render failed", error, info.componentStack);
  }
  render() {
    if (this.state.error) return this.props.renderFallback(this.state.error);
    return this.props.children;
  }
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
  const [closedReason, setClosedReason] = useState<null | "pin_changed" | "not_found" | "expired" | "closed">(null);
  // Pesan error terakhir dari proses verifikasi PIN; ditampilkan inline di kartu PIN.
  const [lastError, setLastError] = useState<null | {
    kind: "bad_pin" | "rate_limited" | "not_found" | "expired" | "closed" | "network" | "no_task";
    message: string;
    detail?: string;
    code?: string;
    raw?: string;
  }>(null);
  function safeJson(v: unknown): string {
    try {
      const s = JSON.stringify(v, null, 2);
      return s.length > 800 ? s.slice(0, 800) + "…" : s;
    } catch {
      return String(v);
    }
  }
  const [staleItemIds, setStaleItemIds] = useState<Record<string, true>>({});
  const itemsRef = useRef<PrepItemRow[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  // Status koneksi realtime: 'connecting' saat awal, 'connected' setelah SUBSCRIBED,
  // 'error' bila channel gagal/terputus. lastSyncAt diisi setiap silentRefresh sukses.
  const [rtStatus, setRtStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncTick, setSyncTick] = useState(0); // memicu re-render label "x dtk lalu"
  const [resyncing, setResyncing] = useState(false);
  const autoResyncRef = useRef<{ lastAt: number; failCount: number }>({ lastAt: 0, failCount: 0 });

  // Paksa muat ulang data sekarang juga (dipakai tombol "Resync sekarang").
  async function manualResync() {
    if (resyncing) return;
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
    const isStale = rtStatus === "error" || (age != null && age > 90);
    const isLag = !isStale && age != null && age > 30;
    if (!isStale && !isLag) {
      autoResyncRef.current.failCount = 0;
      return;
    }
    // Cooldown backoff: lag 10 dtk; stale mulai 5 dtk, naik hingga 30 dtk.
    const fc = autoResyncRef.current.failCount;
    const cooldownMs = isStale ? Math.min(30000, 5000 * Math.pow(2, fc)) : 10000;
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
  // Pembatasan percobaan di sisi klien: maksimal MAX_ATTEMPTS PIN salah
  // berturut-turut sebelum input PIN dikunci selama LOCK_SECONDS.
  // Data disimpan di localStorage per-token agar reload halaman tidak
  // mem-bypass pembatasan. Server juga punya rate-limit terpisah
  // (mengembalikan "rate_limited" + retry_after).
  const MAX_ATTEMPTS = 3;
  const LOCK_SECONDS = 60;
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
        lockedUntil: parsed.lockedUntil && parsed.lockedUntil > Date.now() ? parsed.lockedUntil : null,
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
    } catch { /* ignore quota */ }
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
      } catch { /* ignore */ }
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
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function fetchTask(p: string) {
    if (isLocked) return false;
    setLoading(true);
    const { data, error } = await publicSupabase.rpc("prep_get_task", { _token: token, _pin: p });
    setLoading(false);
    if (error) {
      const msg = "Tidak bisa menghubungi server. Periksa koneksi internet lalu coba lagi.";
      setLastError({ kind: "network", message: msg, detail: error.message, code: (error as any).code, raw: safeJson({ error, data }) });
      toast.error(msg);
      return false;
    }
    const res = data as { ok: boolean; error?: string; retry_after?: number; expires_at?: string; status?: string; task?: unknown; items?: unknown };
    if (!res?.ok) {
      if (res?.error === "rate_limited") {
        const secs = Math.max(1, res.retry_after ?? 600);
        const until = Date.now() + secs * 1000;
        setLockedUntil(until);
        writeAttemptState({ attempts: MAX_ATTEMPTS, lockedUntil: until });
        const mins = Math.floor(secs / 60);
        const remain = mins >= 1 ? `${mins} menit ${secs % 60} detik` : `${secs} detik`;
        const msg = `Akses terkunci oleh server. Coba lagi dalam ${remain}.`;
        setLastError({ kind: "rate_limited", message: msg, code: "rate_limited", detail: `retry_after: ${secs} detik`, raw: safeJson(res) });
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
            setLastError({ kind: "bad_pin", message: msg, code: "bad_pin", raw: safeJson(res) });
            toast.error(msg);
          } else {
            setAttempts(next);
            writeAttemptState({ attempts: next, lockedUntil: null });
            const left = MAX_ATTEMPTS - next;
            const msg = `PIN salah. Sisa percobaan: ${left} dari ${MAX_ATTEMPTS}.`;
            setLastError({ kind: "bad_pin", message: msg, code: "bad_pin", raw: safeJson(res) });
            toast.error(msg);
          }
          setPin("");
        } else if (res?.error === "expired") {
          const expAt = res.expires_at ? new Date(res.expires_at) : null;
          const detail = expAt
            ? `Kedaluwarsa pada ${expAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}.`
            : undefined;
          const msg = "Link tugas sudah kedaluwarsa. Minta pemilik mengirim link / PIN baru.";
          setLastError({ kind: "expired", message: msg, detail, code: "expired", raw: safeJson(res) });
          toast.error(msg);
        } else if (res?.error === "closed") {
          const msg = res.status === "cancelled"
            ? "Tugas ini sudah dibatalkan pemilik."
            : "Tugas ini sudah ditutup pemilik (sudah selesai).";
          setLastError({ kind: "closed", message: msg, code: "closed", detail: res.status ? `Status: ${res.status}` : undefined, raw: safeJson(res) });
          toast.error(msg);
        } else if (res?.error === "not_found") {
          const msg = "Link tugas tidak ditemukan. Pastikan link tidak terpotong atau minta link baru ke pemilik.";
          setLastError({ kind: "not_found", message: msg, code: "not_found", raw: safeJson(res) });
          toast.error(msg);
        } else {
          const code = res?.error || "unknown";
          const msg = `Tugas tidak bisa dibuka (kode: ${code}). Tunjukkan pesan di bawah ke pemilik.`;
          setLastError({
            kind: "not_found",
            message: msg,
            detail: `Kode error server: ${code}. Status tugas: ${res?.status ?? "-"}.`,
            code,
            raw: safeJson(res),
          });
          toast.error(msg);
        }
      }
      return false;
    }
    // PIN valid (ok=true) tapi payload task hilang → tampilkan detail diagnostik
    const normalizedTask = normalizePrepTask(res.task);
    if (!normalizedTask) {
      const msg = "PIN benar, tetapi data tugas tidak terkirim dari server.";
      setLastError({
        kind: "no_task",
        message: msg,
        detail: "Server merespon ok=true namun field `task` kosong / rusak. Minta pemilik membuka kembali tugas lalu kirim ulang link.",
        code: "missing_task",
        raw: safeJson(res),
      });
      toast.error(msg);
      return false;
    }
    const normalizedItems = normalizePrepItems(res.items);
    setLastError(null);
    // Defensif: pastikan tidak ada layar "tugas ditutup" yang tersisa dari
    // silentRefresh sebelumnya, agar setelah authed=true tidak langsung
    // melompat balik ke screen closedReason.
    setClosedReason(null);
    // PIN benar → reset penuh, termasuk localStorage, sehingga refresh
    // browser tidak membawa sisa percobaan/lock.
    resetAttemptsFully();
    setTask(normalizedTask); setItems(normalizedItems); pinRef.current = p;
    // eslint-disable-next-line no-console
    console.log("[t.$token] PIN ok", {
      taskId: normalizedTask.id,
      itemsCount: normalizedItems.length,
      status: normalizedTask.status,
    });
    // Tampilkan layar sukses inline sebelum berpindah ke daftar tugas,
    // supaya pengguna melihat konfirmasi yang jelas di layar PIN.
    setSuccessFlash(true);
    setTimeout(() => {
      // eslint-disable-next-line no-console
      console.log("[t.$token] setAuthed(true) fired after success flash");
      setSuccessFlash(false);
      setAuthed(true);
    }, 1200);
    // Pastikan posisi scroll kembali ke atas halaman tugas.
    if (typeof window !== "undefined") {
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
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
    if (typeof window !== "undefined") {
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
    }
  }

  // poll-ish refresh after submission
  async function refresh() {
    if (!pinRef.current) return;
    await fetchTask(pinRef.current);
  }

  // Refresh ringan untuk dipanggil oleh realtime / heartbeat / visibilitychange.
  // Bedanya: bila PIN telah diubah admin atau tugas ditutup, langsung pindah
  // ke layar yang sesuai tanpa menghapus state percobaan.
  async function silentRefresh() {
    if (!pinRef.current || !authed) return;
    const { data } = await publicSupabase.rpc("prep_get_task", { _token: token, _pin: pinRef.current });
    const res = data as { ok: boolean; error?: string; task?: unknown; items?: unknown };
    if (!res?.ok) {
      if (res?.error === "bad_pin") {
        setClosedReason("pin_changed");
      } else if (res?.error === "expired") {
        setClosedReason("expired");
      } else if (res?.error === "closed") {
        setClosedReason("closed");
      } else if (res?.error === "not_found") {
        setClosedReason("not_found");
      }
      // eslint-disable-next-line no-console
      console.warn("[t.$token] silentRefresh non-ok", res);
      return;
    }
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

  function clearStale(itemId: string) {
    setStaleItemIds((s) => {
      if (!s[itemId]) return s;
      const copy = { ...s }; delete copy[itemId]; return copy;
    });
  }

  // Realtime broadcast + fallback heartbeat & visibility refresh.
  useEffect(() => {
    if (!authed) return;
    setRtStatus("connecting");
    const ch = publicSupabase
      .channel(`prep:${token}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "change" }, () => { void silentRefresh(); })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRtStatus("connected");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRtStatus("error");
      });
    const onVis = () => { if (document.visibilityState === "visible") void silentRefresh(); };
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
    const hash = window.location.hash || "";
    const m = hash.match(/(?:^#|[#&])p=(\d{4,8})/);
    if (!m) return;
    autoTriedRef.current = true;
    const autoPin = m[1];
    setPin(autoPin);
    void fetchTask(autoPin);
    // Bersihkan fragment dari address bar agar PIN tidak terlihat lagi.
    try {
      const { pathname, search } = window.location;
      window.history.replaceState(null, "", `${pathname}${search}`);
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authed) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background">
        <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-4 py-8">
          {successFlash && (
            <div
              className="success-banner mb-4 w-full rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 text-emerald-700 shadow-lg shadow-emerald-500/10 sm:p-5 dark:text-emerald-300"
              role="status"
              aria-live="polite"
            >
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:gap-4">
                <div className="success-check-badge flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/40 sm:h-12 sm:w-12">
                  <CheckCircle2 className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold leading-snug sm:text-base">
                    Masuk pegawai berhasil
                  </div>
                  <div className="truncate text-xs opacity-80 sm:text-sm">
                    Memuat daftar tugas…
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <Package className="h-7 w-7 text-primary" />
            </div>
            <div className="text-lg font-semibold tracking-tight">MCM Storage</div>
            <div className="text-xs text-muted-foreground">Portal Tugas Pegawai</div>
          </div>
          <div className="w-full rounded-2xl border bg-card p-6 shadow-lg shadow-black/5">
            <div className="mb-1 flex items-center gap-2 text-base font-semibold"><Lock className="h-4 w-4 text-primary" /> Verifikasi PIN</div>
            <p className="mb-5 text-xs leading-relaxed text-muted-foreground">Masukkan PIN dari pemilik untuk membuka daftar barang yang harus disiapkan.</p>
            {lastError && !isLocked && (
              <div
                className={
                  "mb-3 rounded-md border px-3 py-2 text-[11px] leading-relaxed " +
                  (lastError.kind === "bad_pin"
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : lastError.kind === "expired" || lastError.kind === "closed" || lastError.kind === "not_found"
                      ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                      : "border-destructive/40 bg-destructive/5 text-destructive")
                }
                role="alert"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold">{lastError.message}</div>
                    {lastError.detail && (
                      <div className="mt-0.5 break-words opacity-80">{lastError.detail}</div>
                    )}
                    {(lastError.code || lastError.raw) && (
                      <details className="mt-1.5" open>
                        <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wider opacity-70">
                          Detail respons RPC (prep_get_task)
                        </summary>
                        <div className="mt-1 font-mono text-[10px] opacity-80">kind: {lastError.kind}</div>
                        {lastError.code && (
                          <div className="mt-1 font-mono text-[10px] opacity-80">code: {lastError.code}</div>
                        )}
                        {lastError.raw && (
                          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-1.5 font-mono text-[10px] opacity-80">{lastError.raw}</pre>
                        )}
                        <button
                          type="button"
                          className="mt-1 rounded border px-2 py-0.5 text-[10px] hover:bg-background/80"
                          onClick={async () => {
                            const text = [
                              `Pesan: ${lastError.message}`,
                              lastError.detail ? `Detail: ${lastError.detail}` : "",
                              lastError.code ? `Kode: ${lastError.code}` : "",
                              lastError.raw ? `Payload:\n${lastError.raw}` : "",
                            ].filter(Boolean).join("\n");
                            try { await navigator.clipboard.writeText(text); toast.success("Detail error disalin"); }
                            catch { toast.error("Gagal menyalin"); }
                          }}
                        >
                          Salin detail error
                        </button>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            )}
            {(isLocked || attempts > 0) && (
              <div
                className={
                  "mb-4 grid grid-cols-2 gap-2 rounded-lg border p-2 text-center " +
                  (isLocked
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-amber-500/40 bg-amber-500/5")
                }
              >
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sisa percobaan</div>
                  <div
                    className={
                      "mt-0.5 text-xl font-bold tabular-nums " +
                      (isLocked
                        ? "text-destructive"
                        : attemptsLeft <= 1
                          ? "text-destructive"
                          : "text-amber-700 dark:text-amber-400")
                    }
                  >
                    {attemptsLeft}
                    <span className="text-xs font-normal text-muted-foreground"> / {MAX_ATTEMPTS}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Tunggu</div>
                  <div
                    className={
                      "mt-0.5 text-xl font-bold tabular-nums " +
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
            <input
              inputMode="numeric" maxLength={8} value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                if (lastError?.kind === "bad_pin") setLastError(null);
              }}
              placeholder="••••••" disabled={isLocked}
              className="mb-3 h-14 w-full rounded-lg border bg-background px-3 text-center text-2xl tracking-[0.6em] tabular-nums text-foreground shadow-inner placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60" />
            <button disabled={pin.length < 4 || loading || isLocked} onClick={() => fetchTask(pin)}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isLocked ? `Terkunci ${lockedClock} lagi` : "Buka Tugas"}
            </button>
            {isLocked && (
              <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] leading-relaxed text-destructive">
                <div className="font-semibold">Terkunci {lockedClock} lagi</div>
                <div className="mt-0.5 opacity-90">
                  Terlalu banyak PIN salah. Anda bisa mencoba lagi setelah hitungan mundur selesai.
                </div>
              </div>
            )}
            {!isLocked && justUnlocked && (
              <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                <div className="font-semibold">Kunci dibuka — silakan coba lagi</div>
                <div className="mt-0.5 opacity-90">
                  Pastikan PIN dari pemilik benar. Anda punya {MAX_ATTEMPTS} percobaan baru.
                </div>
              </div>
            )}
            {!isLocked && attempts > 0 && (
              <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                <div className="font-semibold">Silakan coba lagi</div>
                <div className="mt-0.5 opacity-90">
                  Sisa percobaan: <b>{attemptsLeft}</b> dari {MAX_ATTEMPTS}. Setelah {MAX_ATTEMPTS} kali salah, input akan dikunci {LOCK_SECONDS} detik.
                </div>
              </div>
            )}
            {(isLocked || attempts > 0) && (
              <button
                type="button"
                onClick={async () => {
                  const pageUrl = typeof window !== "undefined" ? window.location.href.split("#")[0] : "";
                  const text = [
                    "Halo, saya pegawai untuk tugas penyiapan barang.",
                    isLocked
                      ? "Akses saya terkunci karena PIN salah beberapa kali."
                      : "Sepertinya PIN yang saya terima tidak cocok / sudah kedaluwarsa.",
                    "Mohon kirim ulang PIN tugas yang baru.",
                    "",
                    `Link tugas: ${pageUrl}`,
                  ].join("\n");
                  const res = await shareToWhatsApp({ text, title: "Minta PIN baru", url: pageUrl });
                  notifyShareResult(res);
                }}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 px-3 text-xs font-semibold text-[#128C7E] transition hover:bg-[#25D366]/20 dark:text-[#25D366]"
              >
                <MessageCircle className="h-4 w-4" /> Minta PIN baru ke pemilik
              </button>
            )}
            {(isLocked || attempts > 0) && (
              <p className="mt-2 text-center text-[10px] leading-relaxed text-muted-foreground">
                Tombol ini hanya membuka WhatsApp dengan pesan siap kirim — pembatasan percobaan tetap berlaku sampai hitungan mundur selesai.
              </p>
            )}
            <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Koneksi terenkripsi · Sesi terbatas waktu
            </div>
          </div>
          <div className="mt-6 text-[10px] text-muted-foreground">© MCM Storage</div>
        </div>
      </div>
    );
  }

  const totalItems = items.length;
  const completedItems = items.filter((i) => (i.submissions?.length ?? 0) > 0).length;
  const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  // Tugas ditutup / PIN diubah pemilik → layar khusus
  if (closedReason) {
    const copy = closedReason === "pin_changed"
      ? { title: "PIN diperbarui pemilik",
          body: "PIN tugas baru saja diubah. Silakan minta PIN terbaru ke pemilik lalu masukkan kembali." }
      : closedReason === "expired"
      ? { title: "Tugas sudah kedaluwarsa",
          body: "Masa berlaku link tugas sudah habis. Minta pemilik mengirim link / PIN baru." }
      : closedReason === "closed"
      ? { title: "Tugas sudah ditutup pemilik",
          body: "Tugas ini telah ditandai selesai atau dibatalkan oleh pemilik. Hubungi pemilik bila masih perlu mengisi." }
      : { title: "Tugas tidak ditemukan",
          body: "Link tugas tidak ditemukan. Pastikan link tidak terpotong atau minta link baru ke pemilik." };
    return (
      <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background">
        <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-4 py-8">
          <div className="w-full rounded-2xl border bg-card p-6 text-center shadow-lg shadow-black/5">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/30">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="text-base font-semibold">{copy.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy.body}</p>
            <button
              type="button"
              onClick={() => { setClosedReason(null); goBackToPin(); }}
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border bg-background text-xs font-semibold transition hover:bg-muted"
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
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={goBackToPin}
            aria-label="Kembali ke halaman awal"
            className="flex h-9 w-9 items-center justify-center rounded-lg border bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">MCM Storage</div>
            <div className="truncate text-sm font-semibold">Tugas Penyiapan Barang</div>
          </div>
          <SyncBadge
            status={rtStatus}
            lastSyncAt={lastSyncAt}
            tick={syncTick}
            onRefresh={() => { void manualResync(); }}
          />
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-3 pt-4">
        <div className="mb-4 overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b bg-gradient-to-r from-primary/5 to-transparent px-4 py-3">
            <div className="text-base font-semibold leading-tight">{task?.title}</div>
            {task?.note && <div className="mt-1 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{task.note}</div>}
          </div>
          <div className="grid grid-cols-2 divide-x text-center">
            <div className="px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Progres</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">{completedItems} / {totalItems}</div>
            </div>
            <div className="flex items-center justify-center gap-1.5 px-3 py-2.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="text-left">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Kedaluwarsa</div>
                <div className="text-[11px] font-medium tabular-nums">{task ? new Date(task.expires_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : ""}</div>
              </div>
            </div>
          </div>
          <div className="h-1.5 w-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-3 py-2">
            <div className="text-[10px] text-muted-foreground">
              {lastSyncAt
                ? <>Diperbarui {Math.max(0, Math.round((Date.now() - lastSyncAt) / 1000))} dtk lalu<span className="hidden sm:inline"> · {new Date(lastSyncAt).toLocaleTimeString("id-ID")}</span></>
                : "Belum ada pembaruan"}
              <span className="ml-1 hidden text-[9px] opacity-60 sm:inline">(otomatis tiap 15 dtk)</span>
            </div>
            <button
              type="button"
              onClick={() => { void manualResync(); }}
              disabled={resyncing}
              className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-[10px] font-semibold transition hover:bg-muted disabled:opacity-60"
            >
              {resyncing
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RefreshCw className="h-3 w-3" />} Resync sekarang
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {items.map((it, idx) => (
            <WorkerSectionBoundary
              key={it.id}
              renderFallback={(error) => (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-semibold">Item #{idx + 1} gagal ditampilkan</div>
                      <div className="mt-1 text-xs leading-relaxed opacity-90">
                        PIN sudah benar dan tugas berhasil dibuka, tetapi ada data item yang tidak valid. Item lain tetap bisa dibuka.
                      </div>
                      <details className="mt-2 text-[11px]">
                        <summary className="cursor-pointer">Detail teknis</summary>
                        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/70 p-2 font-mono">
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
                onSubmitted={refresh}
              />
            </WorkerSectionBoundary>
          ))}
          {items.length === 0 && (
            loading ? (
              <div className="space-y-3" aria-busy="true" aria-label="Memuat daftar tugas">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
                    <div className="flex items-start gap-3">
                      <Skeleton className="h-14 w-14 rounded-lg" />
                      <div className="flex-1 space-y-2">
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
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Inbox className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Belum ada item tugas</p>
                  <p className="text-xs">Admin belum menambahkan item ke tugas ini. Coba muat ulang sebentar lagi.</p>
                </div>
              </div>
            )
          )}
        </div>

        <WorkerSectionBoundary
          renderFallback={(error) => (
            <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-800 dark:text-amber-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold">Paket request gagal ditampilkan</div>
                  <div className="mt-1 text-xs leading-relaxed opacity-90">
                    Daftar tugas utama tetap bisa dipakai. Detail error disiapkan agar masalah data paket bisa diperbaiki.
                  </div>
                  <details className="mt-2 text-[11px]">
                    <summary className="cursor-pointer">Detail teknis</summary>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/70 p-2 font-mono">
                      {error.message}
                    </pre>
                  </details>
                </div>
              </div>
            </div>
          )}
        >
          <RequestSection token={token} pin={pinRef.current} />
        </WorkerSectionBoundary>

        <div className="mt-6 text-center text-[10px] text-muted-foreground">Tetap aman · Jangan bagikan PIN ke siapa pun</div>
      </div>
    </div>
  );
}

function ItemCard({ item, index, token, pin, isStale, onAcknowledgeStale, onSubmitted }: { item: PrepItemRow; index: number; token: string; pin: string; isStale?: boolean; onAcknowledgeStale?: () => void; onSubmitted: () => void }) {
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const [locUrl, setLocUrl] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refSigned, setRefSigned] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { signedUrl(item.ref_photo_path, 60 * 60 * 24 * 7, publicSupabase).then(setRefSigned); }, [item.ref_photo_path]);

  function pickCamera() { cameraRef.current?.click(); }
  function pickGallery() { galleryRef.current?.click(); }

  async function fileToStaged(f: File): Promise<StagedPhoto> {
    const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    return { dataUrl, blob: f };
  }
  function triggerAutoGps() {
    if (!gps && !locUrl && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setGps({ lat: latitude, lng: longitude });
          setLocUrl(`https://www.google.com/maps?q=${latitude},${longitude}`);
        },
        () => { /* abaikan */ },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  }
  async function onCameraFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    setEditingIdx(null); // append after edit
    setEditorSrc(dataUrl);
    setEditorOpen(true);
    triggerAutoGps();
  }
  async function onGalleryFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []); e.target.value = "";
    if (files.length === 0) return;
    const staged = await Promise.all(files.map((f) => fileToStaged(f)));
    setPhotos((prev) => [...prev, ...staged]);
    triggerAutoGps();
  }

  function takeLocation() {
    if (!navigator.geolocation) { toast.error("GPS tidak tersedia"); return; }
    const id = toast.loading("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setGps({ lat: latitude, lng: longitude });
        setLocUrl(`https://www.google.com/maps?q=${latitude},${longitude}`);
        toast.success("Lokasi terisi", { id });
      },
      (err) => toast.error("Gagal: " + err.message, { id }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function submit() {
    if (isStale) {
      toast.error("Item baru saja diubah admin. Tinjau ulang sebelum kirim.");
      return;
    }
    if (photos.length === 0) {
      toast.error("Wajib lampirkan foto bukti timbangan/barang");
      return;
    }
    if (locUrl) {
      if (locUrl.length > 2048) { toast.error("URL lokasi terlalu panjang"); return; }
      if (!/^https:\/\//i.test(locUrl)) { toast.error("URL lokasi harus diawali https://"); return; }
    }
    setBusy(true);
    try {
      const uploaded: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const p = await uploadPrepPhoto(token, item.id, photos[i].blob, "jpg", publicSupabase);
        if (!p) { toast.error(`Upload foto ${i + 1} gagal`); setBusy(false); return; }
        uploaded.push(p);
      }
      const args = {
        _token: token, _pin: pin, _task_item_id: item.id,
        _photo_path: uploaded[0], _photo_paths: uploaded,
        _location_url: locUrl || null,
        _gps_lat: gps?.lat ?? null, _gps_lng: gps?.lng ?? null,
        _note: note || null, _qty_reported: null,
        _expected_updated_at: item.updated_at ?? null,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (publicSupabase.rpc as any)("prep_submit", args);
      if (error) throw error;
      const res = data as { ok: boolean; error?: string; available?: number; requested?: number; deducted?: number; current_updated_at?: string };
      if (!res?.ok) {
        if (res?.error === "item_changed") {
          toast.error("Item baru saja diubah admin. Periksa kembali sebelum kirim.");
          onSubmitted(); // muat ulang dari server
          return;
        }
        const msg = res?.error === "insufficient_stock"
          ? `Stok gudang tidak cukup (tersedia ${res.available}, diminta ${res.requested})`
          : res?.error === "item_not_found"
          ? "Barang tidak ditemukan di gudang"
          : res?.error === "bad_pin" ? "PIN salah"
          : (res?.error || "submit_failed");
        throw new Error(msg);
      }
      toast.success(`Terkirim ${uploaded.length} foto. Stok gudang dikurangi ${res.deducted ?? item.qty_requested} ${displayUnit(item.name, item.unit_label)}`);
      setPhotos([]); setLocUrl(""); setGps(null); setNote("");
      onSubmitted();
    } catch (e) {
      toast.error("Gagal kirim: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  const isDone = (item.submissions?.length ?? 0) > 0;
  return (
    <div className={`overflow-hidden rounded-2xl border bg-card shadow-sm transition ${isStale ? "border-amber-500/60 ring-1 ring-amber-500/30" : isDone ? "border-emerald-500/30" : ""}`}>
      {isStale && (
        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1">
            <b>Item ini baru saja diubah admin.</b> Periksa kembali sebelum kirim.
          </div>
          <button
            type="button"
            onClick={onAcknowledgeStale}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-500/40 bg-background px-2 text-[10px] font-semibold text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
          >
            <RefreshCw className="h-3 w-3" /> Lanjutkan
          </button>
        </div>
      )}
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Item #{index}</div>
        {isDone ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Selesai
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400">
            Belum dikirim
          </span>
        )}
      </div>
      <div className="p-3">
      <div className="flex items-start gap-3">
        {refSigned ? (
          <img src={refSigned} alt="" className="h-16 w-16 rounded-lg border object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border bg-muted text-[10px] text-muted-foreground">No img</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">{item.name}</div>
          <div className="text-[11px] text-muted-foreground">{item.category ?? "—"}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Target {item.qty_requested} {displayUnit(item.name, item.unit_label)}</span>
            <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Disiapkan {item.qty_prepared ?? 0}</span>
          </div>
          {item.note && <div className="mt-1 text-[11px] text-muted-foreground">Catatan: {item.note}</div>}
        </div>
      </div>

      {photos.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{photos.length} foto dipilih</span>
            <button type="button" onClick={() => setPhotos([])} className="inline-flex h-7 items-center gap-1 rounded-md border border-destructive/40 px-2 text-[10px] text-destructive hover:bg-destructive/10">Hapus semua</button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {photos.map((p, i) => (
              <div key={i} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
                <img src={p.dataUrl} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent p-1 text-[10px] text-white opacity-0 transition group-hover:opacity-100">
                  <button type="button" onClick={() => { setEditingIdx(i); setEditorSrc(p.dataUrl); setEditorOpen(true); }} className="rounded bg-black/50 px-1.5 py-0.5">Edit</button>
                  <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))} className="rounded bg-destructive/80 px-1.5 py-0.5">Hapus</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={pickCamera} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border bg-background text-xs font-medium transition hover:bg-muted"><Camera className="h-4 w-4" /> {photos.length ? "Tambah Kamera" : "Kamera"}</button>
        <button onClick={pickGallery} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border bg-background text-xs font-medium transition hover:bg-muted"><ImageIcon className="h-4 w-4" /> {photos.length ? "Tambah Galeri" : "Galeri"}</button>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">Bisa pilih beberapa foto sekaligus dari galeri.</p>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onCameraFile} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={onGalleryFiles} />

      <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
        Siapkan <b>{item.qty_requested} {displayUnit(item.name, item.unit_label)}</b> sesuai instruksi pemilik. Setelah foto + lokasi terkirim, stok gudang otomatis berkurang sebanyak itu — Anda tidak perlu mengisi angka apa pun.
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2">
        <div className="flex gap-2">
          <input value={locUrl} onChange={(e) => setLocUrl(e.target.value)} placeholder="Link Google Maps (opsional)" className="h-10 flex-1 rounded-lg border bg-background px-3 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
          <button onClick={takeLocation} className="inline-flex h-10 items-center gap-1 rounded-lg border bg-background px-3 text-xs font-medium transition hover:bg-muted"><MapPin className="h-4 w-4" /> GPS</button>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" className="h-10 w-full rounded-lg border bg-background px-3 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
      </div>

      <button disabled={busy} onClick={submit} className="mt-3 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Kirim
      </button>

      {item.submissions.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Sudah terkirim ({item.submissions.length})</div>
          <div className="flex gap-1 overflow-x-auto">
            {item.submissions.map((s) => <SubmissionThumb key={s.id} path={s.photo_path} />)}
          </div>
        </div>
      )}

      {editorOpen && editorSrc && (
        <PhotoEditor
          src={editorSrc}
          onCancel={() => setEditorOpen(false)}
          onSave={(blob, dataUrl) => {
            setPhotos((prev) => {
              if (editingIdx !== null && editingIdx >= 0 && editingIdx < prev.length) {
                const next = prev.slice();
                next[editingIdx] = { blob, dataUrl };
                return next;
              }
              return [...prev, { blob, dataUrl }];
            });
            setEditingIdx(null);
            setEditorOpen(false);
          }}
        />
      )}
      </div>
    </div>
  );
}

function SubmissionThumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { signedUrl(path, 60 * 60, publicSupabase).then(setUrl); }, [path]);
  if (!url) return <div className="h-12 w-12 shrink-0 rounded border bg-muted" />;
  return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded border object-cover" />;
}

// Indikator status sinkron realtime di header halaman pegawai.
// connected: channel SUBSCRIBED dan data ≤ 30 dtk.
// lag: channel SUBSCRIBED tapi data 30–90 dtk lalu (heartbeat masih jalan).
// stale: data > 90 dtk lalu atau channel error/terputus.
function SyncBadge({
  status, lastSyncAt, tick, onRefresh,
}: { status: "connecting" | "connected" | "error"; lastSyncAt: number | null; tick: number; onRefresh: () => void }) {
  void tick; // memaksa re-render tiap detak
  const ageSec = lastSyncAt ? Math.max(0, Math.round((Date.now() - lastSyncAt) / 1000)) : null;
  let kind: "connecting" | "connected" | "lag" | "stale";
  if (status === "connecting" && lastSyncAt == null) kind = "connecting";
  else if (status === "error") kind = "stale";
  else if (ageSec != null && ageSec > 90) kind = "stale";
  else if (ageSec != null && ageSec > 30) kind = "lag";
  else kind = "connected";

  const map = {
    connecting: { cls: "bg-muted text-muted-foreground ring-border", label: "Menyambung…", Icon: Loader2, spin: true },
    connected:  { cls: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400", label: "Sinkron", Icon: Wifi, spin: false },
    lag:        { cls: "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400", label: ageSec != null ? `Tertunda ${ageSec}d` : "Tertunda", Icon: Wifi, spin: false },
    stale:      { cls: "bg-rose-500/10 text-rose-700 ring-rose-500/30 dark:text-rose-400", label: "Tidak sinkron", Icon: WifiOff, spin: false },
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
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ring-1 transition hover:opacity-80 ${map.cls}`}
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

function RequestSection({ token, pin }: { token: string; pin: string }) {
  const [titles, setTitles] = useState<RequestTitleDTO[] | null>(null);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (publicSupabase.rpc as any)("request_list_titles_via_task", { _token: token, _pin: pin });
    if (error) { toast.error("Gagal muat request: " + error.message); return; }
    const res = data as { ok: boolean; titles?: unknown; owner_user_id?: unknown };
    if (res?.ok) {
      setTitles(normalizeRequestTitles(res.titles));
      setOwnerUserId(stringOrNull(res.owner_user_id));
    } else setTitles([]);
  }
  useEffect(() => { void load(); }, [token, pin]);

  if (!titles) return null;
  if (titles.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <Package className="h-4 w-4 text-primary" />
        <div className="text-sm font-semibold">Paket Request</div>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{titles.length}</span>
      </div>
      <div className="space-y-2">
        {titles.map((t) => {
          const requestItems = Array.isArray(t.items) ? t.items : [];
          return (
          <div key={t.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <button
              onClick={() => setOpenId(openId === t.id ? null : t.id)}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{t.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {requestItems.map((i) => `${i.product_name ?? "?"} ${i.target_grams}${displayUnit(i.product_name, i.unit_label)}`).join(" · ") || "Tidak ada item"}
                </div>
              </div>
              <span className="ml-2 rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground">
                {openId === t.id ? "Tutup" : "Siapkan"}
              </span>
            </button>
            {openId === t.id && (
              <div className="border-t bg-muted/20 p-3">
                <RequestForm title={t} token={token} pin={pin} ownerUserId={ownerUserId} onDone={() => { setOpenId(null); void load(); }} />
              </div>
            )}
          </div>
        );})}
      </div>
    </div>
  );
}

function RequestForm({
  title, token, pin, ownerUserId, onDone,
}: { title: RequestTitleDTO; token: string; pin: string; ownerUserId: string | null; onDone: () => void }) {
  const [rows, setRows] = useState(
    title.items.map((i) => ({
      warehouse_item_id: i.warehouse_item_id,
      product_name: i.product_name,
      unit_label: i.unit_label,
      actual_grams: String(i.target_grams),
    })),
  );
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const [locUrl, setLocUrl] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

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
  async function fileToStaged(f: File): Promise<StagedPhoto> {
    const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    return { dataUrl, blob: f };
  }
  async function onCameraFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    setEditingIdx(null);
    setEditorSrc(dataUrl); setEditorOpen(true);
    triggerAutoGps();
  }
  async function onGalleryFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []); e.target.value = "";
    if (files.length === 0) return;
    const staged = await Promise.all(files.map((f) => fileToStaged(f)));
    setPhotos((prev) => [...prev, ...staged]);
    triggerAutoGps();
  }

  function takeLocation() {
    if (!navigator.geolocation) { toast.error("GPS tidak tersedia"); return; }
    const id = toast.loading("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocUrl(`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`);
        toast.success("Lokasi terisi", { id });
      },
      (err) => toast.error("Gagal: " + err.message, { id }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit() {
    if (photos.length === 0) { toast.error("Wajib lampirkan foto bukti"); return; }
    const validRows = rows.filter((r) => Number(r.actual_grams) > 0);
    if (validRows.length === 0) { toast.error("Minimal 1 item dengan jumlah > 0"); return; }
    setBusy(true);
    try {
      if (!ownerUserId) { toast.error("Sesi belum siap, coba muat ulang"); setBusy(false); return; }
      const uploaded: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const p = await uploadRequestPhotoViaToken(ownerUserId, token, photos[i].blob, "jpg", publicSupabase);
        if (!p) throw new Error(`Upload foto ${i + 1} gagal`);
        uploaded.push(p);
      }
      const itemsPayload = validRows.map((r) => ({
        warehouse_item_id: r.warehouse_item_id,
        actual_grams: Number(r.actual_grams),
      }));
      const args = {
        _token: token, _pin: pin, _title_id: title.id,
        _items: itemsPayload,
        _photo_path: uploaded[0], _photo_paths: uploaded,
        _location_url: locUrl || null,
        _gps_lat: gps?.lat ?? null, _gps_lng: gps?.lng ?? null,
        _note: note || null, _prep_task_item_id: null,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (publicSupabase.rpc as any)("request_submit_via_task", args);
      if (error) throw error;
      const res = data as { ok: boolean; error?: string };
      if (!res?.ok) throw new Error(res?.error || "submit_failed");
      toast.success(`Paket request terkirim (${uploaded.length} foto), stok dikurangi`);
      onDone();
    } catch (e) {
      toast.error("Gagal: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {rows.map((r, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-1.5">
            <div className="col-span-8 flex items-center rounded-md border bg-background px-2 text-xs">
              {r.product_name ?? "?"}
            </div>
            <input
              type="number" inputMode="decimal" step="any" min="0"
              value={r.actual_grams}
              onChange={(e) => setRows((rs) => rs.map((x, i) => i === idx ? { ...x, actual_grams: e.target.value } : x))}
              className="col-span-3 h-9 rounded-md border bg-background px-2 text-xs"
            />
            <div className="col-span-1 flex items-center text-[10px] text-muted-foreground">{displayUnit(r.product_name, r.unit_label)}</div>
          </div>
        ))}
      </div>

      {photos.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{photos.length} foto dipilih</span>
            <button type="button" onClick={() => setPhotos([])} className="inline-flex h-7 items-center gap-1 rounded-md border border-destructive/40 px-2 text-[10px] text-destructive hover:bg-destructive/10">Hapus semua</button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {photos.map((p, i) => (
              <div key={i} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
                <img src={p.dataUrl} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent p-1 text-[10px] text-white opacity-0 transition group-hover:opacity-100">
                  <button type="button" onClick={() => { setEditingIdx(i); setEditorSrc(p.dataUrl); setEditorOpen(true); }} className="rounded bg-black/50 px-1.5 py-0.5">Edit</button>
                  <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))} className="rounded bg-destructive/80 px-1.5 py-0.5">Hapus</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => cameraRef.current?.click()} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border bg-background text-xs font-medium hover:bg-muted"><Camera className="h-4 w-4" /> {photos.length ? "Tambah Kamera" : "Kamera"}</button>
        <button onClick={() => galleryRef.current?.click()} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border bg-background text-xs font-medium hover:bg-muted"><ImageIcon className="h-4 w-4" /> {photos.length ? "Tambah Galeri" : "Galeri"}</button>
      </div>
      <p className="-mt-1 text-[10px] text-muted-foreground">Bisa pilih beberapa foto sekaligus dari galeri.</p>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onCameraFile} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={onGalleryFiles} />

      <div className="flex gap-2">
        <input value={locUrl} onChange={(e) => setLocUrl(e.target.value)} placeholder="Link Google Maps (opsional)" className="h-10 flex-1 rounded-lg border bg-background px-3 text-xs" />
        <button onClick={takeLocation} className="inline-flex h-10 items-center gap-1 rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted"><MapPin className="h-4 w-4" /> GPS</button>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" className="h-10 w-full rounded-lg border bg-background px-3 text-xs" />

      <button disabled={busy} onClick={submit} className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Kirim Paket
      </button>

      {editorOpen && editorSrc && (
        <PhotoEditor
          src={editorSrc}
          onCancel={() => setEditorOpen(false)}
          onSave={(blob, dataUrl) => {
            setPhotos((prev) => {
              if (editingIdx !== null && editingIdx >= 0 && editingIdx < prev.length) {
                const next = prev.slice();
                next[editingIdx] = { blob, dataUrl };
                return next;
              }
              return [...prev, { blob, dataUrl }];
            });
            setEditingIdx(null);
            setEditorOpen(false);
          }}
        />
      )}
    </div>
  );
}