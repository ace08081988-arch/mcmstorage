import { createFileRoute, redirect } from "@tanstack/react-router";
import { isChatOnly } from "@/lib/app-mode";
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { toast } from "sonner";
import { notifyError } from "@/lib/friendly-error";
import { useNavigate, Link } from "@tanstack/react-router";
import { PackagePlus, Send, CheckCircle2, Search } from "lucide-react";
import { EmptyState, ListSkeleton } from "@/components/shell/EmptyState";

import { MidnightScope } from "@/lib/midnight-preview";
const LiveProductGallery = lazy(() =>
  import("@/components/LiveProductGallery").then((m) => ({ default: m.LiveProductGallery })),
);
const HeroAnalyticsPanel = lazy(() =>
  import("@/components/HeroAnalyticsPanel").then((m) => ({ default: m.HeroAnalyticsPanel })),
);
import { supabase } from "@/integrations/supabase/client";
import { isAutoLockEnabled, setAutoLockEnabled, AUTO_LOCK_EVENT } from "@/lib/auto-lock";
import {
  getLockConfig,
  requestLockNow,
  APP_LOCK_EVENT,
  type LockConfig,
} from "@/lib/app-lock";
import { perfMark, perfMeasure } from "@/lib/perf-log";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// AppLockSetup / AppearanceSettings / ProductEditDrawer di-lazy-load agar
// tidak masuk chunk initial Beranda. Ketiganya hanya benar-benar dibutuhkan
// setelah user membuka dialog/drawer masing-masing. Sebelum optimisasi:
// chunk _authenticated.index ≈ 508KB gzip 123KB karena ikut membawa
// pengaturan tampilan, editor produk lengkap, dan setup PIN/pola.
const AppLockSetup = lazy(() =>
  import("@/components/AppLockSetup").then((m) => ({ default: m.AppLockSetup })),
);
const AppearanceSettings = lazy(() =>
  import("@/components/appearance-settings").then((m) => ({ default: m.AppearanceSettings })),
);
const ProductEditDrawer = lazy(() =>
  import("@/components/ProductEditDrawer").then((m) => ({ default: m.ProductEditDrawer })),
);
import { confirm } from "@/lib/confirm";
const SecurityScanReminder = lazy(() =>
  import("@/components/SecurityScanReminder").then((m) => ({ default: m.SecurityScanReminder })),
);
const SecurityFindingsBanner = lazy(() =>
  import("@/components/SecurityFindingsBanner").then((m) => ({ default: m.SecurityFindingsBanner })),
);
import { NumericDraftInput } from "@/components/NumericDraftInput";
import { usePhotoEditorFlow } from "@/components/photo-editor/use-photo-editor-flow";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { canonical, socialMeta } from "@/lib/seo-meta";
// Bagian "Lainnya" hanya dipakai setelah user membuka <details>.
// Dipecah jadi chunk terpisah lewat React.lazy agar landing inti (hero
// stepper + form kategori) tidak menyeret JS ini di initial bundle.
const ReadyEcerSection = lazy(() =>
  import("@/components/ReadyEcerSection").then((m) => ({ default: m.ReadyEcerSection })),
);
const ReadyRequestSection = lazy(() =>
  import("@/components/ReadyRequestSection").then((m) => ({ default: m.ReadyRequestSection })),
);
const ReadySelfPrepSection = lazy(() =>
  import("@/components/ReadySelfPrepSection").then((m) => ({ default: m.ReadySelfPrepSection })),
);

// Mark saat modul landing pertama kali dievaluasi (proxy untuk "nav start").
// Dipakai sebagai anchor untuk mengukur waktu sampai konten inti terlihat.
perfMark("landing:module-eval");

/**
 * Sentinel kecil yang di-render di dalam Suspense children.
 * Effect-nya hanya jalan setelah semua lazy child selesai resolve,
 * jadi kita bisa memanggilnya sebagai "chunk Lainnya selesai mount".
 */
function LainnyaMountSentinel() {
  useEffect(() => {
    perfMark("landing:lainnya-mount-end");
    perfMeasure(
      "landing:lainnya-mount",
      "landing:lainnya-mount-start",
      "landing:lainnya-mount-end",
    );
  }, []);
  return null;
}

/**
 * Baris kategori yang bisa di-drag-reorder. Handle drag (grip) dipisah
 * dari tombol pilih kategori supaya tap-untuk-buka tetap responsif —
 * di HP, drag hanya aktif kalau user menekan area handle. `useSortable`
 * memberi transform untuk animasi geser saat item lain menyusul.
 */
function SortableCategoryRow({
  name,
  count,
  tag,
  onOpen,
  onDelete,
  onRename,
}: {
  name: string;
  count: number;
  tag: string;
  onOpen: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: name });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`surface-quiet flex items-center gap-ms-2 px-ms-2 py-ms-3 ${
        isDragging ? "shadow-lg !border-primary/60" : ""
      }`}
    >
      <button
        type="button"
        aria-label={`Geser untuk ubah urutan kategori ${name}`}
        title="Tahan lalu geser untuk ubah urutan"
        className="shrink-0 touch-none cursor-grab rounded-md p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        {/* GripVertical (inline SVG — hindari import lucide baru) */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="9" cy="5" r="1" />
          <circle cx="9" cy="12" r="1" />
          <circle cx="9" cy="19" r="1" />
          <circle cx="15" cy="5" r="1" />
          <circle cx="15" cy="12" r="1" />
          <circle cx="15" cy="19" r="1" />
        </svg>
      </button>
      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-ms-3 text-left"
      >
        <span className="inline-flex shrink-0 items-center rounded-md border border-primary/40 bg-background px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] text-primary">
          {tag}
        </span>
        <span className="text-premium-heading truncate text-[1rem] text-foreground">
          {name}
        </span>
        <span className="ml-auto shrink-0 text-[0.65625rem] text-muted-foreground">
          {count} pesanan
        </span>
      </button>
      <button
        onClick={onRename}
        className="shrink-0 rounded-md border border-primary/30 px-ms-2 py-1 text-[0.65625rem] font-medium text-primary transition-colors hover:bg-primary/10"
        title={`Ubah nama kategori ${name}`}
        aria-label={`Ubah nama kategori ${name}`}
        data-testid={`rename-cat-${name}`}
      >
        Ubah
      </button>
      <button
        onClick={onDelete}
        className="shrink-0 rounded-md border border-destructive/30 px-ms-2 py-1 text-[0.65625rem] font-medium text-destructive transition-colors hover:bg-destructive/10"
        title={`Hapus kategori ${name}`}
        aria-label={`Hapus kategori ${name}`}
        data-testid={`delete-cat-${name}`}
      >
        Hapus
      </button>
    </li>
  );
}

export const Route = createFileRoute("/_authenticated/")({
  beforeLoad: async () => {
    // Mode chat-only via build flag / localStorage override.
    if (isChatOnly()) throw redirect({ to: "/chat" });
    // Akun yang ditandai chat_only di database juga selalu diarahkan ke /chat,
    // walau saat ini berjalan di APK full — supaya tidak mendarat di halaman
    // storage yang sudah diblokir RLS.
    try {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (uid) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("chat_only")
          .eq("id", uid)
          .maybeSingle();
        if (prof?.chat_only) throw redirect({ to: "/chat" });
      }
    } catch (e) {
      // rethrow redirect; abaikan error lain agar halaman tetap termuat.
      if (e && typeof e === "object" && "to" in (e as Record<string, unknown>)) throw e;
    }
  },
  head: () => ({
    meta: socialMeta({
      title: "Ace Storage — Kelola pesanan & kirim cepat lewat WhatsApp",
      description:
        "Catat pesanan harian, lampirkan foto & lokasi, tandai status pengiriman, dan kirim detail ke pelanggan lewat WhatsApp dalam satu halaman.",
      url: "/",
    }),
    links: [canonical("/")],
  }),
  component: Index,
});

type Status = "Belum Dikirim" | "Sudah Dikirim";
type Kategori = string;

export type Satuan = "gram" | "kg" | "botol" | "sachet" | "pcs" | "lusin" | "pak" | "dus";

/**
 * H2: Batas SSOT — Beranda vs Gudang.
 *
 * `user_storage.items` (JSON di baris ini) HANYA jurnal pesanan harian
 * yang dicatat manual dari halaman Beranda (kirim WA, kelola status
 * "Belum Dikirim" / "Sudah Dikirim"). Ini BUKAN inventaris.
 *
 * Inventaris (stok, harga jual, modal, penjualan) SSOT-nya di tabel
 * relasional: `warehouse_items`, `sales`, `customer_payments`, dll —
 * dikelola dari halaman Gudang & POS Kasir. Jangan mem-fork data stok
 * ke `user_storage`; jangan pakai `Produk.jumlah` di sini untuk
 * mendorong stok gudang.
 *
 * Bila di masa depan Beranda perlu menampilkan barang gudang, ambil
 * langsung dari `warehouse_items` (bukan copy ke `user_storage`).
 */

const SATUAN_LIST: Satuan[] = ["gram", "kg", "botol", "sachet", "pcs", "lusin", "pak", "dus"];

function satuanBounds(s: Satuan): { min: number; max: number; step: number } {
  switch (s) {
    case "gram":
      return { min: 0.01, max: 5000, step: 0.01 };
    case "kg":
      return { min: 0.001, max: 5, step: 0.001 };
    default:
      return { min: 1, max: 9999, step: 1 };
  }
}

export function formatJumlah(j: number, s: Satuan): string {
  const n = Number.isFinite(j) ? j : 0;
  if (s === "gram") return `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })} g`;
  if (s === "kg") return `${n.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg`;
  return `${n.toLocaleString("id-ID")} ${s}`;
}

// NumericDraftInput sekarang di-import dari @/components/NumericDraftInput
// (lihat baris import di atas). Definisi lokal lama dihapus sebagai bagian
// dari SSOT sweep — jangan re-add di sini.

export type Produk = {
  id: number;
  kategori: Kategori;
  nama: string;
  harga: number;
  status: Status;
  keterangan: string;
  lokasi: string;
  satuan?: Satuan;
  jumlah?: number;
  foto?: string;
  galeri?: string[];
  /** Timestamp (ms epoch) saat status terakhir berubah menjadi "Sudah Dikirim". */
  sent_at?: number;
};

function tagFor(kat: Kategori): string {
  return kat.trim().slice(0, 3) || "—";
}

const THEME_KEY = "penjualan-theme";
const VIEW_KEY = "penjualan-view";
const ACTIVE_CAT_KEY = "penjualan-active-cat";

function rupiah(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);
}

/** True jika ts berada dalam rentang hari kalender lokal hari ini. */
function isToday(ts: number | undefined): boolean {
  if (!ts) return false;
  const d = new Date(ts);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

export function buildPesan(p: Produk) {
  const s = p.satuan ?? "pcs";
  const j = p.jumlah ?? 1;
  // Defensif: nama/lokasi/keterangan bisa `null` / `undefined` di jalur data
  // cacat (row lama, import mentah). Jangan biarkan literal "null" /
  // "undefined" muncul ke user; jangan pula throw di `.toLocaleString`.
  const nama = p.nama ?? "";
  const lokasi = p.lokasi ?? "";
  const ket = p.keterangan ?? "";
  const harga = Number.isFinite(p.harga as number) ? (p.harga as number) : 0;
  return `📦 [${tagFor(p.kategori)}] *${nama}*\n⚖️ ${formatJumlah(j, s)}\n💰 Harga: Rp ${harga.toLocaleString("id-ID")}\n📍 ${lokasi}\nKet: ${ket}`;
}

/**
 * SSOT link "KIRIM WA" per pesanan.
 *
 * Aturan: hanya pesanan berstatus "Belum Dikirim" yang punya link berisi
 * pesan (wa.me?text=...). Begitu ditandai "Sudah Dikirim", link WAJIB kosong
 * ("") sehingga tombol tidak dirender — mencegah kirim ulang pesanan yang
 * sudah dikirim ke pelanggan.
 */
export function waHrefFor(p: Produk): string {
  if (p.status === "Sudah Dikirim") return "";
  return `https://wa.me/?text=${encodeURIComponent(buildPesan(p))}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(file: File, maxSize = 1280, quality = 0.75): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function Index() {
  const navigate = useNavigate();
  const signOut = async () => {
    const ok = await confirm({
      title: "Keluar dari akun?",
      description:
        "Sesi login di perangkat ini akan diakhiri dan Anda perlu masuk kembali.",
      confirmText: "Ya, keluar",
      cancelText: "Batal",
      destructive: true,
    });
    if (!ok) return;
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  const [uid, setUid] = useState<string | null>(null);
  const [autoLock, setAutoLock] = useState(false);
  const [lockCfg, setLockCfg] = useState<LockConfig | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const id = data.user?.id ?? null;
      setUid(id);
      if (id) {
        setAutoLock(isAutoLockEnabled(id));
        setLockCfg(getLockConfig(id));
      }
    });
    const sync = () => {
      supabase.auth.getUser().then(({ data }) => {
        const id = data.user?.id ?? null;
        if (id) {
          setAutoLock(isAutoLockEnabled(id));
          setLockCfg(getLockConfig(id));
        }
      });
    };
    window.addEventListener(AUTO_LOCK_EVENT, sync);
    window.addEventListener(APP_LOCK_EVENT, sync);
    return () => {
      window.removeEventListener(AUTO_LOCK_EVENT, sync);
      window.removeEventListener(APP_LOCK_EVENT, sync);
    };
  }, []);
  const toggleAutoLock = () => {
    if (!uid) return;
    const next = !autoLock;
    setAutoLock(next);
    setAutoLockEnabled(uid, next);
    toast.success(next ? "Kunci otomatis aktif" : "Kunci otomatis dimatikan");
  };
  const lockMenu = (compact: boolean, triggerClassName?: string) => {
    const label = lockCfg
      ? compact
        ? "🔒"
        : `🔒 ${lockCfg.method === "pin" ? "PIN" : "Pola"}`
      : compact
      ? "🔓"
      : "🔓 Atur Kunci";
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={
              triggerClassName ??
              `inline-flex h-8 items-center justify-center rounded-md border px-ms-2 text-[0.6875rem] font-medium hover:bg-accent ${
                lockCfg ? "bg-accent" : ""
              }`
            }
            title="Kunci aplikasi"
            aria-label="Kunci aplikasi"
          >
            {label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {lockCfg ? (
            <>
              <DropdownMenuItem onClick={() => requestLockNow()}>
                🔒 Kunci Sekarang
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSetupOpen(true)}>
                ⚙️ Ubah Metode / Opsi
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/pengaturan-kunci">📄 Pengaturan Kunci</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleAutoLock}>
                {autoLock ? "✓ " : ""}Kunci saat keluar aplikasi
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onClick={() => setSetupOpen(true)}>
                🔧 Atur Kunci (PIN/Pola/Sidik Jari)
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/pengaturan-kunci">📄 Pengaturan Kunci</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleAutoLock}>
                {autoLock ? "✓ " : ""}Kunci saat keluar aplikasi
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const resetAllData = async () => {
    if (!(await confirm({
      title: "Reset semua data?",
      description: "Semua kategori dan produk milik akun ini akan dihapus permanen.",
      confirmText: "Hapus semua",
      destructive: true,
    }))) return;
    if (!(await confirm({
      title: "Yakin reset ke nol?",
      description: "Konfirmasi sekali lagi sebelum melanjutkan.",
      confirmText: "Ya, reset",
      destructive: true,
    }))) return;
    setItems([]);
    setCategories([]);
    setActiveCat(null);
    setSelected(new Set());
    setSelectMode(false);
    setOpenId(null);
    toast.success("Semua data berhasil dihapus.");
  };
  const [items, setItems] = useState<Produk[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // Deferred mount: bagian "Lainnya" baru dimount saat user pertama kali
  // membuka <details>. Chunk lazy di atas juga baru di-fetch pada momen
  // ini, sehingga landing inti tidak terkena biaya JS-nya.
  const [lainnyaMounted, setLainnyaMounted] = useState(false);
  // Perf: catat momen user pertama kali men-trigger mount "Lainnya"
  // (hover/focus/toggle). Pasangannya di-mark oleh <LainnyaMountSentinel/>
  // di dalam Suspense children, sehingga durasinya = fetch chunk + render.
  useEffect(() => {
    if (!lainnyaMounted) return;
    perfMark("landing:lainnya-mount-start");
  }, [lainnyaMounted]);
  // H11: skip the first save after hydration so mounting the page
  // doesn't upsert identical data back to user_storage.
  const skipNextSaveRef = useRef(false);
  /**
   * Guard konkurensi reorder ↔ realtime/refresh:
   * - `reorderInFlightRef`: true selama batch UPDATE posisi berjalan.
   *   Realtime/refresh yang datang di window ini di-drop supaya urutan
   *   optimistic lokal (yang lebih baru) tidak tertimpa snapshot lama.
   * - `reorderSeqRef`: nomor urut monotonik per reorder. Setelah reorder
   *   selesai, hanya reorder ter-baru yang boleh memicu reconcile —
   *   kalau user cepat drag berkali-kali, reorder yang lebih tua
   *   berhenti diam-diam tanpa mengembalikan urutan lama.
   */
  const reorderInFlightRef = useRef(false);
  const reorderSeqRef = useRef(0);
  // Perf: hero (bagian inti) dianggap "visible" saat data ter-hydrate
  // dan branch landing (tanpa activeCat) selesai render pertama kali.
  // Effect memastikan browser sudah commit DOM-nya sebelum mengukur.
  const heroMeasuredRef = useRef(false);
  const [filter, setFilter] = useState<"semua" | Status>(() => {
    if (typeof window === "undefined") return "semua";
    const v = window.localStorage.getItem("mcm_filter");
    if (v === "Belum Dikirim" || v === "Sudah Dikirim" || v === "semua") return v;
    return "semua";
  });
  const [openId, setOpenId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [categories, setCategories] = useState<string[]>([]);
  // Sensor DnD:
  // - PointerSensor dengan distance 6px → tap di area handle tetap
   //   terasa seperti klik biasa; drag baru aktif setelah geser sedikit.
  // - TouchSensor delay 180ms → di HP, tap cepat tidak memicu drag
  //   supaya tombol Hapus / pilih kategori tetap responsif.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // M19: SATU sumber kebenaran untuk kategori aktif. Sebelumnya ada dua
  // key localStorage (`mcm_active_cat` dan `ACTIVE_CAT_KEY`) yang keduanya
  // ditulis pada setiap perubahan → 2× I/O per klik chip kategori dan
  // rawan divergen bila salah satu path gagal. Konsolidasi ke
  // `ACTIVE_CAT_KEY` (konstanta bernama) untuk baca dan tulis.
  const [activeCat, setActiveCat] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(ACTIVE_CAT_KEY);
    } catch {
      return null;
    }
  });
  const [newCatName, setNewCatName] = useState("");
  useEffect(() => {
    if (heroMeasuredRef.current) return;
    if (!hydrated || activeCat) return;
    heroMeasuredRef.current = true;
    perfMark("landing:hero-visible");
    perfMeasure(
      "landing:time-to-hero",
      "landing:module-eval",
      "landing:hero-visible",
    );
  }, [hydrated, activeCat]);
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem("mcm_rail_open");
    if (saved === "1") return true;
    if (saved === "0") return false;
    return window.innerWidth >= 640;
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("mcm_rail_open", railOpen ? "1" : "0");
    } catch {
      /* ignore quota errors */
    }
  }, [railOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem("mcm_filter", filter);
    } catch {
      /* ignore */
    }
  }, [filter]);

  // Persistensi ditangani effect tunggal di bawah (setelah `hydrated`).
  // Effect di sini dihapus untuk menghilangkan double-write ke localStorage.

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY) as "list" | "grid" | null;
      if (v) setViewMode(v);
    } catch {}
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) {
        setHydrated(true);
        return;
      }
      const { data, error } = await supabase
        .from("user_storage")
        .select("items")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) {
        notifyError(error, { prefix: "Gagal memuat data: " });
      } else {
        const loadedItems = Array.isArray(data?.items) ? (data!.items as unknown as Produk[]) : [];
        skipNextSaveRef.current = true;
        setItems(loadedItems);
      }
      // Kategori dibaca dari master `warehouse_categories` (SSOT dengan Gudang).
      const { data: catRows, error: catErr } = await supabase
        .from("warehouse_categories")
        .select("name, position")
        .order("position", { ascending: true })
        .order("name", { ascending: true });
      if (catErr) {
        notifyError(catErr, { prefix: "Gagal memuat kategori: " });
      } else {
        const loadedCats = (catRows ?? []).map((r) => r.name);
        setCategories(loadedCats);
        try {
          const saved = localStorage.getItem(ACTIVE_CAT_KEY);
          if (saved && loadedCats.includes(saved)) setActiveCat(saved);
        } catch {}
      }
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid || cancelled) return;
      const { error } = await supabase
        .from("user_storage")
        .upsert({ user_id: uid, items: items as any });
      if (error && !cancelled) notifyError(error, { prefix: "Gagal menyimpan: " });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [items, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(VIEW_KEY, viewMode);
  }, [viewMode, hydrated]);

  /**
   * Ambil ulang urutan kategori dari server (SSOT `warehouse_categories`).
   * Dipakai oleh realtime channel, listener focus/visibilitychange, dan
   * reconcile pasca-reorder. Guard: bila reorder sedang jalan, drop
   * snapshot supaya urutan optimistic lokal tidak dilibas snapshot
   * server yang lebih lama. Kalau hasil fetch identik dengan state
   * sekarang, tidak re-render.
   */
  const refreshCategories = useCallback(async () => {
    if (reorderInFlightRef.current) return;
    const { data, error } = await supabase
      .from("warehouse_categories")
      .select("name, position")
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (error || !data) return;
    if (reorderInFlightRef.current) return;
    const next = data.map((r) => r.name);
    setCategories((prev) =>
      prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next,
    );
  }, []);

  /**
   * Sinkron realtime `warehouse_categories`:
   * - subscribe INSERT/UPDATE/DELETE untuk uid saat ini,
   * - juga refresh saat tab kembali fokus / visibility berubah,
   *   supaya user yang balik dari tab lain langsung lihat urutan
   *   terkini.
   * Guard reorder ada di dalam `refreshCategories` supaya event yang
   * datang tepat di tengah drag tidak menimpa urutan optimistic.
   */
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`warehouse_categories:${uid}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "warehouse_categories",
            filter: `user_id=eq.${uid}`,
          },
          () => {
            void refreshCategories();
          },
        )
        .subscribe();
    })();
    const onFocus = () => {
      void refreshCategories();
    };
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refreshCategories();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisibility);
    }
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [hydrated, refreshCategories]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (activeCat) localStorage.setItem(ACTIVE_CAT_KEY, activeCat);
      else localStorage.removeItem(ACTIVE_CAT_KEY);
    } catch {}
  }, [activeCat, hydrated]);

  const scopedItems = useMemo(
    () => (activeCat ? items.filter((i) => i.kategori === activeCat) : items),
    [items, activeCat],
  );
  const total = useMemo(
    () => scopedItems.reduce((s, i) => s + i.harga, 0),
    [scopedItems],
  );

  const update = (id: number, patch: Partial<Produk>) =>
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  // Editor mandatory step untuk semua upload foto Beranda (setFoto & addGaleri).
  const photoFlow = usePhotoEditorFlow();

  const setFoto = async (id: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    await photoFlow.open(
      [files[0]],
      async ({ dataUrl }) => {
        update(id, { foto: dataUrl });
        setOpenId(id);
        toast.success("Foto tersimpan");
      },
      {
        onDone: () => {
          if (typeof navigator !== "undefined" && navigator.geolocation) {
            const tId = toast.loading("Mengambil lokasi…");
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const { latitude, longitude } = pos.coords;
                const link = `https://www.google.com/maps?q=${latitude},${longitude}`;
                update(id, { lokasi: link });
                toast.success("Lokasi otomatis terisi", { id: tId });
              },
              (err) => {
                notifyError(err, { prefix: "Gagal ambil lokasi: " });
              },
              { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
            );
          }
        },
      },
    );
  };

  const addGaleri = async (id: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    await photoFlow.open(files, async ({ dataUrl }) => {
      setItems((items) =>
        items.map((i) =>
          i.id === id ? { ...i, galeri: [...(i.galeri ?? []), dataUrl] } : i,
        ),
      );
    });
  };

  const removeFoto = (id: number) => update(id, { foto: undefined });
  const removeGaleri = (id: number, idx: number) =>
    setItems((items) =>
      items.map((i) =>
        i.id === id
          ? { ...i, galeri: (i.galeri ?? []).filter((_, n) => n !== idx) }
          : i,
      ),
    );

  const reset = async () => {
    if (!activeCat) return;
    const ok = await confirm({
      title: "Hapus semua pesanan?",
      description: `Semua pesanan di kategori "${activeCat}" akan dihapus.`,
      confirmText: "Hapus",
      destructive: true,
    });
    if (ok) setItems((arr) => arr.filter((i) => i.kategori !== activeCat));
  };

  const addCategory = async (name: string) => {
    const v = name.trim();
    if (!v) return;
    // Case-insensitive dedupe (mirror unique index di DB).
    if (categories.some((c) => c.toLowerCase() === v.toLowerCase())) {
      toast.error("Kategori sudah ada");
      return;
    }
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) {
      toast.error("Harus login untuk membuat kategori");
      return;
    }
    const nextPos = categories.length;
    const { error } = await supabase
      .from("warehouse_categories")
      .insert({ user_id: uid, name: v, position: nextPos });
    if (error) {
      // Unique-violation → race dengan tab lain / Gudang.
      if ((error as { code?: string }).code === "23505") {
        toast.error("Kategori sudah ada");
      } else {
        notifyError(error, { prefix: "Gagal membuat kategori: " });
      }
      return;
    }
    setCategories((c) => [...c, v]);
    setActiveCat(v);
    setNewCatName("");
    toast.success(`Kategori "${v}" dibuat`);
  };

  const deleteCategory = async (name: string) => {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) {
      toast.error("Harus login untuk menghapus kategori");
      return;
    }
    // Guard: jangan hapus kategori yang masih dipakai di Gudang.
    // Filter case-insensitive supaya cocok dengan aturan unik di DB
    // (`unique (user_id, lower(btrim(name)))`).
    const { count, error: countErr } = await supabase
      .from("warehouse_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .ilike("category", name);
    if (countErr) {
      notifyError(countErr, { prefix: "Gagal memeriksa pemakaian kategori: " });
      return;
    }
    if ((count ?? 0) > 0) {
      toast.error(
        `Kategori "${name}" masih dipakai ${count} produk di Gudang. Pindahkan atau hapus produknya dulu di halaman Gudang, baru kategori bisa dihapus.`,
        { duration: 6000 },
      );
      return;
    }
    const ok = await confirm({
      title: `Hapus kategori "${name}"?`,
      description:
        "Kategori akan dihapus dari Beranda dan Gudang. Pesanan lama di kategori ini ikut dihapus dari Beranda.",
      confirmText: "Hapus",
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase
      .from("warehouse_categories")
      .delete()
      .eq("user_id", uid)
      .eq("name", name);
    if (error) {
      notifyError(error, { prefix: "Gagal menghapus kategori: " });
      return;
    }
    setCategories((c) => c.filter((x) => x !== name));
    setItems((arr) => arr.filter((i) => i.kategori !== name));
    if (activeCat === name) setActiveCat(null);
    toast.success(`Kategori "${name}" dihapus`);
  };

  /**
   * Rename kategori atomik lewat RPC `rename_warehouse_category`:
   * server-side validasi collision case-insensitive + kaskade
   * `warehouse_items.category` di dalam satu transaksi supaya tidak
   * ada window di mana kategori sudah berpindah nama tapi produk
   * masih menempel di nama lama. `renameTarget` menahan nama lama
   * dan input baru untuk dialog inline; loading state dipakai supaya
   * tombol Simpan tidak bisa di-double-tap saat request berjalan.
   */
  const [renameTarget, setRenameTarget] = useState<{ old: string; input: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const submitRename = async () => {
    if (!renameTarget) return;
    const oldName = renameTarget.old;
    const rawNew = renameTarget.input;
    const newName = rawNew.trim().replace(/\s+/g, " ");
    if (!newName) {
      toast.error("Nama kategori tidak boleh kosong");
      return;
    }
    if (newName === oldName) {
      setRenameTarget(null);
      return;
    }
    if (
      newName.toLowerCase() !== oldName.toLowerCase() &&
      categories.some((c) => c.toLowerCase() === newName.toLowerCase())
    ) {
      toast.error(`Kategori "${newName}" sudah ada`);
      return;
    }
    setRenaming(true);
    const { data, error } = await supabase.rpc("rename_warehouse_category", {
      _old_name: oldName,
      _new_name: newName,
    });
    setRenaming(false);
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        toast.error(`Kategori "${newName}" sudah ada`);
      } else {
        notifyError(error, { prefix: "Gagal mengubah nama kategori: " });
      }
      return;
    }
    const renamedItems = Number(data ?? 0);
    setCategories((c) => c.map((x) => (x === oldName ? newName : x)));
    setItems((arr) =>
      arr.map((i) =>
        i.kategori.toLowerCase() === oldName.toLowerCase() ? { ...i, kategori: newName } : i,
      ),
    );
    if (activeCat === oldName) setActiveCat(newName);
    setRenameTarget(null);
    toast.success(
      renamedItems > 0
        ? `Kategori diubah ke "${newName}" (${renamedItems} produk ikut diperbarui)`
        : `Kategori diubah ke "${newName}"`,
    );
  };

  /**
   * Drag-and-drop reorder kategori.
   * - Optimistic: susun ulang UI dulu supaya feel-nya instan di HP.
   * - Persist: kirim `position` baru per kategori ke `warehouse_categories`
   *   (RLS `auth.uid() = user_id` sudah mengunci scope per pemilik).
   * - Rollback: kalau salah satu UPDATE gagal, kembalikan urutan lama +
   *   toast error supaya state UI dan DB tidak divergen.
   * - Konkurensi: `reorderInFlightRef` mem-block realtime/refresh selama
   *   batch UPDATE berjalan supaya urutan optimistic lokal tidak dilibas
   *   snapshot lama dari server. Setelah selesai, `reorderSeqRef` memakai
   *   token monotonik supaya hanya reorder ter-baru yang memicu
   *   `refreshCategories` — mencegah reconcile urutan lama menimpa
   *   urutan yang lebih baru dari user atau tab lain.
   */
  const reorderCategories = async (fromName: string, toName: string) => {
    if (fromName === toName) return;
    const prev = categories;
    const fromIdx = prev.indexOf(fromName);
    const toIdx = prev.indexOf(toName);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = arrayMove(prev, fromIdx, toIdx);
    const mySeq = ++reorderSeqRef.current;
    reorderInFlightRef.current = true;
    setCategories(next);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const uid = user?.id;
    if (!uid) {
      setCategories(prev);
      reorderInFlightRef.current = false;
      toast.error("Sesi berakhir. Silakan masuk ulang.");
      return;
    }

    // Batch update posisi. `warehouse_categories` punya unique
    // `(user_id, lower(btrim(name)))` — position bebas diubah tanpa
    // menabrak constraint. Kirim parallel supaya cepat.
    const results = await Promise.all(
      next.map((name, idx) =>
        supabase
          .from("warehouse_categories")
          .update({ position: idx })
          .eq("user_id", uid)
          .eq("name", name),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setCategories(prev);
      reorderInFlightRef.current = false;
      notifyError(failed.error, { prefix: "Gagal menyimpan urutan kategori: " });
      return;
    }
    reorderInFlightRef.current = false;
    // Hanya reorder ter-baru yang boleh reconcile — reorder lain yang
    // sudah keburu selesai duluan tidak boleh menimpa urutan yang baru.
    if (mySeq === reorderSeqRef.current) {
      void refreshCategories();
    }
  };

  const addProduk = () => {
    if (!activeCat) return;
    const nextId = items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
    const fresh: Produk = {
      id: nextId,
      kategori: activeCat,
      nama: `Produk ${nextId}`,
      harga: 0,
      status: "Belum Dikirim",
      keterangan: "",
      lokasi: "",
      satuan: "pcs",
      jumlah: 1,
    };
    setItems((arr) => [...arr, fresh]);
    setOpenId(nextId);
  };

  const resetStatus = async () => {
    const ok = await confirm({
      title: "Reset status pengiriman?",
      description: "Semua pesanan akan ditandai sebagai Belum Dikirim.",
      confirmText: "Tandai ulang",
    });
    if (ok)
      setItems((arr) =>
        arr.map((i) => ({ ...i, status: "Belum Dikirim", sent_at: undefined })),
      );
  };

  const filtered = scopedItems.filter((i) => filter === "semua" || i.status === filter);

  const toggleSelect = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectAllVisible = () => {
    const ids = filtered.map((i) => i.id);
    const allIn = ids.every((id) => selected.has(id));
    setSelected((s) => {
      const n = new Set(s);
      if (allIn) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  };

  const selectedItems = items.filter((i) => selected.has(i.id));
  const bulkTotal = selectedItems.reduce((s, i) => s + i.harga, 0);

  const bulkPesan = () =>
    selectedItems.map((p, idx) => `${idx + 1}. ${buildPesan(p)}`).join("\n\n") +
    `\n\n💵 *Total: ${rupiah(bulkTotal)}*`;

  const bulkWaUrl = `https://wa.me/?text=${encodeURIComponent(bulkPesan())}`;

  const markSent = (id: number) => {
    const target = items.find((i) => i.id === id);
    const prevSentAt = target?.sent_at;
    const now = Date.now();
    setItems((arr) =>
      arr.map((i) =>
        i.id === id ? { ...i, status: "Sudah Dikirim", sent_at: now } : i,
      ),
    );
    toast.success(`Terkirim · ${target?.nama ?? "Pesanan"} ditandai sudah dikirim`, {
      action: {
        label: "Urungkan",
        onClick: () =>
          setItems((arr) =>
            arr.map((i) =>
              i.id === id
                ? { ...i, status: "Belum Dikirim", sent_at: prevSentAt }
                : i,
            ),
          ),
      },
    });
  };

  const removeItem = async (id: number) => {
    const snapshot = items;
    const target = items.find((i) => i.id === id);
    const ok = await confirm({
      title: "Hapus pesanan?",
      description: `Pesanan "${target?.nama ?? ""}" akan dihapus dari penyimpanan.`,
      confirmText: "Hapus",
      destructive: true,
    });
    if (!ok) return;
    setItems((arr) => arr.filter((i) => i.id !== id));
    toast.success(`Pesanan dihapus`, {
      action: {
        label: "Urungkan",
        onClick: () => setItems(snapshot),
      },
    });
  };

  const bulkMarkSent = () => {
    if (selected.size === 0) return;
    const ids = new Set(selected);
    const count = ids.size;
    const prevSentAt = new Map<number, number | undefined>();
    for (const it of items) if (ids.has(it.id)) prevSentAt.set(it.id, it.sent_at);
    const now = Date.now();
    setItems((arr) =>
      arr.map((i) =>
        ids.has(i.id) ? { ...i, status: "Sudah Dikirim", sent_at: now } : i,
      ),
    );
    setSelected(new Set());
    toast.success(`${count} pesanan ditandai sudah dikirim`, {
      action: {
        label: "Urungkan",
        onClick: () =>
          setItems((arr) =>
            arr.map((i) =>
              ids.has(i.id)
                ? { ...i, status: "Belum Dikirim", sent_at: prevSentAt.get(i.id) }
                : i,
            ),
          ),
      },
    });
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-background px-ms-3 py-ms-4 sm:px-ms-6">
        <div className="mx-auto w-full max-w-6xl space-ms-3">
          <div className="h-8 w-40 animate-pulse rounded-full bg-muted/60" />
          <ListSkeleton rows={5} label="Memuat daftar pesanan…" />
        </div>
      </div>
    );
  }


  if (!activeCat) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        {/* Ambient accent glow — mengikuti warna primary tema aktif */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 -z-0 h-64 opacity-70"
          style={{
            background:
              "radial-gradient(60% 100% at 50% 0%, color-mix(in oklab, var(--primary) 18%, transparent) 0%, color-mix(in oklab, var(--primary) 6%, transparent) 40%, transparent 75%)",
          }}
        />

        {/* Di mobile header ini duplikat dengan AppHeader (brand + judul) dan
            aksi keluar/kunci sudah ada di menu avatar — tampilkan hanya md+. */}
        <header className="app-sticky-header hidden md:block">

          <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-ms-2 px-ms-4 py-ms-3 sm:px-ms-6">
            <div className="flex min-w-0 items-center gap-ms-2.5">
              <span
                aria-hidden
                className="numeral-editorial grid h-9 w-9 shrink-0 place-items-center rounded-full border border-primary/45 bg-card text-[0.9375rem] shadow-[0_0_22px_-6px_color-mix(in_oklab,var(--primary)_60%,transparent)]"
              >
                M
              </span>
              <div className="min-w-0 leading-tight">
                <p className="text-premium-heading truncate text-[1.0625rem] text-foreground">
                  Ace Storage
                </p>
                <p className="truncate text-[0.5625rem] font-semibold uppercase tracking-[0.26em] text-primary/65">
                  Retail Operations
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-ms-2">
            {lockMenu(true, "app-hit-area inline-flex h-8 w-8 items-center justify-center rounded-full border border-primary/25 bg-card text-foreground hover:border-primary/60")}
            <button
              onClick={signOut}
              className="inline-flex h-8 items-center justify-center rounded-full border border-primary/25 bg-card px-ms-3 text-[0.6875rem] font-medium tracking-wide text-foreground transition-colors hover:border-primary/60 hover:bg-accent"
            >
              Keluar
            </button>
            </div>
          </div>
        </header>

        <main className="relative mx-auto w-full max-w-md space-y-8 px-ms-4 pt-7 pb-14 sm:max-w-2xl sm:px-ms-6 sm:pt-10">
          {/* Hero: alur kerja aplikasi */}
          <section className="surface-editorial overflow-hidden p-ms-5 sm:p-ms-6">
            <span className="eyebrow">
              <span className="hairline w-6" />
              Alur Kerja
            </span>
            <h1 className="text-premium-heading mt-3.5 text-[1.75rem] leading-[1.12] text-foreground sm:text-[2.125rem]">
              Dari <em className="not-italic text-primary">stok</em> ke tangan
              pelanggan — satu alur, tanpa kebocoran.
            </h1>
            <p className="mt-3 max-w-prose text-[0.84375rem] leading-relaxed text-muted-foreground">
              Empat langkah inti yang menjalankan Ace Storage setiap hari.
            </p>
            <div className="hairline mt-5" />

            <ol className="mt-5 space-ms-2.5">
              {[
                { n: "01", to: "/gudang", t: "Gudang", d: "Kelola stok, pembelian, dan harga modal." },
                { n: "02", to: "/ecer", t: "Siapkan Pesanan", d: "Ecer & request — timbang, kemas, verifikasi." },
                { n: "03", to: "/tugas", t: "Tugas Pegawai", d: "Bagikan link + PIN untuk penyiapan lapangan." },
                { n: "04", to: "/chat", t: "Kirim via Ace Chat", d: "Rangkuman order otomatis ke pelanggan." },
              ].map((step) => (
                <li key={step.n}>
                  <Link
                    to={step.to}
                    preload="intent"
                    className="surface-quiet group flex items-center gap-ms-3 px-ms-3.5 py-ms-3"
                  >
                    <span className="numeral-editorial grid h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/35 bg-background text-[0.9375rem]">
                      {step.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-premium-heading block text-[1.0625rem] text-foreground">
                        {step.t}
                      </span>
                      <span className="mt-0.5 block truncate text-[0.71875rem] leading-snug text-muted-foreground">
                        {step.d}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className="shrink-0 text-primary/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                    >
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          {/* CTA inti: kategori */}
          <section className="space-ms-3">
            <h2 className="sr-only">Kategori</h2>
            <span className="eyebrow">
              <span className="hairline w-6" />
              {categories.length === 0 ? "Mulai" : "Kategori"}
            </span>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addCategory(newCatName);
              }}
              className="surface-editorial p-ms-4"
            >
              <label className="text-premium-heading mb-2.5 block text-[1.0625rem] text-foreground">
                {categories.length === 0 ? "Buat kategori pertama" : "Tambah kategori"}
              </label>
              <div className="flex gap-ms-2">
                <input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Sembako, Pakaian, 1 gram…"
                  className="h-11 w-full min-w-0 rounded-xl border border-primary/20 bg-background px-ms-3 text-[0.84375rem] text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
                />
                <button
                  type="submit"
                  className="h-11 shrink-0 rounded-xl bg-primary px-ms-4 text-[0.78125rem] font-semibold tracking-tight text-primary-foreground shadow-[0_10px_24px_-10px_color-mix(in_oklab,var(--primary)_75%,transparent)] transition-transform hover:bg-primary/90 active:scale-[0.98]"
                >
                  Buat
                </button>
              </div>
            </form>

            {categories.length > 0 && (
              <DndContext
                sensors={dndSensors}
                collisionDetection={closestCenter}
                onDragEnd={(e: DragEndEvent) => {
                  const { active, over } = e;
                  if (!over || active.id === over.id) return;
                  void reorderCategories(String(active.id), String(over.id));
                }}
              >
                <SortableContext items={categories} strategy={verticalListSortingStrategy}>
                  <ul className="grid gap-ms-2">
                    {categories.map((c) => (
                      <SortableCategoryRow
                        key={c}
                        name={c}
                        tag={tagFor(c)}
                        count={items.filter((i) => i.kategori === c).length}
                        onOpen={() => setActiveCat(c)}
                        onDelete={() => deleteCategory(c)}
                        onRename={() => setRenameTarget({ old: c, input: c })}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
            {/* Dialog bersama: ikut fokus-trap, Escape, safe-area, dan
                kompensasi keyboard yang sama seperti dialog lain. Versi
                lamanya adalah overlay buatan sendiri tanpa semua itu. */}
            <Dialog
              open={renameTarget !== null}
              onOpenChange={(o) => {
                if (!o && !renaming) setRenameTarget(null);
              }}
            >
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Ubah nama kategori</DialogTitle>
                  <DialogDescription>
                    Kategori lama:{" "}
                    <span className="font-medium text-foreground">{renameTarget?.old}</span>
                  </DialogDescription>
                </DialogHeader>
                <Input
                  autoFocus
                  value={renameTarget?.input ?? ""}
                  onChange={(e) =>
                    setRenameTarget((t) => (t ? { ...t, input: e.target.value } : t))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !renaming) void submitRename();
                  }}
                  data-testid="rename-cat-input"
                  placeholder="Nama baru…"
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={renaming}
                    onClick={() => setRenameTarget(null)}
                  >
                    Batal
                  </Button>
                  <Button
                    type="button"
                    disabled={renaming}
                    onClick={() => void submitRename()}
                    data-testid="rename-cat-submit"
                  >
                    {renaming ? "Menyimpan…" : "Simpan"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </section>

          {/* Lainnya — dilipat agar tampilan awal hanya inti.
              onToggle memicu mount pertama kali sehingga chunk lazy baru
              diunduh saat user benar-benar ingin melihat isinya. */}
          <details
            className="surface-editorial group overflow-hidden"
            onToggle={(e) => {
              if ((e.currentTarget as HTMLDetailsElement).open && !lainnyaMounted) {
                setLainnyaMounted(true);
              }
            }}
          >
            <summary
              className="flex cursor-pointer list-none items-center justify-between gap-ms-2 px-ms-4 py-ms-4 text-[0.78125rem] font-medium tracking-tight text-foreground/80 [&::-webkit-details-marker]:hidden"
              onPointerEnter={() => setLainnyaMounted(true)}
              onFocus={() => setLainnyaMounted(true)}
            >
              <span className="eyebrow">
                <span className="hairline w-5" />
                Lainnya
              </span>
              <span className="text-primary/70 transition-transform group-open:rotate-180">
                ⌄
              </span>
            </summary>
            <div className="space-ms-4 border-t border-primary/10 p-ms-4">
              <div className="grid grid-cols-2 items-stretch gap-ms-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {[
                  { to: "/hutang-piutang", label: "Hutang & Piutang", emoji: "💳", desc: "Pelanggan & supplier" },
                  { to: "/kontak", label: "Pelanggan & Supplier", emoji: "👥", desc: "Tautkan akun pengguna" },
                  { to: "/request", label: "Penyiapan Request", emoji: "📦", desc: "Paket multi-produk" },
                  { to: "/katalog", label: "Katalog Produk", emoji: "🏷️", desc: "Daftar & harga produk" },
                  { to: "/pengaturan-kunci", label: "Pengaturan Kunci", emoji: "🔒", desc: "PIN, pola, sidik jari" },
                  { to: "/pengaturan-tampilan", label: "Tampilan", emoji: "🎨", desc: "Tema, aksen, font" },
                ].map((s) => (
                  <Link
                    key={s.to}
                    to={s.to}
                    preload="intent"
                    className="surface-quiet flex h-full w-full min-w-0 flex-col gap-0.5 px-ms-3 py-ms-3 text-left"
                  >
                    <span className="text-ms-base leading-none">{s.emoji}</span>
                    <span className="text-premium-heading mt-1 break-words text-ms-xs font-semibold leading-tight text-foreground">
                      {s.label}
                    </span>
                    <span className="break-words text-ms-2xs leading-tight text-muted-foreground">
                      {s.desc}
                    </span>
                  </Link>
                ))}
              </div>


              {lainnyaMounted && (
                <Suspense
                  fallback={
                    <div className="rounded-lg border border-primary/10 bg-card px-ms-3 py-ms-4 text-center text-[0.6875rem] text-muted-foreground">
                      Memuat…
                    </div>
                  }
                >
                  <ReadyEcerSection />
                  <ReadyRequestSection />
                  <ReadySelfPrepSection />
                  <LainnyaMountSentinel />
                </Suspense>
              )}

              {(categories.length > 0 || items.length > 0) && (
                <button
                  onClick={resetAllData}
                  className="w-full rounded-lg border border-destructive/30 bg-destructive/5 px-ms-3 py-ms-2.5 text-[0.71875rem] font-semibold tracking-tight text-destructive transition-colors hover:bg-destructive/10"
                >
                  🗑 Reset semua data saya
                </button>
              )}
            </div>
          </details>

          <div className="pt-4 text-center">
            <div className="mx-auto mb-3 h-px w-16 bg-primary/25" />
            <p className="text-[0.625rem] font-medium uppercase tracking-[0.3em] text-primary/45">
              Ace Storage · Barokah Rizki
            </p>
          </div>
        </main>
        {uid && setupOpen && (
          <Suspense fallback={null}>
            <AppLockSetup uid={uid} open={setupOpen} onOpenChange={setSetupOpen} />
          </Suspense>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background" data-press-scope="on">
      <MidnightScope />
      {/* Mobile drawer backdrop */}
      {railOpen && (
        <button
          aria-label="Tutup menu"
          onClick={() => setRailOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm sm:hidden"
        />
      )}
      {/* Vertical action rail */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-app-vh w-14 flex-col items-center gap-ms-1.5 border-r bg-card/95 px-1 py-ms-3 backdrop-blur transition-transform duration-200 sm:sticky sm:top-0 sm:z-20 sm:transition-[width,transform] ${
          railOpen
            ? "translate-x-0 sm:w-14"
            : "-translate-x-full sm:translate-x-0 sm:w-0 sm:overflow-hidden sm:border-r-0 sm:px-0"
        }`}
      >
        <button
          onClick={() => {
            setActiveCat(null);
            setSelectMode(false);
            setSelected(new Set());
            setOpenId(null);
          }}
          className="app-hit-area inline-flex h-9 w-9 items-center justify-center rounded-lg text-ms-base transition-colors hover:bg-accent"
          aria-label="Ganti kategori"
          title="Ganti kategori"
        >
          ↩
        </button>

        <div className="my-1 h-px w-6 bg-border" />

        <button
          onClick={addProduk}
          title="Tambah produk"
          aria-label="Tambah produk"
          className="app-hit-area inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-ms-base font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
        >
          +
        </button>
        <button
          onClick={() => {
            if (selectMode) exitSelect();
            else setSelectMode(true);
          }}
          title={selectMode ? "Selesai memilih" : "Pilih beberapa"}
          aria-label={selectMode ? "Selesai memilih" : "Pilih beberapa"}
          className={`app-hit-area inline-flex h-9 w-9 items-center justify-center rounded-lg text-ms-base transition-colors ${
            selectMode
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "hover:bg-accent"
          }`}
        >
          {selectMode ? "✓" : "☑"}
        </button>
        <button
          onClick={resetStatus}
          title="Reset status terkirim"
          aria-label="Reset status terkirim"
          className="app-hit-area inline-flex h-9 w-9 items-center justify-center rounded-lg text-ms-base transition-colors hover:bg-accent"
        >
          ↺
        </button>
        <button
          onClick={reset}
          title="Hapus semua"
          aria-label="Hapus semua"
          className="app-hit-area inline-flex h-9 w-9 items-center justify-center rounded-lg text-ms-base text-destructive transition-colors hover:bg-destructive/10"
        >
          🗑
        </button>

        <div className="my-1 h-px w-6 bg-border" />

        <button
          onClick={() => setViewMode("list")}
          className={`app-hit-area inline-flex h-9 w-9 items-center justify-center rounded-lg text-ms-base transition-colors ${
            viewMode === "list"
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "hover:bg-accent"
          }`}
          aria-label="Tampilan daftar"
          title="Daftar"
        >
          ☰
        </button>
        <button
          onClick={() => setViewMode("grid")}
          className={`app-hit-area inline-flex h-9 w-9 items-center justify-center rounded-lg text-ms-base transition-colors ${
            viewMode === "grid"
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "hover:bg-accent"
          }`}
          aria-label="Tampilan kotak"
          title="Kotak"
        >
          ▦
        </button>

        <div className="flex-1" />

        <Suspense
          fallback={
            <span
              aria-hidden
              className="app-hit-area inline-flex h-9 w-9 items-center justify-center rounded-lg text-ms-base leading-none text-muted-foreground/40"
            >
              ⚙
            </span>
          }
        >
          <AppearanceSettings
            compact
            triggerClassName="app-hit-area inline-flex h-9 w-9 items-center justify-center rounded-lg text-ms-base leading-none transition-colors hover:bg-accent"
          />
        </Suspense>
        <button
          onClick={() => {
            try {
              window.localStorage.removeItem("mcm_rail_open");
            } catch {
              /* ignore */
            }
            setRailOpen(
              typeof window !== "undefined" ? window.innerWidth >= 640 : true,
            );
            toast.success("Tampilan menu dikembalikan ke default");
          }}
          className="app-hit-area inline-flex h-9 w-9 items-center justify-center rounded-lg text-ms-base transition-colors hover:bg-accent"
          aria-label="Reset tampilan menu"
          title="Reset tampilan menu"
        >
          ⟲
        </button>
        {lockMenu(
          true,
          `app-hit-area inline-flex h-9 w-9 items-center justify-center rounded-lg text-ms-base transition-colors hover:bg-accent ${
            lockCfg ? "bg-accent" : ""
          }`,
        )}
        <button
          onClick={signOut}
          className="app-hit-area inline-flex h-9 w-9 items-center justify-center rounded-lg text-ms-base transition-colors hover:bg-accent"
          aria-label="Keluar"
          title="Keluar"
        >
          ⎋
        </button>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-sticky-header">
          <div className="mx-auto max-w-6xl px-ms-3 py-ms-3 sm:px-ms-6">
            <div className="flex items-center gap-ms-3">
              <button
                onClick={() => setRailOpen((v) => !v)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-card text-ms-base transition-colors hover:bg-accent"
                aria-label={railOpen ? "Sembunyikan menu" : "Tampilkan menu"}
                title={railOpen ? "Sembunyikan menu" : "Tampilkan menu"}
              >
                ☰
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-ms-base font-semibold tracking-tight">
                  {activeCat} · Ace Storage
                </h2>
                <p className="text-[0.6875rem] text-muted-foreground">
                  {scopedItems.length} pesanan · {rupiah(total)}
                </p>
              </div>
              <div className="inline-flex h-8 shrink-0 overflow-hidden rounded-full border bg-card">
                {(["semua", "Belum Dikirim", "Sudah Dikirim"] as const).map(
                  (f, i) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      title={
                        f === "semua"
                          ? "Semua"
                          : f === "Belum Dikirim"
                          ? "Belum dikirim"
                          : "Sudah dikirim"
                      }
                      className={`inline-flex shrink-0 items-center justify-center px-ms-3 text-[0.6875rem] font-medium transition-colors ${
                        i > 0 ? "border-l" : ""
                      } ${
                        filter === f
                          ? "bg-primary text-primary-foreground"
                          : "bg-card hover:bg-accent"
                      }`}
                    >
                      {f === "semua"
                        ? "Semua"
                        : f === "Belum Dikirim"
                        ? "Belum"
                        : "Terkirim"}
                    </button>
                  ),
                )}
              </div>
              <button
                onClick={() => {
                  setFilter("semua");
                  setActiveCat(null);
                  setSelectMode(false);
                  setSelected(new Set());
                  setOpenId(null);
                  toast.success("Filter dikembalikan ke default");
                }}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-card text-ms-base transition-colors hover:bg-accent"
                aria-label="Reset filter"
                title="Reset filter"
              >
                ⟲
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-ms-3 py-ms-3 sm:px-ms-6">
        <Suspense fallback={null}>
          <SecurityScanReminder />
          <SecurityFindingsBanner />
        </Suspense>
        <Suspense fallback={null}>
          <div className="mb-ms-3">
            <HeroAnalyticsPanel />
          </div>
        </Suspense>
        <Suspense fallback={null}>
          <div className="mb-ms-3">
            <LiveProductGallery />
          </div>
        </Suspense>
        {(() => {
          const total = scopedItems.length;
          const terkirim = scopedItems.filter((i) => i.status === "Sudah Dikirim");
          const belum = total - terkirim.length;
          const omzet = terkirim.reduce((s, i) => s + i.harga, 0);
          const terkirimHariIni = terkirim.filter((i) => isToday(i.sent_at));
          const omzetHariIni = terkirimHariIni.reduce((s, i) => s + i.harga, 0);
          const byUnit = new Map<Satuan, number>();
          for (const it of terkirim) {
            const s = it.satuan ?? "pcs";
            byUnit.set(s, (byUnit.get(s) ?? 0) + (it.jumlah ?? 0));
          }
          return (
            <div className="mb-3 grid grid-cols-2 gap-ms-2 rounded-lg border bg-card p-ms-2.5 text-[0.6875rem] sm:grid-cols-4">
              <div
                className="col-span-2 rounded-md border border-wa/30 bg-wa/10 p-ms-2 sm:col-span-4"
                role="status"
                aria-live="polite"
                title="Penjualan hari ini = jumlah harga semua pesanan yang ditandai Sudah Dikirim pada tanggal kalender lokal hari ini."
              >
                <p className="text-[0.65625rem] font-medium uppercase tracking-wide text-[#0F7A6C]">
                  Total penjualan hari ini
                </p>
                <p className="mt-0.5 text-ms-lg font-bold tabular-nums text-[#0F7A6C]">
                  {rupiah(omzetHariIni)}
                </p>
                <p className="text-[0.65625rem] text-[#0F7A6C]/80">
                  {terkirimHariIni.length} pesanan terkirim hari ini
                  {activeCat ? ` · kategori ${activeCat}` : ""}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Total pesanan</p>
                <p className="text-ms-sm font-semibold tabular-nums">{total}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Belum dikirim</p>
                <p className="text-ms-sm font-semibold tabular-nums">{belum}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Terjual</p>
                <p className="text-ms-sm font-semibold tabular-nums text-wa-strong">
                  {terkirim.length}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Omzet total</p>
                <p className="text-ms-sm font-semibold tabular-nums">{rupiah(omzet)}</p>
              </div>
              {byUnit.size > 0 && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-muted-foreground">Terjual per satuan</p>
                  <p className="text-ms-xs font-medium tabular-nums">
                    {Array.from(byUnit.entries())
                      .map(([s, j]) => formatJumlah(j, s))
                      .join(" · ")}
                  </p>
                </div>
              )}
            </div>
          );
        })()}

        <ul
          className={
            viewMode === "grid"
              ? "grid grid-cols-2 gap-ms-2 sm:grid-cols-3 lg:grid-cols-4"
              : "grid gap-ms-1.5"
          }
        >
          {filtered.map((p) => {
            const sent = p.status === "Sudah Dikirim";
            const waUrl = waHrefFor(p);
            const open = openId === p.id;
            const fotoCount = (p.foto ? 1 : 0) + (p.galeri?.length ?? 0);
            const thumb = p.foto ?? p.galeri?.[0];
            return (
              <li
                key={p.id}
                // Lewati render/paint kartu di luar viewport (hemat CPU saat daftar panjang).
                // Kartu yang sedang dibuka dikecualikan agar tinggi dinamisnya akurat.
                style={
                  open
                    ? undefined
                    : {
                        contentVisibility: "auto",
                        containIntrinsicSize:
                          viewMode === "grid" ? "auto 180px" : "auto 76px",
                      }
                }
                className={`overflow-hidden rounded-lg border bg-card transition-opacity ${sent ? "opacity-60" : ""} ${
                  viewMode === "grid" && open ? "col-span-full" : ""
                }`}
              >
                {viewMode === "grid" && (
                  <button
                    onClick={() =>
                      selectMode ? toggleSelect(p.id) : setOpenId(open ? null : p.id)
                    }
                    className={`relative block w-full overflow-hidden bg-muted ${open ? "h-32 sm:h-40" : "aspect-square"}`}
                    aria-label="Buka detail"
                  >
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-ms-2xl text-muted-foreground">
                        📦
                      </div>
                    )}
                    <span className="absolute left-1.5 top-1.5 inline-flex items-center rounded bg-background/90 px-1.5 py-0.5 text-[0.625rem] font-medium">
                      {tagFor(p.kategori)}
                    </span>
                    {fotoCount > 0 && (
                      <span className="absolute right-1.5 top-1.5 inline-flex items-center rounded bg-background/90 px-1.5 py-0.5 text-[0.625rem]">
                        📷{fotoCount}
                      </span>
                    )}
                    {selectMode && (
                      <span
                        className={`absolute bottom-1.5 right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border-2 text-[0.625rem] ${
                          selected.has(p.id)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-background bg-background/80"
                        }`}
                      >
                        {selected.has(p.id) ? "✓" : ""}
                      </span>
                    )}
                  </button>
                )}
                <div className="flex min-h-[44px] items-center gap-ms-2 px-ms-2.5 py-ms-2 leading-snug">
                  {selectMode && viewMode === "list" ? (
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      className="h-4 w-4 shrink-0 accent-primary"
                      aria-label="Pilih untuk kirim massal"
                    />
                  ) : viewMode === "list" ? (
                    <input
                      type="checkbox"
                      checked={sent}
                      onChange={(e) => {
                        if (e.target.checked) markSent(p.id);
                        else
                          setItems((arr) =>
                            arr.map((i) =>
                              i.id === p.id
                                ? { ...i, status: "Belum Dikirim", sent_at: undefined }
                                : i,
                            ),
                          );
                      }}
                      className="h-4 w-4 shrink-0"
                      aria-label="Tandai terkirim"
                      title="Tandai terkirim"
                    />
                  ) : null}
                  <button
                    onClick={() =>
                      selectMode ? toggleSelect(p.id) : setOpenId(open ? null : p.id)
                    }
                    className="flex min-w-0 flex-1 items-center gap-ms-2 text-left"
                  >
                    {viewMode === "list" && (
                      <span className="inline-flex shrink-0 items-center rounded bg-secondary px-1.5 py-0.5 text-[0.625rem] font-medium text-secondary-foreground">
                        {tagFor(p.kategori)}
                      </span>
                    )}
                     <span className="truncate text-ms-sm font-medium leading-snug">{p.nama}</span>
                    {viewMode === "list" && p.satuan && (
                      <span className="shrink-0 whitespace-nowrap text-[0.6875rem] leading-snug text-muted-foreground">
                        · {formatJumlah(p.jumlah ?? 0, p.satuan)}
                      </span>
                    )}
                    {viewMode === "list" && sent && (
                      <span className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded bg-wa/15 px-1.5 text-[0.6875rem] font-medium leading-none text-wa-strong">
                        ✓
                      </span>
                    )}
                    {viewMode === "list" && fotoCount > 0 && (
                      <span className="shrink-0 whitespace-nowrap text-[0.6875rem] leading-snug text-muted-foreground">📷{fotoCount}</span>
                    )}
                    <span className="ml-auto shrink-0 whitespace-nowrap text-ms-xs leading-snug tabular-nums text-muted-foreground">
                      {rupiah(p.harga)}
                    </span>
                  </button>
                  {!sent && !selectMode && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-md bg-wa px-ms-2 py-1 text-[0.6875rem] font-semibold text-wa-foreground hover:opacity-90"
                      onClick={(e) => e.stopPropagation()}
                    >
                      WA
                    </a>
                  )}
                  {!selectMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditId(p.id); }}
                      className="shrink-0 rounded-md border px-ms-2 py-1 text-[0.6875rem] font-medium hover:bg-accent"
                      aria-label="Edit lengkap"
                      title="Edit lengkap"
                    >
                      ✎
                    </button>
                  )}
                </div>
                {viewMode === "grid" && (
                  <div className="flex min-h-[40px] items-center gap-ms-2 border-t px-ms-2.5 py-1.5 leading-snug">
                    <label className="flex items-center gap-ms-1.5 text-[0.6875rem]">
                      <input
                        type="checkbox"
                        checked={sent}
                        onChange={(e) => {
                          if (e.target.checked) markSent(p.id);
                          else
                            setItems((arr) =>
                              arr.map((i) =>
                                i.id === p.id
                                  ? { ...i, status: "Belum Dikirim", sent_at: undefined }
                                  : i,
                              ),
                            );
                        }}
                        className="h-3.5 w-3.5"
                      />
                      Tandai terkirim
                    </label>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditId(p.id); }}
                      className="ml-auto rounded-md border px-ms-2 py-1 text-[0.6875rem] font-medium hover:bg-accent"
                    >
                      ✎ Edit
                    </button>
                  </div>
                )}

                {open && (
                  <div className="space-ms-2 border-t px-ms-2.5 py-ms-2.5">
                    <div className="flex gap-ms-2">
                      <select
                        value={p.kategori}
                        onChange={(e) =>
                          update(p.id, { kategori: e.target.value as Kategori })
                        }
                        className="rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm outline-none focus:ring-2 focus:ring-ring"
                        aria-label="Kategori"
                      >
                        {categories.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                      <input
                        value={p.nama}
                        onChange={(e) => update(p.id, { nama: e.target.value })}
                        placeholder="Nama produk"
                        className="w-full rounded-md border bg-background px-ms-2.5 py-1.5 text-ms-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <label className="flex items-center gap-ms-2 rounded-md border bg-background px-ms-2.5 py-1.5 text-ms-sm">
                      <span className="text-muted-foreground">Rp</span>
                      <NumericDraftInput
                        value={p.harga}
                        min={0}
                        max={Number.MAX_SAFE_INTEGER}
                        step={1}
                        inputMode="numeric"
                        emptyCommitsTo={0}
                        onFocus={() => setFlashId(p.id)}
                        onBlur={() =>
                          setFlashId((cur) => (cur === p.id ? null : cur))
                        }
                        onCommit={(n) => {
                          update(p.id, { harga: n });
                          setFlashId(p.id);
                          window.setTimeout(() => {
                            setFlashId((cur) => (cur === p.id ? null : cur));
                          }, 900);
                        }}
                        ariaLabel="Harga produk"
                        className="w-full bg-transparent tabular-nums outline-none"
                        placeholder="Harga"
                      />
                      <span className="text-ms-xs text-muted-foreground tabular-nums">
                        {rupiah(p.harga)}
                      </span>
                    </label>
                    <div className="flex gap-ms-2">
                      <select
                        value={p.satuan ?? "pcs"}
                        onChange={(e) => {
                          const next = e.target.value as Satuan;
                          const b = satuanBounds(next);
                          const cur = p.jumlah ?? 1;
                          const clamped = Math.min(b.max, Math.max(b.min, cur));
                          update(p.id, { satuan: next, jumlah: clamped });
                        }}
                        className="rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm outline-none focus:ring-2 focus:ring-ring"
                        aria-label="Satuan"
                      >
                        {SATUAN_LIST.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const s = p.satuan ?? "pcs";
                        const b = satuanBounds(s);
                        return (
                          <label className="flex w-full items-center gap-ms-2 rounded-md border bg-background px-ms-2.5 py-1.5 text-ms-sm">
                            <span className="text-muted-foreground">Jumlah</span>
                            <NumericDraftInput
                              value={p.jumlah ?? b.min}
                              min={b.min}
                              max={b.max}
                              step={b.step}
                              inputMode="decimal"
                              onCommit={(n) => update(p.id, { jumlah: n })}
                              className="w-full bg-transparent tabular-nums outline-none"
                              placeholder="Jumlah"
                              ariaLabel="Jumlah"
                            />
                            <span className="shrink-0 text-ms-xs text-muted-foreground">
                              {formatJumlah(p.jumlah ?? b.min, s)}
                            </span>
                          </label>
                        );
                      })()}
                    </div>
                    <p className="text-[0.625rem] text-muted-foreground">
                      Gram: 0.01 – 5000 · Kg: 0.001 – 5 · lainnya pakai bilangan bulat.
                    </p>
                    <div
                      className={`flex items-center justify-between gap-ms-2 rounded-md border px-ms-2.5 py-1.5 text-[0.6875rem] transition-colors ${
                        flashId === p.id
                          ? "border-wa bg-wa/10 text-wa-strong"
                          : "bg-background text-muted-foreground"
                      }`}
                      aria-live="polite"
                    >
                      <span className="inline-flex items-center gap-ms-1.5">
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            flashId === p.id ? "bg-wa animate-pulse" : "bg-wa/60"
                          }`}
                        />
                        {flashId === p.id
                          ? `Sedang diperbarui · ${rupiah(p.harga)}`
                          : `Sinkron ✓ · ${rupiah(p.harga)}`}
                      </span>
                      <span className="tabular-nums">
                        {flashId === p.id ? "memperbarui…" : "live"}
                      </span>
                    </div>
                    <div className="grid gap-ms-2 sm:grid-cols-2">
                      <input
                        value={p.keterangan}
                        onChange={(e) => update(p.id, { keterangan: e.target.value })}
                        placeholder="Keterangan"
                        className="w-full rounded-md border bg-background px-ms-2.5 py-1.5 text-ms-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                      <input
                        value={p.lokasi}
                        onChange={(e) => update(p.id, { lokasi: e.target.value })}
                        placeholder="Link Lokasi"
                        className="w-full rounded-md border bg-background px-ms-2.5 py-1.5 text-ms-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div className="flex flex-wrap gap-ms-1.5">
                      <button
                        onClick={() => {
                          if (!navigator.geolocation) {
                            toast.error("Geolocation tidak tersedia");
                            return;
                          }
                          const tId = toast.loading("Mengambil lokasi…");
                          navigator.geolocation.getCurrentPosition(
                            (pos) => {
                              const { latitude, longitude } = pos.coords;
                              update(p.id, {
                                lokasi: `https://www.google.com/maps?q=${latitude},${longitude}`,
                              });
                              toast.success("Lokasi diperbarui", { id: tId });
                            },
                            (err) =>
                              notifyError(err, { prefix: "Gagal: " }),
                            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
                          );
                        }}
                        className="rounded-md border px-ms-2.5 py-1 text-[0.6875rem] font-medium hover:bg-accent"
                      >
                        📍 Ambil lokasi sekarang
                      </button>
                      <button
                        onClick={() => {
                          navigator.clipboard
                            ?.writeText(p.lokasi)
                            .then(() => toast.success("Link lokasi disalin"))
                            .catch(() => toast.error("Gagal menyalin"));
                        }}
                        className="rounded-md border px-ms-2.5 py-1 text-[0.6875rem] font-medium hover:bg-accent"
                      >
                        Salin link
                      </button>
                    </div>

                    <div className="flex flex-wrap items-start gap-ms-1.5">
                      {p.foto && (
                        <div className="relative">
                          <img src={p.foto} alt="" className="h-16 w-16 rounded-md border object-cover" />
                          <button
                            onClick={() => removeFoto(p.id)}
                            aria-label="Hapus foto utama"
                            title="Hapus foto utama"
                            className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border bg-background text-[0.625rem] shadow"
                          >
                            ×
                          </button>
                        </div>
                      )}
                      {(p.galeri ?? []).map((src, idx) => (
                        <div key={idx} className="relative">
                          <img src={src} alt="" className="h-16 w-16 rounded-md border object-cover" />
                          <button
                            onClick={() => removeGaleri(p.id, idx)}
                            aria-label="Hapus foto galeri"
                            title="Hapus foto galeri"
                            className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border bg-background text-[0.625rem] shadow"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <label className="inline-flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed text-[0.625rem] hover:bg-accent">
                        📷
                        <span>{p.foto ? "Ganti" : "Foto"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => setFoto(p.id, e.target.files)}
                        />
                      </label>
                      <label className="inline-flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed text-[0.625rem] hover:bg-accent">
                        🖼️
                        <span>Galeri</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => addGaleri(p.id, e.target.files)}
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-ms-1.5 pt-1">
                      <a
                        href={p.lokasi}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-md border px-ms-2.5 py-1 text-[0.6875rem] font-medium hover:bg-accent"
                      >
                        📍 Lokasi
                      </a>
                      {!sent && (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-md bg-wa px-ms-2.5 py-1 text-[0.6875rem] font-semibold text-wa-foreground hover:opacity-90"
                        >
                          KIRIM WA
                        </a>
                      )}
                      <button
                        onClick={() => {
                          setOpenId(null);
                          toast.success("Tersimpan");
                        }}
                        className="inline-flex items-center rounded-md border border-primary bg-primary px-ms-2.5 py-1 text-[0.6875rem] font-semibold text-primary-foreground hover:opacity-90"
                      >
                        💾 Simpan
                      </button>
                      <button
                        onClick={() => removeItem(p.id)}
                        className="ml-auto inline-flex items-center rounded-md border border-destructive/40 px-ms-2.5 py-1 text-[0.6875rem] font-medium text-destructive hover:bg-destructive/10"
                      >
                        🗑 Hapus
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {filtered.length === 0 && (
          <EmptyState
            icon={
              scopedItems.length === 0
                ? PackagePlus
                : filter === "Sudah Dikirim"
                  ? Send
                  : filter === "Belum Dikirim"
                    ? CheckCircle2
                    : Search
            }
            title={
              scopedItems.length === 0
                ? `Belum ada pesanan di "${activeCat}"`
                : filter === "Sudah Dikirim"
                  ? "Belum ada pesanan terkirim"
                  : filter === "Belum Dikirim"
                    ? "Semua pesanan sudah dikirim"
                    : "Tidak ada pesanan untuk filter ini"
            }
            description={
              scopedItems.length === 0
                ? "Tambah produk pertama untuk kategori ini, lalu kirim ke pelanggan lewat WA."
                : filter === "Sudah Dikirim"
                  ? "Pesanan akan muncul di sini setelah kamu menandainya Sudah Dikirim."
                  : filter === "Belum Dikirim"
                    ? "Tidak ada yang menunggu dikirim. Kerja bagus!"
                    : "Coba ubah filter status kirim untuk melihat pesanan lain."
            }
            actions={
              <>
                {scopedItems.length > 0 && filter !== "semua" && (
                  <button
                    onClick={() => setFilter("semua")}
                    className="inline-flex min-h-9 items-center rounded-full border px-ms-3 text-ms-xs font-medium hover:bg-accent"
                  >
                    Lihat semua status
                  </button>
                )}
                <button
                  onClick={addProduk}
                  className="inline-flex min-h-9 items-center rounded-full bg-primary px-ms-3 text-ms-xs font-semibold text-primary-foreground hover:opacity-90"
                >
                  Tambah produk
                </button>
                <button
                  onClick={() => {
                    setActiveCat(null);
                    setSelectMode(false);
                    setSelected(new Set());
                    setOpenId(null);
                  }}
                  className="inline-flex min-h-9 items-center rounded-full border px-ms-3 text-ms-xs font-medium hover:bg-accent"
                >
                  Kelola kategori
                </button>
              </>
            }
          />
        )}

        {selectMode && <div className="h-20" />}
      </main>
      </div>

      {selectMode && (
        <div
          className="sticky bottom-0 z-10 border-t bg-card/95 backdrop-blur"
          style={{ paddingBottom: `calc(max(var(--app-bottom-bar-space, 0px), var(--app-safe-bottom, env(safe-area-inset-bottom, 0px))))` }}
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-ms-2 px-ms-3 py-ms-2 sm:px-ms-6">
            <button
              onClick={selectAllVisible}
              className="rounded-md border px-ms-2.5 py-1 text-[0.6875rem] font-medium hover:bg-accent"
            >
              {filtered.every((i) => selected.has(i.id)) && filtered.length > 0
                ? "Batal semua"
                : "Pilih semua"}
            </button>
            <span className="text-[0.6875rem] text-muted-foreground">
              {selected.size} dipilih · {rupiah(bulkTotal)}
            </span>
            <div className="ml-auto flex gap-ms-1.5">
              <button
                onClick={bulkMarkSent}
                disabled={selected.size === 0}
                className="rounded-md border px-ms-2.5 py-1 text-[0.6875rem] font-medium hover:bg-accent disabled:opacity-40"
              >
                Tandai terkirim
              </button>
              <a
                href={selected.size === 0 ? undefined : bulkWaUrl}
                target="_blank"
                rel="noreferrer"
                aria-disabled={selected.size === 0}
                onClick={(e) => {
                  if (selected.size === 0) e.preventDefault();
                }}
                className={`inline-flex items-center rounded-md bg-wa px-ms-3 py-1 text-[0.6875rem] font-semibold text-wa-foreground ${
                  selected.size === 0 ? "pointer-events-none opacity-40" : "hover:opacity-90"
                }`}
              >
                KIRIM WA MASSAL ({selected.size})
              </a>
            </div>
          </div>
        </div>
      )}
      {uid && setupOpen && (
        <Suspense fallback={null}>
          <AppLockSetup uid={uid} open={setupOpen} onOpenChange={setSetupOpen} />
        </Suspense>
      )}
      {editId !== null && (
        <Suspense fallback={null}>
          <ProductEditDrawer
            open={editId !== null}
            onOpenChange={(v) => { if (!v) setEditId(null); }}
            produk={items.find((i) => i.id === editId) ?? null}
            categories={categories}
            satuanList={SATUAN_LIST}
            satuanBounds={satuanBounds}
            formatJumlah={formatJumlah}
            rupiah={rupiah}
            update={update}
            setFoto={setFoto}
            addGaleri={addGaleri}
            removeFoto={removeFoto}
            removeGaleri={removeGaleri}
            removeItem={removeItem}
            markSent={markSent}
            buildPesan={buildPesan}
          />
        </Suspense>
      )}
      {photoFlow.element}
    </div>
  );
}
