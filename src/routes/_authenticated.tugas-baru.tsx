import { createFileRoute, Link, useBlocker } from "@tanstack/react-router";
import { NumericTextField } from "@/components/NumericDraftInput";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { genPin, genShareToken, publicTaskUrl } from "@/lib/prep";
import { buildTugasBaruWaMessage, validateTugasBaruWaMessage } from "@/lib/tugas-share";
import { copyText, shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { Plus, Trash2, Copy, MessageCircle, ExternalLink, RefreshCw, ShieldCheck, ArrowLeft, Info, Check } from "lucide-react";
import { ShieldAlert } from "lucide-react";
import { useAdminStatus } from "@/hooks/use-is-admin";
import { TaskQrCode } from "@/components/TaskQrCode";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/tugas-baru")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { title_id?: string; title_id_invalid?: true } => {
    // Param sama sekali tidak dikirim → form manual biasa, bukan fallback.
    if (!("title_id" in search) || search.title_id == null) return {};
    const raw = typeof search.title_id === "string" ? search.title_id.trim() : "";
    // Guard: hanya UUID v4-ish yang diteruskan supaya tidak bocor payload liar.
    if (raw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      return { title_id: raw };
    }
    // Param dikirim tapi bukan UUID valid (atau kosong) → tandai supaya UI
    // bisa menampilkan fallback + arah balik ke /ecer, bukan diam-diam
    // menerima bentuk form kosong yang membingungkan owner.
    return { title_id_invalid: true };
  },
  head: () => ({
    meta: [
      { title: "Buat Tugas Pegawai · MCM Storage" },
      { name: "description", content: "Buat token & PIN tugas pegawai langsung dari UI tanpa akses database." },
    ],
  }),
  component: TugasBaruPage,
});

type TitleOpt = {
  id: string;
  name: string;
  target_grams: number | null;
  unit_label: string | null;
  warehouse_item_id: string | null;
};

type Row = {
  key: string;
  title_id: string; // "" = bebas (manual)
  name: string;
  qty: string;
  unit: string;
  warehouse_item_id: string | null;
};

function newRow(): Row {
  return { key: crypto.randomUUID(), title_id: "", name: "", qty: "1", unit: "", warehouse_item_id: null };
}

const DRAFT_KEY = "tugas-baru:draft:v1";
const TOOLTIP_MODE_KEY = "autosave:tooltip-mode:v1";
type TooltipMode = "ringkas" | "lengkap";
function loadTooltipMode(): TooltipMode {
  if (typeof window === "undefined") return "ringkas";
  try {
    const v = window.localStorage.getItem(TOOLTIP_MODE_KEY);
    return v === "lengkap" ? "lengkap" : "ringkas";
  } catch {
    return "ringkas";
  }
}
function saveTooltipMode(m: TooltipMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOOLTIP_MODE_KEY, m);
  } catch { /* ignore */ }
}
function useTooltipMode(): [TooltipMode, (m: TooltipMode) => void] {
  // Lazy initializer membaca localStorage sebelum render pertama sehingga
  // tidak ada flash dari "ringkas" → mode tersimpan saat halaman dibuka.
  // SSR aman karena loadTooltipMode() mengembalikan default ketika
  // `window` undefined; effect di bawah resync setelah hydrate jika nilai
  // berbeda (mis. ditulis tab lain saat halaman ini sedang mount).
  const [mode, setMode] = useState<TooltipMode>(() => loadTooltipMode());
  // Debounce re-render ketika `storage`/CustomEvent/polling memicu beberapa
  // perubahan dalam waktu singkat. Tanpa ini, klik toggle cepat di banyak tab
  // bisa membuat indikator autosave berkedip karena React render berkali-kali
  // untuk nilai akhir yang sama. Setter LOKAL (`update`) tetap sinkron agar
  // toggle yang ditekan user terasa instan; debounce hanya dipakai untuk
  // sinyal eksternal.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastExternalRef = useRef<TooltipMode | null>(null);
  const scheduleExternal = useCallback((next: TooltipMode) => {
    lastExternalRef.current = next;
    if (debounceRef.current != null) return;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const target = lastExternalRef.current;
      lastExternalRef.current = null;
      if (target == null) return;
      setMode((prev) => (prev === target ? prev : target));
    }, 120);
  }, []);
  useEffect(() => {
    const stored = loadTooltipMode();
    setMode((prev) => (prev === stored ? prev : stored));
  }, []);
  const update = useCallback((m: TooltipMode) => {
    // User-initiated → terapkan instan, batalkan debounce eksternal yang
    // mungkin sedang menunggu dengan nilai lama.
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      lastExternalRef.current = null;
    }
    setMode(m);
    saveTooltipMode(m);
    try {
      window.dispatchEvent(new CustomEvent("autosave-tooltip-mode", { detail: m }));
    } catch {}
  }, []);
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as TooltipMode | undefined;
      if (detail === "ringkas" || detail === "lengkap") scheduleExternal(detail);
    };
    window.addEventListener("autosave-tooltip-mode", onChange);
    // Sinkronisasi lintas-tab: `storage` event hanya menyala di tab LAIN
    // ketika localStorage di-update, jadi aman dipakai bersamaan dengan
    // CustomEvent in-tab di atas tanpa loop.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== TOOLTIP_MODE_KEY) return;
      const v = e.newValue === "lengkap" ? "lengkap" : "ringkas";
      scheduleExternal(v);
    };
    window.addEventListener("storage", onStorage);
    // Fallback: beberapa kondisi tidak memicu `storage` event — mis. WebView
    // Android lama atau tab yang baru saja di-suspend lalu dibangunkan.
    // Kita re-sync HANYA ketika tab kembali fokus/visible; polling interval
    // ringan sebelumnya (setiap 5 dtk) telah dihapus karena membebani daya
    // pada perangkat mobile dan sudah tercakup oleh `storage` event +
    // visibility/focus. (M14)
    const resync = () => {
      const stored = loadTooltipMode();
      scheduleExternal(stored);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") resync();
    };
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("autosave-tooltip-mode", onChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", onVisibility);
      if (debounceRef.current != null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        lastExternalRef.current = null;
      }
    };
  }, [scheduleExternal]);
  return [mode, update];
}
type Draft = { title: string; note: string; pin: string; rows: Row[]; phone: string; token?: string; scheduledAt?: string };
function loadDraft(): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d || !Array.isArray(d.rows) || d.rows.length === 0) return null;
    return d;
  } catch {
    return null;
  }
}
function saveDraft(d: Draft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* ignore quota / private mode */
  }
}
function clearDraft() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function TugasBaruPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  // Sticky admin gate: sekali user terkonfirmasi admin pada mount ini, tetap
  // render form meskipun `isAdmin` sesaat berubah karena event auth
  // (INITIAL_SESSION / TOKEN_REFRESHED / reconnect WebView Android yang
  // sempat mengirim session=null). Tanpa ini, form akan unmount →
  // remount dan input yang sedang diketik user (mis. jumlah barang)
  // kembali ke nilai draft/awal ("mendadak jadi 0"). Sign-out sungguhan
  // akan ditangani layout `_authenticated` yang mengalihkan ke /auth,
  // sehingga sticky di sini aman.
  const wasAdminRef = useRef(false);
  if (isAdmin) wasAdminRef.current = true;
  if (wasAdminRef.current) return <TugasBaruForm />;
  if (isCheckingAdmin) {
    // Skeleton dengan tinggi & ritme yang MENYAMAI layout form asli
    // (judul, catatan, PIN, satu baris item, tombol) sehingga saat
    // status admin terkonfirmasi dan form asli muncul, tidak terjadi
    // layout shift atau kedipan. Juga aman ditampilkan berulang saat
    // event auth transient membuat `isCheckingAdmin` toggle sebentar —
    // karena bentuknya identik dengan form, mata user tidak menangkap
    // "hilang lalu kembali".
    return <TugasBaruSkeleton />;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-ms-3 py-ms-6 animate-fade-in">
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-ms-5 text-ms-sm">
          <div className="mb-2 flex items-center gap-ms-2 font-semibold text-destructive">
            <ShieldAlert className="h-5 w-5" /> Akses ditolak
          </div>
          <p className="text-foreground">
            Halaman <b>Buat Tugas Pegawai</b> hanya dapat diakses oleh pengguna dengan peran <b>admin</b>.
            Silakan hubungi pemilik toko untuk mendapatkan peran yang tepat.
          </p>
          <div className="mt-3">
            <Link
              to="/tugas"
              className="inline-flex h-9 items-center gap-ms-1 rounded-md border bg-background px-ms-3 text-ms-xs font-semibold"
            >
              <ArrowLeft className="h-4 w-4" /> Kembali ke Penyiapan
            </Link>
          </div>
        </div>
      </div>
    );
  }
  return <TugasBaruForm />;
}

/**
 * Skeleton yang meniru layout form Buat Tugas Pegawai. Dipakai saat status
 * admin sedang diverifikasi (mis. cold start, refresh token, reconnect
 * WebView) supaya tidak ada teks "Memeriksa…" yang tiba-tiba muncul lalu
 * hilang. Semua blok memakai tinggi tetap sehingga transisi ke form asli
 * tidak menggeser layout.
 */
function TugasBaruSkeleton() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Alihkan fokus ke kontainer skeleton saat pertama muncul agar pembaca layar
    // tidak terdampar di body/document sementara form asli belum siap.
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="mx-auto max-w-2xl px-ms-3 py-ms-4 animate-fade-in focus:outline-none"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
      aria-labelledby="tugas-baru-skeleton-title"
      aria-describedby="tugas-baru-skeleton-desc"
    >
      {/* Header: tombol kembali + judul */}
      <div className="mb-4 flex items-center gap-ms-2">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-6 w-56" />
      </div>

      <div className="space-ms-4 rounded-2xl border bg-card p-ms-4">
        {/* Judul tugas */}
        <div className="space-ms-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
        {/* Catatan */}
        <div className="space-ms-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-20 w-full" />
        </div>
        {/* PIN + token */}
        <div className="grid grid-cols-2 gap-ms-3">
          <div className="space-ms-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-ms-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
        {/* Daftar item (satu baris + placeholder tombol tambah) */}
        <div className="space-ms-2 pt-2">
          <Skeleton className="h-4 w-28" />
          <div className="space-ms-2 rounded-xl border p-ms-3">
            <Skeleton className="h-10 w-full" />
            <div className="grid grid-cols-3 gap-ms-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
        {/* Tombol submit */}
        <div className="flex justify-end pt-2">
          <Skeleton className="h-10 w-36" />
        </div>
      </div>

      <span id="tugas-baru-skeleton-title" className="sr-only">
        Memuat form Buat Tugas Pegawai
      </span>
      <span id="tugas-baru-skeleton-desc" className="sr-only">
        Memeriksa izin akses…
      </span>
    </div>
  );
}

function TugasBaruForm() {
  // Restore draft on first render so a remount (e.g. router invalidation
  // triggered by realtime/sidebar refetch) doesn't wipe what was typed.
  const initialRef = useRef<Draft | null>(loadDraft());
  const [title, setTitle] = useState(() => initialRef.current?.title ?? "");
  const [note, setNote] = useState(() => initialRef.current?.note ?? "");
  const [pin, setPin] = useState(() => initialRef.current?.pin ?? genPin());
  const [rows, setRows] = useState<Row[]>(() => initialRef.current?.rows ?? [newRow()]);
  const [phone, setPhone] = useState(() => initialRef.current?.phone ?? "");
  const [token, setToken] = useState<string>(() => initialRef.current?.token ?? genShareToken());
  const [scheduledAt, setScheduledAt] = useState<string>(() => initialRef.current?.scheduledAt ?? "");
  const [restored] = useState(() => !!initialRef.current);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ token: string; pin: string; title: string; url: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Saat form asli muncul (biasanya setelah skeleton), pindahkan fokus ke
    // heading halaman agar pembaca layar langsung menyadari konten telah siap
    // dan fokus tidak terdampar di body/document.
    const h = headingRef.current;
    if (h && typeof h.focus === "function") {
      try {
        h.focus({ preventScroll: true });
      } catch {
        h.focus();
      }
    }
  }, []);
  const [titles, setTitles] = useState<TitleOpt[]>([]);
  // Paket Request yang bisa disertakan pada link tugas ini. Sengaja
  // dipisah dari `titles` (ecer) karena sumber datanya berbeda dan
  // aturannya juga berbeda: paket dipilih eksplisit per-link supaya
  // link+PIN #2 tidak lagi membawa paket yang sudah dititipkan ke
  // link+PIN #1 (aturan "1 link = 1 perintah").
  type PaketOpt = { id: string; name: string };
  const [paketOptions, setPaketOptions] = useState<PaketOpt[]>([]);
  const [selectedPaketIds, setSelectedPaketIds] = useState<string[]>([]);
  const [paketOpen, setPaketOpen] = useState(false);
  // Sekali user manual centang/lepas centang, jangan lagi ditimpa oleh
  // default "pilih semua" saat daftar paket dimuat ulang.
  const paketTouchedRef = useRef(false);
  type VerifyState = {
    status: "idle" | "checking" | "ok" | "missing" | "error";
    productName?: string;
    error?: string;
    wid?: string | null;
  };
  const [verify, setVerify] = useState<Record<string, VerifyState>>({});
  const verifySeq = useRef<Record<string, number>>({});

  // Cek apakah token tautan pegawai sudah dipakai oleh tugas lain sebelum submit.
  // Menggunakan RPC SECURITY DEFINER `prep_share_token_exists` (admin-only) agar
  // lolos RLS prep_tasks yang hanya mengizinkan owner membaca datanya sendiri.
  type TokenCheck = {
    status: "idle" | "checking" | "unique" | "duplicate" | "invalid" | "error";
    token?: string;
    error?: string;
  };
  const [tokenCheck, setTokenCheck] = useState<TokenCheck>({ status: "idle" });
  const tokenCheckSeq = useRef(0);

  // Debounced autosave so rapid edits (mengetik, memilih banyak item)
  // tidak menulis ke localStorage di setiap keystroke. Tetap simpan
  // segera saat tab disembunyikan / sebelum unload agar tidak hilang.
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved">("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [savedVisible, setSavedVisible] = useState(false);
  const [savedReason, setSavedReason] = useState<"auto" | "navigation" | "manual">("auto");
  const [tooltipMode, setTooltipMode] = useTooltipMode();
  const [, forceTick] = useState(0);
  const lastSavedRef = useRef<string>("");
  const latestDraftRef = useRef<Draft>({ title, note, pin, rows, phone, token, scheduledAt });
  // Update ref secara SINKRON selama render supaya cleanup unmount / event
  // "pagehide" selalu punya snapshot input paling baru — termasuk keystroke
  // terakhir sebelum unmount dipicu (mis. transisi auth sesaat). Menulis
  // ke ref selama render aman: ref bukan state, tidak memicu re-render.
  latestDraftRef.current = { title, note, pin, rows, phone, token, scheduledAt };

  const flushDraft = useCallback((reason: "auto" | "navigation" | "manual" = "auto") => {
    const cur = JSON.stringify(latestDraftRef.current);
    if (cur === lastSavedRef.current) {
      setSaveState("saved");
      setSavedVisible(true);
      setSavedReason(reason);
      return false;
    }
    saveDraft(latestDraftRef.current);
    lastSavedRef.current = cur;
    setSaveState("saved");
    setSavedAt(Date.now());
    setSavedVisible(true);
    setSavedReason(reason);
    return true;
  }, []);

  // Fade out the "saved" badge ~4s after the last save, unless a new
  // edit re-triggers "pending". After the fade animation completes,
  // reset state→idle and clear savedAt so no stale content lingers
  // behind a transparent layer (avoids a kedip on the next edit).
  useEffect(() => {
    if (saveState !== "saved") return;
    const hideT = window.setTimeout(() => setSavedVisible(false), 4000);
    const resetT = window.setTimeout(() => {
      setSaveState((s) => (s === "saved" ? "idle" : s));
      setSavedAt(null);
    }, 4000 + 750);
    return () => {
      window.clearTimeout(hideT);
      window.clearTimeout(resetT);
    };
  }, [saveState, savedAt]);

  // Re-render every 20s so the relative time stays fresh while visible.
  useEffect(() => {
    if (!savedVisible || !savedAt) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 20_000);
    return () => window.clearInterval(id);
  }, [savedVisible, savedAt]);

  useEffect(() => {
    if (created) return;
    const snapshot = JSON.stringify(latestDraftRef.current);
    if (snapshot === lastSavedRef.current) return;
    setSaveState("pending");
    const t = window.setTimeout(() => flushDraft("auto"), 600);
    const onHide = () => { if (document.visibilityState === "hidden") flushDraft("navigation"); };
    const onBeforeUnload = () => { flushDraft("navigation"); };
    const onPageHide = () => { flushDraft("navigation"); };
    const onPopState = () => { flushDraft("navigation"); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("popstate", onPopState);
    };
  }, [title, note, pin, rows, phone, token, scheduledAt, created, flushDraft]);

  // Flush draft when this route unmounts (any SPA navigation away,
  // including programmatic <Link> clicks and router.history.back()).
  useEffect(() => {
    return () => { flushDraft("navigation"); };
  }, [flushDraft]);

  // Confirm before leaving the page while a save is still pending.
  // Also wires the native beforeunload prompt for tab close / reload.
  const isPending = saveState === "pending" && !created;
  const blocker = useBlocker({
    shouldBlockFn: () => isPending,
    enableBeforeUnload: () => isPending,
    withResolver: true,
  });

  async function verifyWid(key: string, wid: string | null) {
    const seq = (verifySeq.current[key] ?? 0) + 1;
    verifySeq.current[key] = seq;
    if (!wid) {
      setVerify((v) => ({ ...v, [key]: { status: "idle", wid: null } }));
      return;
    }
    setVerify((v) => ({ ...v, [key]: { status: "checking", wid } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from as any)("warehouse_items")
      .select("id,name")
      .eq("id", wid)
      .maybeSingle();
    if (verifySeq.current[key] !== seq) return; // stale
    if (error) {
      setVerify((v) => ({ ...v, [key]: { status: "error", error: error.message, wid } }));
      return;
    }
    if (!data) {
      setVerify((v) => ({ ...v, [key]: { status: "missing", wid } }));
      return;
    }
    setVerify((v) => ({ ...v, [key]: { status: "ok", productName: (data as { name: string }).name, wid } }));
  }

  useEffect(() => {
    let on = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("ecer_titles")
        .select("id,name,target_grams,unit_label,warehouse_item_id")
        .order("position")
        .order("created_at");
      if (!on) return;
      if (error) {
        toast.error("Gagal memuat daftar produk: " + error.message);
        return;
      }
      setTitles((data ?? []) as TitleOpt[]);
    })();
    return () => {
      on = false;
    };
  }, []);

  // Muat daftar Paket Request milik owner yang masih "belum diselesaikan"
  // (belum ada penyiapan pada siklus aktif). Data ini yang bisa dicentang
  // untuk disertakan ke link tugas yang sedang dibuat. Filter dibiarkan
  // di client — jumlahnya kecil dan tabel sudah di-RLS per owner.
  useEffect(() => {
    let on = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const titlesRes = await (supabase.from as any)("request_titles")
        .select("id,name,reprep_requested_at")
        .order("position")
        .order("created_at");
      if (!on) return;
      if (titlesRes.error) {
        // Tidak fatal — cukup toast pelan, form ecer tetap jalan.
        toast.error("Gagal memuat daftar Paket: " + titlesRes.error.message);
        return;
      }
      const rawTitles = (titlesRes.data ?? []) as Array<{
        id: string;
        name: string;
        reprep_requested_at: string | null;
      }>;
      if (rawTitles.length === 0) {
        setPaketOptions([]);
        return;
      }
      // Filter yang belum ada penyiapan pada siklus aktif.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prepRes = await (supabase.from as any)("request_preparations")
        .select("title_id,created_at")
        .in("title_id", rawTitles.map((t) => t.id));
      if (!on) return;
      const preps = (prepRes.data ?? []) as Array<{
        title_id: string;
        created_at: string;
      }>;
      const activeCycle = rawTitles.filter((t) => {
        const cutoff = t.reprep_requested_at ? new Date(t.reprep_requested_at).getTime() : null;
        const hasPrep = preps.some((p) => {
          if (p.title_id !== t.id) return false;
          if (cutoff == null) return true;
          return new Date(p.created_at).getTime() > cutoff;
        });
        return !hasPrep;
      });
      setPaketOptions(activeCycle.map((t) => ({ id: t.id, name: t.name })));
      // Default: centang SEMUA paket aktif supaya kolom Paket Request di
      // halaman pegawai (/t/:token) langsung terisi seperti kolom ecer,
      // tanpa admin harus buka dropdown & centang manual. Owner tetap
      // bisa uncheck yang tidak diinginkan sebelum submit.
      if (!paketTouchedRef.current) {
        setSelectedPaketIds(activeCycle.map((t) => t.id));
      }
    })();
    return () => {
      on = false;
    };
  }, []);

  // Re-verify warehouse links for restored rows so the green/red status badges
  // re-appear after a remount without forcing the user to re-pick each product.
  useEffect(() => {
    if (!initialRef.current) return;
    for (const r of initialRef.current.rows) {
      if (r.warehouse_item_id) verifyWid(r.key, r.warehouse_item_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefill dari deep-link folder ecer: `/tugas-baru?title_id=<uuid>` mengisi
  // baris pertama otomatis dengan judul ecer terpilih supaya admin tidak
  // perlu memilih ulang. Hanya berlaku sekali: (a) tidak ada draft tersimpan
  // dan (b) form masih dalam kondisi kosong bawaan.
  const searchParams = Route.useSearch();
  const prefillTitleId = searchParams.title_id ?? null;
  const prefillTitleIdInvalid = searchParams.title_id_invalid === true;
  const prefillConsumedRef = useRef(false);
  const [prefillInfo, setPrefillInfo] = useState<{
    name: string; qty: string; unit: string; linkedWid: boolean;
  } | null>(null);
  /**
   * Fallback ketika deep-link membawa `title_id` yang tidak bisa dipakai:
   *   - "invalid":   param dikirim tapi bukan UUID (sudah dijaring
   *                  `validateSearch` → flag `title_id_invalid`).
   *   - "not_found": param UUID sah, tapi tidak ada judul ecer yang cocok
   *                  (mungkin sudah dihapus / bukan milik user).
   * Kita TIDAK mengalihkan otomatis karena owner masih bisa mengisi form
   * manual; alih-alih tampilkan banner + toast + link kembali ke /ecer.
   */
  const [prefillFallback, setPrefillFallback] = useState<
    { reason: "invalid" | "not_found" } | null
  >(null);
  const invalidToastRef = useRef(false);
  useEffect(() => {
    if (!prefillTitleIdInvalid) return;
    if (invalidToastRef.current) return;
    invalidToastRef.current = true;
    setPrefillFallback({ reason: "invalid" });
    toast.warning("Link judul ecer tidak valid", {
      description: "Form dibuka manual. Kembali ke halaman Ecer untuk memilih judul.",
    });
  }, [prefillTitleIdInvalid]);
  useEffect(() => {
    if (prefillConsumedRef.current) return;
    if (!prefillTitleId) return;
    if (initialRef.current) return; // draft menang
    if (titles.length === 0) return; // tunggu titles siap
    const t = titles.find((x) => x.id === prefillTitleId);
    if (!t) {
      prefillConsumedRef.current = true;
      setPrefillFallback({ reason: "not_found" });
      toast.warning("Judul ecer tidak ditemukan", {
        description: "Mungkin sudah dihapus. Form dibuka manual — pilih judul lain di halaman Ecer.",
      });
      return;
    }
    // Hanya prefill jika form masih blanko (1 baris kosong bawaan).
    const blank = rows.length === 1 && rows[0]?.name === "" && rows[0]?.title_id === "";
    if (!blank) { prefillConsumedRef.current = true; return; }
    prefillConsumedRef.current = true;
    const key = rows[0].key;
    setRows((s) => s.map((r) => (r.key === key ? {
      ...r,
      title_id: t.id,
      name: t.name,
      qty: t.target_grams != null ? String(t.target_grams) : "1",
      unit: t.unit_label ?? "",
      warehouse_item_id: t.warehouse_item_id,
    } : r)));
    verifyWid(key, t.warehouse_item_id);
    setTitle((cur) => cur.trim() ? cur : `Penyiapan ${t.name}`);
    setPrefillInfo({
      name: t.name,
      qty: t.target_grams != null ? String(t.target_grams) : "1",
      unit: t.unit_label ?? "",
      linkedWid: !!t.warehouse_item_id,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillTitleId, titles]);

  // Debounced duplicate-token check. Menjalankan RPC setelah token stabil ~450ms
  // sehingga tidak menembak DB pada setiap keystroke; hasil terakhir yang menang
  // dijaga lewat sequence number untuk menghindari race.
  useEffect(() => {
    if (created) return;
    const t = token.trim();
    if (!/^[A-Za-z0-9_-]{8,48}$/.test(t)) {
      setTokenCheck({ status: t.length === 0 ? "idle" : "invalid", token: t });
      return;
    }
    const seq = ++tokenCheckSeq.current;
    setTokenCheck({ status: "checking", token: t });
    const handle = window.setTimeout(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("prep_share_token_exists", { _token: t });
      if (tokenCheckSeq.current !== seq) return;
      if (error) {
        setTokenCheck({ status: "error", token: t, error: error.message });
        return;
      }
      setTokenCheck({ status: data ? "duplicate" : "unique", token: t });
    }, 450);
    return () => window.clearTimeout(handle);
  }, [token, created]);

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((s) => s.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function pickTitle(key: string, titleId: string) {
    const t = titles.find((x) => x.id === titleId);
    if (!t) {
      updateRow(key, { title_id: "", warehouse_item_id: null });
      verifyWid(key, null);
      return;
    }
    updateRow(key, {
      title_id: t.id,
      name: t.name,
      qty: t.target_grams != null ? String(t.target_grams) : "1",
      unit: t.unit_label ?? "",
      warehouse_item_id: t.warehouse_item_id,
    });
    verifyWid(key, t.warehouse_item_id);
  }
  function removeRow(key: string) {
    setRows((s) => (s.length <= 1 ? s : s.filter((r) => r.key !== key)));
    setVerify((v) => {
      const { [key]: _drop, ...rest } = v;
      return rest;
    });
    delete verifySeq.current[key];
  }

  type ValidatedTask = {
    t: string;
    tokenTrim: string;
    scheduledIso: string | null;
    items: Array<{ name: string; qty: number; unit: string | null; warehouse_item_id: string | null; ecer_title_id: string | null }>;
  };
  const [preview, setPreview] = useState<ValidatedTask | null>(null);

  function validate(): ValidatedTask | null {
    const t = title.trim();
    if (!t) { toast.error("Judul tugas wajib diisi"); return null; }
    if (!/^\d{4,8}$/.test(pin)) { toast.error("PIN harus 4–8 digit angka"); return null; }
    const tokenTrim = token.trim();
    if (!/^[A-Za-z0-9_-]{8,48}$/.test(tokenTrim)) {
      toast.error("Token harus 8–48 karakter (huruf, angka, - atau _)"); return null;
    }
    if (tokenCheck.status === "duplicate" && tokenCheck.token === tokenTrim) {
      toast.error("Token sudah dipakai", {
        description: "Token ini pernah dipakai tugas lain. Tekan Acak untuk membuat token baru.",
      });
      return null;
    }
    if (tokenCheck.status === "checking" && tokenCheck.token === tokenTrim) {
      toast.info("Sedang memeriksa token…", { description: "Tunggu sebentar lalu coba lagi." });
      return null;
    }
    let scheduledIso: string | null = null;
    if (scheduledAt.trim()) {
      const d = new Date(scheduledAt);
      if (Number.isNaN(d.getTime())) { toast.error("Jadwal tidak valid"); return null; }
      scheduledIso = d.toISOString();
    }
    const items = rows
      .map((r) => ({
        name: r.name.trim(),
        qty: Number(r.qty),
        unit: r.unit.trim() || null,
        warehouse_item_id: r.warehouse_item_id,
        ecer_title_id: r.title_id || null,
      }))
      .filter((r) => r.name.length > 0);
    if (items.length === 0) { toast.error("Tambahkan minimal 1 barang"); return null; }
    if (items.some((r) => !Number.isFinite(r.qty) || r.qty <= 0)) { toast.error("Jumlah setiap barang harus > 0"); return null; }
    const missingWid = items.filter((r) => !r.warehouse_item_id).length;
    if (missingWid > 0) {
      const ok = window.confirm(
        `${missingWid} barang belum dipilih dari daftar produk. Tugas tetap bisa dibuat, tetapi foto pegawai tidak akan otomatis muncul di kartu Beranda (1g/ST/SPR/GS) dan tombol Kirim via MCM hanya aktif untuk barang yang cocok.\n\nLanjutkan tanpa cocokkan?`,
      );
      if (!ok) return null;
    }
    return { t, tokenTrim, scheduledIso, items };
  }

  async function submit(v?: ValidatedTask) {
    const validated = v ?? validate();
    if (!validated) return;
    const { t, tokenTrim, scheduledIso, items } = validated;

    setBusy(true);
    const payload = items.map((r) => ({
      name: r.name,
      category: null,
      qty_requested: r.qty,
      unit_label: r.unit,
      ref_photo_path: null,
      warehouse_item_id: r.warehouse_item_id,
      ecer_title_id: r.ecer_title_id,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("prep_create_task", {
      _title: t,
      _note: note.trim() || null,
      _pin: pin,
      _share_token: tokenTrim,
      _items: payload,
      _scheduled_at: scheduledIso,
      // Paket yang dicentang pemilik untuk link ini. Kalau kosong, link
      // tidak membawa Paket Request sama sekali — hanya ecer.
      _title_ids: selectedPaketIds,
    });
    setBusy(false);
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("forbidden")) {
        return toast.error("Akses ditolak", {
          description: "Anda tidak memiliki peran admin untuk membuat tugas pegawai.",
        });
      }
      return toast.error(error.message);
    }
    const url = publicTaskUrl(tokenTrim);
    clearDraft();
    setCreated({ token: tokenTrim, pin, title: t, url });
    setPreview(null);
    toast.success("Tugas berhasil dibuat");
  }

  async function shareWa() {
    if (!created) return;
    const cleaned = phone.replace(/\D/g, "");
    // Pesan dibangun via fungsi murni yang diuji di
    // src/lib/tugas-share.test.ts — invariant "foto tiap barang" dan
    // "link Google Maps" dipertahankan lewat test, bukan komentar.
    const items = rows
      .filter((r) => r.name.trim().length > 0)
      .map((r) => ({ name: r.name.trim(), qty: Number(r.qty) || null, unit: r.unit.trim() || null }));
    const text = buildTugasBaruWaMessage({
      title: created.title,
      pin: created.pin,
      url: created.url,
      items,
    });
    // Validasi pra-kirim: pastikan setiap item punya baris foto & instruksi
    // maps sebelum tugas dibagikan. Jika ada yang hilang, blokir kirim dan
    // beri tahu admin persis apa yang bermasalah supaya bisa diperbaiki.
    const v = validateTugasBaruWaMessage(text, {
      title: created.title,
      pin: created.pin,
      url: created.url,
      items,
    });
    if (!v.ok) {
      toast.error("Pesan WA belum lengkap", {
        description: v.issues.join(" · "),
      });
      return;
    }
    const res = await shareToWhatsApp({ title: created.title, text, url: created.url, phone: cleaned || undefined });
    notifyShareResult(res);
  }

  function reset() {
    setCreated(null);
    setTitle("");
    setNote("");
    setPin(genPin());
    setRows([newRow()]);
    setPhone("");
    setToken(genShareToken());
    setScheduledAt("");
    setVerify({});
    verifySeq.current = {};
    clearDraft();
  }

  async function copyTaskUrl() {
    const t = token.trim();
    if (!/^[A-Za-z0-9_-]{8,48}$/.test(t)) {
      toast.error("Token belum valid", { description: "Isi token 8–48 karakter (huruf, angka, - atau _) terlebih dahulu." });
      return;
    }
    try {
      const url = publicTaskUrl(t);
      const res = await copyText(url);
      if (res.ok) {
        toast.success("URL tugas disalin", { description: url });
      } else {
        toast.error("Gagal menyalin URL", { description: "Izinkan akses clipboard lalu coba lagi." });
      }
    } catch (e) {
      toast.error("Token tidak bisa dibuat URL");
    }
  }

  function clearForm() {
    if (!window.confirm("Bersihkan formulir? Draft yang tersimpan akan dihapus.")) return;
    setTitle("");
    setNote("");
    setPin(genPin());
    setRows([newRow()]);
    setPhone("");
    setToken(genShareToken());
    setScheduledAt("");
    setVerify({});
    verifySeq.current = {};
    clearDraft();
  }

  return (
    <div className="mx-auto max-w-2xl space-ms-4 p-ms-4 animate-fade-in">
      <div className="flex items-center justify-between gap-ms-2">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="text-ms-lg font-semibold focus:outline-none">Buat Tugas Pegawai</h1>
          <p className="text-ms-xs text-muted-foreground">Buat token & PIN langsung dari UI — tanpa perlu akses database.</p>
        </div>
        <Link to="/tugas" className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent">
          <ArrowLeft className="h-3.5 w-3.5" /> Tugas
        </Link>
      </div>

      {created ? (
        <div className="space-ms-3 rounded-lg border bg-card p-ms-4 text-ms-sm">
          <div className="flex items-center gap-ms-2 text-success">
            <ShieldCheck className="h-4 w-4" /> <span className="font-medium">Tugas siap dibagikan</span>
          </div>
          <div className="space-y-1">
            <div className="text-ms-xs text-muted-foreground">Judul</div>
            <div className="font-medium">{created.title}</div>
          </div>
          <div className="grid grid-cols-1 gap-ms-3 sm:grid-cols-2">
            <Field label="PIN">
              <div className="flex items-center gap-ms-2">
                <code className="flex-1 rounded bg-muted px-ms-2 py-1 text-ms-base tracking-widest">{created.pin}</code>
                <button aria-label="Salin" type="button" onClick={() => copyText(created.pin)} className="rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </Field>
            <Field label="Link pegawai">
              <div className="flex items-center gap-ms-2">
                <code className="flex-1 truncate rounded bg-muted px-ms-2 py-1 text-ms-xs">{created.url}</code>
                <button aria-label="Salin" type="button" onClick={() => copyText(created.url)} className="rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent">
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <a href={created.url} target="_blank" rel="noreferrer" className="rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </Field>
          </div>
          <TaskQrCode url={created.url} pin={created.pin} title={created.title} />
          <Field label="Preview pesan WhatsApp">
            <details className="group rounded-md border bg-muted/40 open:bg-muted/60">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-ms-2 px-ms-3 py-ms-2 text-ms-xs font-medium">
                <span className="text-muted-foreground">
                  Klik untuk lihat/salin — pastikan instruksi <em>foto tiap barang</em> &amp; <em>link Google Maps</em> ada.
                </span>
                <span className="text-ms-2xs uppercase tracking-wide text-muted-foreground group-open:hidden">Buka</span>
                <span className="hidden text-ms-2xs uppercase tracking-wide text-muted-foreground group-open:inline">Tutup</span>
              </summary>
              <div className="border-t px-ms-3 py-ms-2">
                {(() => {
                  const previewItems = rows
                    .filter((r) => r.name.trim().length > 0)
                    .map((r) => ({ name: r.name.trim(), qty: Number(r.qty) || null, unit: r.unit.trim() || null }));
                  const previewText = buildTugasBaruWaMessage({
                    title: created.title,
                    pin: created.pin,
                    url: created.url,
                    items: previewItems,
                  });
                  const previewCheck = validateTugasBaruWaMessage(previewText, {
                    title: created.title,
                    pin: created.pin,
                    url: created.url,
                    items: previewItems,
                  });
                  return (
                    <>
                      {previewCheck.ok ? (
                        <div className="mb-2 flex items-center gap-ms-1.5 rounded-md border border-success/60 bg-success px-ms-2 py-1 text-ms-2xs font-medium text-success">
                          <Check className="h-3.5 w-3.5" /> Pesan lengkap — {previewItems.length} barang siap difoto &amp; instruksi maps ada.
                        </div>
                      ) : (
                        <div className="mb-2 rounded-md border border-destructive/50 bg-destructive/5 px-ms-2 py-1 text-ms-2xs text-destructive">
                          <div className="flex items-center gap-ms-1.5 font-semibold">
                            <ShieldAlert className="h-3.5 w-3.5" /> Pesan belum lolos validasi
                          </div>
                          <ul className="mt-0.5 list-disc pl-4">
                            {previewCheck.issues.map((it) => (
                              <li key={it}>{it}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-ms-2 text-ms-xs leading-snug">
{previewText}
                      </pre>
                      <div className="mt-2 flex flex-wrap justify-end gap-ms-2">
                        <button
                          type="button"
                          onClick={() => copyText(previewText)}
                          className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent"
                        >
                          <Copy className="h-3.5 w-3.5" /> Salin teks
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </details>
          </Field>
          <Field label="Kirim via MCM (opsional)">
            <div className="flex items-center gap-ms-2">
              <input
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08xxxxxxxxxx"
                className="flex-1 rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
              />
              <button type="button" onClick={shareWa} className="inline-flex items-center gap-ms-1 rounded-md bg-success px-ms-3 py-1.5 text-ms-xs font-medium text-white hover:bg-success">
                <MessageCircle className="h-3.5 w-3.5" /> Kirim
              </button>
            </div>
          </Field>
          <div className="flex flex-wrap gap-ms-2 pt-1">
            <button type="button" onClick={reset} className="inline-flex items-center gap-ms-1 rounded-md border px-ms-3 py-1.5 text-ms-xs hover:bg-accent">
              <RefreshCw className="h-3.5 w-3.5" /> Buat tugas lain
            </button>
            <Link to="/tugas" className="inline-flex items-center gap-ms-1 rounded-md border px-ms-3 py-1.5 text-ms-xs hover:bg-accent">
              Lihat daftar tugas
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-ms-3 rounded-lg border bg-card p-ms-4 text-ms-sm">
          <div className="flex items-start justify-between gap-ms-2">
            <SaveIndicator state={saveState} savedAt={savedAt} visible={savedVisible} reason={savedReason} tooltipMode={tooltipMode} />
            <TooltipModeToggle mode={tooltipMode} onChange={setTooltipMode} />
          </div>
          <LastSavedSummary savedAt={savedAt} reason={savedReason} tooltipMode={tooltipMode} />
          <AutosaveAnnouncer state={saveState} savedAt={savedAt} reason={savedReason} />
          {restored ? (
            <div className="flex items-start justify-between gap-ms-2 rounded-md border border-success/40 bg-success/10 px-ms-3 py-ms-2 text-ms-2xs text-success dark:text-success">
              <span>
                Draft sebelumnya dipulihkan otomatis — lanjutkan dari yang terakhir Anda isi.
              </span>
              <button
                type="button"
                onClick={clearForm}
                className="shrink-0 rounded border border-success/40 px-ms-2 py-0.5 text-ms-2xs hover:bg-success/10"
              >
                Bersihkan draft
              </button>
            </div>
          ) : null}
          {prefillInfo ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start justify-between gap-ms-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-ms-3 py-ms-2 text-ms-2xs text-sky-900 dark:text-sky-200"
            >
              <span className="min-w-0">
                Terisi otomatis dari <b className="break-words">{prefillInfo.name}</b>
                {" — qty "}
                <b>{prefillInfo.qty}{prefillInfo.unit ? ` ${prefillInfo.unit}` : ""}</b>
                {prefillInfo.linkedWid ? " · produk gudang tertaut" : " · belum tertaut produk gudang"}.
                {" "}Periksa sebelum mengirim.
              </span>
              <button
                type="button"
                onClick={() => setPrefillInfo(null)}
                className="shrink-0 rounded border border-sky-600/40 px-ms-2 py-0.5 text-ms-2xs hover:bg-sky-600/10"
                aria-label="Tutup ringkasan prefill"
              >
                Tutup
              </button>
            </div>
          ) : null}
          {prefillFallback ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="tugas-baru-prefill-fallback"
              data-reason={prefillFallback.reason}
              className="flex items-start justify-between gap-ms-2 rounded-md border border-warning/40 bg-warning/10 px-ms-3 py-ms-2 text-ms-2xs text-warning dark:text-warning"
            >
              <span className="min-w-0">
                {prefillFallback.reason === "invalid"
                  ? "Link tidak menyertakan judul ecer yang valid."
                  : "Judul ecer dari link tidak ditemukan (mungkin sudah dihapus)."}
                {" "}Form dibuka manual — Anda tetap bisa membuat tugas, atau{" "}
                <Link to="/ecer" className="underline underline-offset-2 font-medium">
                  kembali ke Ecer
                </Link>{" "}
                untuk memilih judul.
              </span>
              <button
                type="button"
                onClick={() => setPrefillFallback(null)}
                className="shrink-0 rounded border border-warning/40 px-ms-2 py-0.5 text-ms-2xs hover:bg-warning/10"
                aria-label="Tutup peringatan judul ecer"
              >
                Tutup
              </button>
            </div>
          ) : null}
          <Field label="Judul tugas">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Mis. Penyiapan pesanan Bu Ani"
              className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
            />
          </Field>
          <Field label="Catatan (opsional)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Instruksi tambahan untuk pegawai…"
              className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
            />
          </Field>
          <Field label="PIN (4–8 digit)">
            <div className="flex items-center gap-ms-2">
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                className="w-32 rounded-md border bg-background px-ms-2 py-1.5 text-ms-base tracking-widest"
              />
              <button type="button" onClick={() => setPin(genPin())} className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent">
                <RefreshCw className="h-3.5 w-3.5" /> Acak
              </button>
            </div>
          </Field>

          <Field label="Token tautan pegawai (8–48 karakter)">
            <div className="flex items-center gap-ms-2">
              <input
                value={token}
                onChange={(e) => setToken(e.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48))}
                placeholder="mis. abc123XYZ"
                className="flex-1 rounded-md border bg-background px-ms-2 py-1.5 font-mono text-ms-sm"
              />
              <button
                type="button"
                onClick={() => setToken(genShareToken())}
                className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent"
                title="Buat token acak baru"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Acak
              </button>
              <button
                type="button"
                onClick={copyTaskUrl}
                className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent"
                title="Salin URL pegawai berdasarkan token ini"
              >
                <Copy className="h-3.5 w-3.5" /> Salin URL
              </button>
            </div>
            <div className="mt-1 text-ms-2xs text-muted-foreground">
              Token dipakai di URL pegawai. Isi sendiri untuk memudahkan dikenali, atau tekan Acak untuk mengganti. Tombol Salin URL bisa dipakai kapan saja setelah token terisi.
            </div>
            <TokenDuplicateBadge check={tokenCheck} onRandom={() => setToken(genShareToken())} />
          </Field>

          <Field label="Jadwal penyiapan (opsional)">
            <div className="flex flex-wrap items-center gap-ms-2">
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
              />
              {scheduledAt && (
                <button
                  type="button"
                  onClick={() => setScheduledAt("")}
                  className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent"
                >
                  Hapus
                </button>
              )}
            </div>
            <div className="mt-1 text-ms-2xs text-muted-foreground">
              Waktu yang direncanakan pegawai mulai menyiapkan. Kosongkan bila tidak ada jadwal tetap.
            </div>
          </Field>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-ms-xs font-medium text-muted-foreground">Daftar barang</div>
              <div className="flex items-center gap-ms-2">
                <button
                  type="button"
                  onClick={() => {
                    const targets = rows.filter((r) => r.warehouse_item_id);
                    if (targets.length === 0) {
                      toast.info("Tidak ada baris terhubung untuk diverifikasi.");
                      return;
                    }
                    targets.forEach((r) => verifyWid(r.key, r.warehouse_item_id));
                    toast.success(`Memverifikasi ulang ${targets.length} baris…`);
                  }}
                  className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent"
                  title="Paksa ulang verifikasi status terhubung untuk semua baris"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Verifikasi ulang
                </button>
                <button type="button" onClick={() => setRows((s) => [...s, newRow()])} className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent">
                  <Plus className="h-3.5 w-3.5" /> Tambah
                </button>
              </div>
            </div>
            <div className="space-ms-2">
              {rows.map((r, i) => (
                <div key={r.key} className="grid grid-cols-12 items-center gap-ms-2 rounded-md border p-ms-2">
                  <div className="col-span-12 text-ms-2xs text-muted-foreground sm:hidden">Barang #{i + 1}</div>
                  <div className="col-span-12">
                    <label className="block space-y-1">
                      <div className="text-ms-2xs font-medium text-muted-foreground">
                        Pilih dari daftar produk (agar foto pegawai otomatis muncul di Beranda & tombol Kirim via MCM aktif)
                      </div>
                      <select
                        value={r.title_id}
                        onChange={(e) => pickTitle(r.key, e.target.value)}
                        className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
                      >
                        <option value="">— Bebas / manual —</option>
                        {titles.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.target_grams != null ? ` · ${t.target_grams}${t.unit_label ?? ""}` : ""}
                            {t.warehouse_item_id ? "" : " (belum terhubung gudang)"}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <input
                    value={r.name}
                    onChange={(e) => updateRow(r.key, { name: e.target.value })}
                    placeholder="Nama barang"
                    className="col-span-12 rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm sm:col-span-6"
                  />
                  <NumericTextField
                    value={r.qty}
                    onValueChange={(v) => updateRow(r.key, { qty: v })}
                    step={0.01}
                    placeholder="Jumlah"
                    className="col-span-5 rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm sm:col-span-3"
                  />
                  <input
                    value={r.unit}
                    onChange={(e) => updateRow(r.key, { unit: e.target.value })}
                    placeholder="Satuan (gram/pcs/botol)"
                    className="col-span-6 rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm sm:col-span-2"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(r.key)}
                    disabled={rows.length <= 1}
                    className="col-span-1 inline-flex items-center justify-center rounded-md border p-ms-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-40"
                    aria-label="Hapus baris"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <div className="col-span-12 text-ms-2xs">
                    {(() => {
                      const v = verify[r.key];
                      if (!r.warehouse_item_id) {
                        return (
                          <span className="text-warning">
                            ⚠ Belum terhubung produk — foto pegawai tidak akan tampil di kartu Beranda untuk barang ini.
                          </span>
                        );
                      }
                      if (!v || v.status === "checking") {
                        return <span className="text-muted-foreground">⏳ Memverifikasi tautan ke gudang…</span>;
                      }
                      if (v.status === "ok") {
                        return (
                          <span className="text-success">
                            ✓ Terhubung ke produk gudang <strong>{v.productName}</strong> — foto pegawai akan otomatis muncul di Beranda.
                          </span>
                        );
                      }
                      if (v.status === "missing") {
                        return (
                          <span className="text-destructive">
                            ✗ Produk gudang tidak ditemukan (mungkin sudah dihapus). Pilih produk lain atau pakai mode bebas.
                          </span>
                        );
                      }
                      if (v.status === "error") {
                        return (
                          <span className="text-destructive">
                            ✗ Gagal verifikasi: {v.error}{" "}
                            <button
                              type="button"
                              className="underline"
                              onClick={() => verifyWid(r.key, r.warehouse_item_id)}
                            >
                              Coba lagi
                            </button>
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-ms-2 pt-2">
            {paketOptions.length > 0 && (
              <div className="w-full rounded-lg border bg-card p-ms-3">
                <button
                  type="button"
                  onClick={() => setPaketOpen((o) => !o)}
                  className="flex w-full items-center justify-between gap-ms-2 text-left"
                  aria-expanded={paketOpen}
                >
                  <div className="min-w-0">
                    <div className="text-ms-sm font-semibold">Sertakan Paket Request</div>
                    <div className="text-ms-2xs text-muted-foreground">
                      {selectedPaketIds.length > 0
                        ? `${selectedPaketIds.length} dari ${paketOptions.length} paket dicentang`
                        : `Opsional · ${paketOptions.length} paket aktif tersedia`}
                    </div>
                  </div>
                  <span className="text-ms-xs text-muted-foreground">{paketOpen ? "Tutup" : "Buka"}</span>
                </button>
                {paketOpen && (
                  <div className="mt-ms-2 space-ms-1">
                    <div className="text-ms-2xs text-muted-foreground">
                      Hanya paket yang dicentang di bawah yang ikut ke link+PIN ini.
                      Paket yang tidak dicentang tetap bisa disertakan ke link lain nanti.
                    </div>
                    <ul className="mt-ms-2 space-ms-1">
                      {paketOptions.map((p) => {
                        const checked = selectedPaketIds.includes(p.id);
                        return (
                          <li key={p.id}>
                            <label className="flex cursor-pointer items-center gap-ms-2 rounded-md px-ms-2 py-ms-1 hover:bg-accent">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  paketTouchedRef.current = true;
                                  setSelectedPaketIds((prev) =>
                                    e.target.checked
                                      ? Array.from(new Set([...prev, p.id]))
                                      : prev.filter((id) => id !== p.id),
                                  );
                                }}
                                className="h-4 w-4"
                                disabled={busy}
                              />
                              <span className="text-ms-sm">{p.name}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                const changed = flushDraft("manual");
                toast.success(changed ? "Draft disimpan" : "Draft sudah tersimpan");
              }}
              disabled={busy}
              className="inline-flex items-center gap-ms-1 rounded-md border px-ms-3 py-ms-2 text-ms-xs hover:bg-accent disabled:opacity-50"
            >
              Simpan draft
            </button>
            <button
              type="button"
              onClick={() => {
                const v = validate();
                if (v) setPreview(v);
              }}
              disabled={busy}
              className="inline-flex items-center gap-ms-1 rounded-md bg-primary px-ms-4 py-ms-2 text-ms-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Membuat…" : "Pratinjau & buat"}
            </button>
          </div>
        </div>
      )}

      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.status === "blocked") blocker.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Draft belum tersimpan</AlertDialogTitle>
            <AlertDialogDescription>
              Perubahan terakhir masih dalam antrian autosave. Simpan dulu sebelum
              meninggalkan halaman, atau tetap lanjutkan jika ingin keluar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => { if (blocker.status === "blocked") blocker.reset(); }}
            >
              Tetap di sini
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                flushDraft("navigation");
                if (blocker.status === "blocked") blocker.proceed();
              }}
            >
              Simpan & keluar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Pratinjau tugas pegawai</AlertDialogTitle>
            <AlertDialogDescription>
              Periksa detail berikut sebelum tugas dibuat & dibagikan ke pegawai.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview && (() => {
            const url = publicTaskUrl(preview.tokenTrim);
            const jadwalStr = preview.scheduledIso
              ? new Date(preview.scheduledIso).toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short" })
              : "— (segera)";
            const itemsLines = preview.items
              .map((it, i) => `${i + 1}. ${it.name} — ${it.qty}${it.unit ? " " + it.unit : ""}`)
              .join("\n");
            const noteTrim = note.trim();
            const waMessage =
              `Halo, tolong siapkan barang berikut untuk *${preview.t}*.\n\n` +
              `${itemsLines}\n\n` +
              (preview.scheduledIso ? `Jadwal: ${jadwalStr}\n` : "") +
              (noteTrim ? `Catatan: ${noteTrim}\n` : "") +
              `\nBuka link, masukkan PIN, foto barang & kirim:\n${url}\nPIN: ${pin}`;
            return (
              <div className="max-h-[60vh] space-ms-3 overflow-y-auto text-ms-xs">
                <div className="rounded-lg border bg-muted/30 p-ms-3">
                  <div className="grid grid-cols-[90px_1fr] gap-y-1.5">
                    <div className="text-muted-foreground">Judul</div>
                    <div className="font-semibold">{preview.t}</div>
                    <div className="text-muted-foreground">Token</div>
                    <div className="break-all font-mono">{preview.tokenTrim}</div>
                    <div className="text-muted-foreground">PIN</div>
                    <div className="font-mono">{pin}</div>
                    <div className="text-muted-foreground">Jadwal</div>
                    <div>{jadwalStr}</div>
                    <div className="text-muted-foreground">Catatan</div>
                    <div className="whitespace-pre-wrap">{noteTrim || <span className="text-muted-foreground">—</span>}</div>
                    <div className="text-muted-foreground">Link</div>
                    <div className="break-all text-primary">{url}</div>
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Barang ({preview.items.length})
                  </div>
                  <ol className="space-y-1 rounded-lg border bg-card p-ms-3">
                    {preview.items.map((it, i) => (
                      <li key={i} className="flex items-start justify-between gap-ms-2">
                        <span className="truncate">
                          <span className="text-muted-foreground">{i + 1}.</span> {it.name}
                          {!it.warehouse_item_id && (
                            <span className="ml-1 text-ms-2xs text-warning dark:text-warning">(tanpa cocok produk)</span>
                          )}
                        </span>
                        <span className="shrink-0 font-mono">
                          {it.qty}{it.unit ? " " + it.unit : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Pesan yang akan diteruskan
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyText(waMessage)}
                      className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-2xs hover:bg-accent"
                    >
                      <Copy className="h-3 w-3" /> Salin
                    </button>
                  </div>
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-[#dcf8c6] p-ms-3 text-ms-2xs leading-relaxed text-[#111] dark:bg-success/40 dark:text-success">
                    {waMessage}
                  </pre>
                </div>
              </div>
            );
          })()}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} onClick={() => setPreview(null)}>Batal / edit</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); if (preview) void submit(preview); }}
            >
              {busy ? "Membuat…" : "Konfirmasi & buat tugas"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TokenDuplicateBadge({
  check,
  onRandom,
}: {
  check: {
    status: "idle" | "checking" | "unique" | "duplicate" | "invalid" | "error";
    token?: string;
    error?: string;
  };
  onRandom: () => void;
}) {
  if (check.status === "idle") return null;
  if (check.status === "invalid") return null;
  if (check.status === "checking") {
    return (
      <div className="mt-1 inline-flex items-center gap-ms-1 rounded-md bg-muted px-ms-2 py-0.5 text-ms-2xs text-muted-foreground">
        <svg className="h-2.5 w-2.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        Memeriksa apakah token sudah dipakai…
      </div>
    );
  }
  if (check.status === "unique") {
    return (
      <div className="mt-1 inline-flex items-center gap-ms-1 rounded-md bg-success/15 px-ms-2 py-0.5 text-ms-2xs font-medium text-success dark:text-success">
        <Check className="h-3 w-3" /> Token belum dipakai — aman
      </div>
    );
  }
  if (check.status === "duplicate") {
    return (
      <div className="mt-1 flex items-start justify-between gap-ms-2 rounded-md border border-destructive/50 bg-destructive/10 px-ms-2 py-1 text-ms-2xs text-destructive">
        <span className="flex items-start gap-ms-1">
          <ShieldAlert className="mt-px h-3 w-3 shrink-0" />
          <span>
            <b>Token sudah dipakai</b> oleh tugas lain. Ubah tokennya atau tekan Acak agar tugas baru bisa dibuat.
          </span>
        </span>
        <button
          type="button"
          onClick={onRandom}
          className="shrink-0 rounded border border-destructive/40 px-ms-2 py-0.5 text-ms-2xs font-medium hover:bg-destructive/10"
        >
          Acak token
        </button>
      </div>
    );
  }
  return (
    <div className="mt-1 inline-flex items-center gap-ms-1 rounded-md bg-warning/15 px-ms-2 py-0.5 text-ms-2xs text-warning dark:text-warning">
      <Info className="h-3 w-3" /> Gagal memeriksa token{check.error ? `: ${check.error}` : ""}. Coba lagi.
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-ms-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function fmtAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.round(diff / 1000);
  if (s < 5) return "baru saja";
  if (s < 60) return `${s} dtk lalu`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function formatSavedStamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${getTzInfo(d).label}`;
}

function getTzInfo(d: Date): { label: string; source: "locale" | "browser" | "fallback"; iana: string; offset: string } {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  const offset = `UTC${sign}${hh}:${mm}`;
  let iana = "—";
  try {
    iana = Intl.DateTimeFormat().resolvedOptions().timeZone || "—";
  } catch {}
  try {
    const parts = new Intl.DateTimeFormat("id-ID", { timeZoneName: "short" }).formatToParts(d);
    const tz = parts.find((p) => p.type === "timeZoneName")?.value;
    if (tz) return { label: tz, source: "locale", iana, offset };
  } catch {}
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(d);
    const tz = parts.find((p) => p.type === "timeZoneName")?.value;
    if (tz) return { label: tz, source: "browser", iana, offset };
  } catch {}
  return { label: offset, source: "fallback", iana, offset };
}

function reasonMeta(reason: "auto" | "navigation" | "manual") {
  // Kontras dijaga di kedua tema:
  // - Light: bg lembut 15% + teks gelap 700.
  // - Dark: bg lebih tebal 25% + teks terang 200 untuk rasio ≥ 4.5:1.
  if (reason === "manual")
    return {
      label: "Manual",
      cls: "bg-sky-500/15 text-sky-700 dark:bg-sky-400/25 dark:text-sky-200",
    };
  if (reason === "navigation")
    return {
      label: "Navigasi",
      cls: "bg-violet-500/15 text-violet-700 dark:bg-violet-400/25 dark:text-violet-200",
    };
  return {
    label: "Otomatis",
    cls: "bg-success/15 text-success dark:bg-success/25 dark:text-success",
  };
}

/**
 * Single source of truth for rendering `savedAt` across the autosave UI.
 * Every indicator, tooltip, ringkasan, and aria-live message reads from here
 * so the absolute stamp, relative time, timezone label, and reason copy stay
 * in lockstep.
 */
function describeSaved(
  savedAt: number | null,
  reason: "auto" | "navigation" | "manual",
  tooltipMode: TooltipMode = "ringkas",
) {
  const meta = reasonMeta(reason);
  if (!savedAt) {
    return {
      meta,
      stamp: null as string | null,
      ago: null as string | null,
      tz: null as ReturnType<typeof getTzInfo> | null,
      iso: null as string | null,
      tooltip: "Belum ada draft tersimpan",
      summary: "Belum tersimpan",
      announcement: "Belum tersimpan",
      copyText: "Belum ada draft tersimpan",
    };
  }
  const d = new Date(savedAt);
  const tz = getTzInfo(d);
  const stamp = formatSavedStamp(savedAt);
  const ago = fmtAgo(savedAt);
  const summary = `Tersimpan terakhir ${stamp} (${ago}) · ${meta.label}`;
  const sourceLabel =
    tz.source === "locale" ? "locale id-ID"
    : tz.source === "browser" ? "browser default"
    : "fallback offset UTC";
  // Mode ringkas: stamp · zona waktu · alasan (satu baris).
  // Mode lengkap: tampilkan semua detail langsung di tooltip native tanpa
  // perlu membuka popover. Detail penuh tetap tersedia di SavedDetailsPopover.
  const tooltip =
    tooltipMode === "lengkap"
      ? [
          `Tersimpan terakhir ${stamp}`,
          `Relatif: ${ago}`,
          `Alasan: ${meta.label}`,
          `Zona waktu: ${tz.label} (${tz.iana}, ${tz.offset})`,
          `Sumber label: ${sourceLabel}`,
        ].join("\n")
      : `${stamp} · ${tz.label} · ${meta.label}`;
  const copyText = [
    `Tersimpan terakhir: ${stamp}`,
    `Relatif: ${ago}`,
    `Alasan: ${meta.label}`,
    `Zona waktu: ${tz.label}`,
    `IANA: ${tz.iana}`,
    `Offset: ${tz.offset}`,
    `Sumber label: ${sourceLabel}`,
    `ISO: ${d.toISOString()}`,
    `Epoch (ms): ${savedAt}`,
  ].join("\n");
  return {
    meta,
    stamp,
    ago,
    tz,
    iso: d.toISOString(),
    tooltip,
    summary,
    announcement: `Draft tersimpan ${meta.label.toLowerCase()} pukul ${stamp}`,
    copyText,
  };
}

function LastSavedSummary({ savedAt, reason, tooltipMode }: { savedAt: number | null; reason: "auto" | "navigation" | "manual"; tooltipMode: TooltipMode }) {
  const info = describeSaved(savedAt, reason, tooltipMode);
  // Label SR menjelaskan isi tooltip ringkas/lengkap apa adanya, sehingga
  // pembaca layar tidak hanya mendengar "Tersimpan terakhir 12.34" tetapi
  // juga zona waktu + alasan (ringkas) atau seluruh detail (lengkap).
  const modeLabel = tooltipMode === "lengkap" ? "tooltip lengkap" : "tooltip ringkas";
  const ariaLabel = info.stamp
    ? `Tersimpan terakhir — ${modeLabel}: ${info.tooltip.replace(/\n/g, ", ")}`
    : "Belum ada draft tersimpan";
  return (
    <div
      className="flex flex-wrap items-center gap-ms-1.5 text-ms-2xs text-muted-foreground"
      role="group"
      aria-label={ariaLabel}
      title={info.tooltip}
    >
      <span className="font-medium text-foreground/80" aria-hidden="true">Tersimpan terakhir:</span>
      {/* Re-mount inner content on tooltip-mode change so the visual
          difference (badge tone, popover label) crossfades smoothly
          via animate-fade-in instead of snapping in place. */}
      <span
        key={`mode-${tooltipMode}`}
        className="inline-flex flex-wrap items-center gap-ms-1.5 animate-fade-in [animation-duration:220ms] motion-reduce:animate-none motion-reduce:[animation-duration:0ms]"
      >
        {info.stamp ? (
          <>
            <span className="tabular-nums" aria-hidden="true">{info.stamp}</span>
            <span className="text-muted-foreground/70" aria-hidden="true">({info.ago})</span>
            <span
              className={`rounded-sm px-1.5 py-px text-ms-2xs font-medium transition-colors duration-300 motion-reduce:transition-none ${info.meta.cls}`}
              aria-hidden="true"
            >
              {info.meta.label}
            </span>
          </>
        ) : (
          <span
            className="rounded-sm bg-muted px-1.5 py-px text-ms-2xs font-medium text-muted-foreground"
            aria-hidden="true"
          >
            Belum ada
          </span>
        )}
        <SavedDetailsPopover info={info} tooltipMode={tooltipMode} />
      </span>
    </div>
  );
}

function SavedDetailsPopover({ info, tooltipMode }: { info: ReturnType<typeof describeSaved>; tooltipMode: TooltipMode }) {
  const [copied, setCopied] = useState(false);
  // Mode ringkas → hanya stamp · zona waktu · alasan (sebaris dengan tooltip).
  // Mode lengkap → semua detail (IANA, offset, sumber label, ISO, epoch).
  const isShort = tooltipMode === "ringkas";
  const textToCopy = isShort && info.stamp && info.tz
    ? `${info.stamp} · ${info.tz.label} · ${info.meta.label}`
    : info.copyText;
  const copyLabel = isShort ? "Salin ringkas" : "Salin lengkap";
  const triggerLabel = isShort
    ? "Buka detail lengkap waktu autosave (saat ini tooltip ringkas)"
    : "Buka detail lengkap waktu autosave (saat ini tooltip lengkap)";
  const dialogTitle = isShort
    ? "Detail waktu autosave — mode ringkas"
    : "Detail waktu autosave — mode lengkap";
  const textareaLabel = isShort
    ? "Teks detail ringkas (stamp, zona waktu, alasan) — siap disalin"
    : "Teks detail lengkap (IANA, offset, sumber label, ISO, epoch) — siap disalin";
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      toast.success(isShort ? "Detail ringkas tersalin" : "Detail lengkap tersalin");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Gagal menyalin — silakan pilih dan salin manual");
    }
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          aria-haspopup="dialog"
          className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <Info className="h-3 w-3" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={dialogTitle}
        className="w-[320px] space-ms-3 p-ms-3 text-ms-2xs"
      >
        <div className="flex items-center justify-between">
          <span className="text-ms-xs font-semibold" id="autosave-detail-heading">
            {dialogTitle}
          </span>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-0.5 text-ms-2xs hover:bg-accent"
            aria-label={copyLabel}
            aria-live="polite"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Tersalin" : copyLabel}
          </button>
        </div>
        {info.stamp && info.tz ? (
          <>
            <DetailGrid
              rows={
                isShort
                  ? [
                      { label: "Stamp", value: info.stamp, mono: true },
                      { label: "Zona", value: info.tz.label },
                      { label: "Alasan", value: info.meta.label },
                    ]
                  : [
                      { label: "Stamp", value: info.stamp, mono: true },
                      { label: "Relatif", value: info.ago ?? "-" },
                      { label: "Alasan", value: info.meta.label },
                      { label: "Zona", value: info.tz.label },
                      { label: "IANA", value: info.tz.iana, mono: true },
                      { label: "Offset", value: info.tz.offset, mono: true },
                      {
                        label: "Sumber",
                        value:
                          info.tz.source === "locale"
                            ? "Intl id-ID (locale)"
                            : info.tz.source === "browser"
                            ? "Intl default (browser)"
                            : "Fallback offset UTC",
                      },
                      { label: "ISO", value: info.iso ?? "-", mono: true, wrap: true },
                    ]
              }
            />
            <details className="group rounded-md border bg-muted/30">
              <summary className="cursor-pointer list-none px-ms-2 py-1 text-ms-2xs font-medium text-muted-foreground hover:text-foreground">
                Teks siap-salin ▾
              </summary>
              <textarea
                readOnly
                value={textToCopy}
                onFocus={(e) => e.currentTarget.select()}
                className={`${isShort ? "h-12" : "h-40"} w-full resize-none rounded-b-md border-0 border-t bg-background p-ms-2 font-mono text-ms-2xs leading-snug tabular-nums`}
                aria-label={textareaLabel}
                aria-describedby="autosave-detail-heading"
              />
            </details>
          </>
        ) : (
          <p className="text-ms-2xs text-muted-foreground">Belum ada draft tersimpan.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DetailGrid({ rows }: { rows: { label: string; value: string; mono?: boolean; wrap?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-ms-2xs">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd
            className={`select-all text-foreground ${r.mono ? "font-mono tabular-nums" : ""} ${
              r.wrap ? "break-all" : "truncate"
            }`}
            title={r.value}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TooltipModeToggle({ mode, onChange }: { mode: TooltipMode; onChange: (m: TooltipMode) => void }) {
  return (
    <div
      className="flex items-center gap-ms-1 text-ms-2xs text-muted-foreground"
      role="group"
      aria-label="Mode tooltip autosave"
    >
      <span className="mr-1">Tooltip:</span>
      {(["ringkas", "lengkap"] as const).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            aria-pressed={active}
            className={`rounded-sm border px-1.5 py-px capitalize transition-colors duration-300 ease-out ${
              active
                ? "border-foreground/30 bg-foreground/10 text-foreground dark:border-foreground/40 dark:bg-foreground/15"
                : "border-transparent text-muted-foreground hover:bg-muted dark:hover:bg-muted/60"
            } motion-reduce:transition-none`}
            title={
              m === "ringkas"
                ? "Tooltip ringkas: stamp · zona waktu · alasan"
                : "Tooltip lengkap: tampilkan semua detail di tooltip"
            }
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

function AutosaveAnnouncer({
  state,
  savedAt,
  reason,
}: {
  state: "idle" | "pending" | "saved";
  savedAt: number | null;
  reason: "auto" | "navigation" | "manual";
}) {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (state === "pending") {
      setMessage("Menyimpan draft…");
      return;
    }
    const info = describeSaved(savedAt, reason);
    if (state === "saved") {
      setMessage(info.announcement);
      return;
    }
    if (!savedAt) setMessage(info.announcement);
  }, [state, savedAt, reason]);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}

function SaveIndicator({ state, savedAt, visible, reason, tooltipMode }: { state: "idle" | "pending" | "saved"; savedAt: number | null; visible: boolean; reason: "auto" | "navigation" | "manual"; tooltipMode: TooltipMode }) {
  const show = state === "pending" || (state === "saved" && visible);
  // Keep the last non-idle content mounted during the fade-out so the
  // text doesn't blank out before the opacity transition finishes.
  const lastContentRef = useRef<React.ReactNode>(null);
  const reasonLabel =
    reason === "navigation" ? "Disimpan karena navigasi"
    : reason === "manual" ? "Disimpan manual"
    : null;
  const info = describeSaved(savedAt, reason, tooltipMode);
  const savedStamp = info.stamp;
  const content =
    state === "pending" ? (
      <span
        className="inline-flex items-center gap-ms-1 rounded-sm bg-warning/15 px-1.5 py-px text-warning dark:bg-warning/25 dark:text-warning"
        title={info.tooltip}
      >
        <svg
          className="h-2.5 w-2.5 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span className="font-medium">Menyimpan…</span>
      </span>
    ) : state === "saved" ? (
      <span
        className="inline-flex items-center gap-ms-1"
        title={info.tooltip}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        Tersimpan
        {savedStamp ? (
          <>
            <span className="tabular-nums">
              {" "}
              · {savedStamp}
            </span>
            <span className="text-muted-foreground/70"> ({info.ago})</span>
          </>
        ) : (
          <span className="ml-1 rounded-sm bg-muted px-1 py-px text-[9px] font-medium text-muted-foreground">
            Belum tersimpan
          </span>
        )}
        {reasonLabel ? (
          <span className="ml-1 rounded-sm bg-success/15 px-1 py-px text-[9px] font-medium text-success dark:bg-success/25 dark:text-success">
            {reasonLabel}
          </span>
        ) : null}
      </span>
    ) : null;
  if (content) lastContentRef.current = content;
  return (
    <div
      className={`pointer-events-none flex h-4 justify-end text-ms-2xs text-muted-foreground transition-opacity duration-700 ease-out motion-reduce:transition-none motion-reduce:duration-0 ${
        show ? "opacity-100" : "opacity-0"
      }`}
      aria-live="polite"
      aria-hidden={!show}
    >
      {/* Crossfade ringan saat tooltipMode berubah supaya perubahan
          isi title/aria tidak terasa seperti flicker, sekalipun konten
          terlihat sama. */}
      <span
        key={`mode-${tooltipMode}`}
        className="inline-flex animate-fade-in [animation-duration:220ms] motion-reduce:animate-none motion-reduce:[animation-duration:0ms]"
      >
        {content ?? lastContentRef.current}
      </span>
    </div>
  );
}