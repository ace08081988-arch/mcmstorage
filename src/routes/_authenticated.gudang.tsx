import { createFileRoute, Link } from "@tanstack/react-router";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { pingLovableAi } from "@/lib/ai-ping.functions";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useVisualViewportBox, visualViewportDialogStyle } from "@/hooks/use-visual-viewport-inset";
import {
  Boxes,
  Truck,
  ShoppingCart,
  Banknote,
  ClipboardList,
  CreditCard,
  Users,
  Wallet,
  History,
  Package,
  AlertTriangle,
  PackageX,
  Sparkles,
  ImageIcon,
  Info,
} from "lucide-react";

import { notifyError } from "@/lib/friendly-error";
import { ensureFreshSession } from "@/lib/ensure-session";
import { assertStorageAccess } from "@/lib/storage-access";
import { StatusBadge } from "@/components/StatusBadge";
import { buildMailto, isValidEmail } from "@/lib/mailto";
import { supabase } from "@/integrations/supabase/client";
import { logStorageError } from "@/lib/storage-log";
import { confirm } from "@/lib/confirm";
import { ReadyPackagesPanel } from "@/components/ReadyPackagesPanel";
import { NumericTextField } from "@/components/NumericDraftInput";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useMyProfile } from "@/lib/profile";
import { normalizeWaNumber } from "@/lib/phone";
import { fetchPiutangSummary, type PiutangSummary } from "@/lib/piutang";
import { fetchHutangSummary, type HutangSummary } from "@/lib/hutang";
import { useOnDebtTx } from "@/lib/debt-tx-event";
import {
  readGudangCache,
  writeGudangCache,
  clearGudangCache,
} from "@/lib/gudang-cache";
import { subscribeStockChanges, applyStockEvent, type LiveStockItem } from "@/lib/live-stock";
import { withPlainTimeout, withSupabaseQueryTimeout } from "@/lib/supabase-timeout";
import {
  PageContainer,
  PageHeader,
  PillsTabs,
  SummaryCard,
} from "@/components/shell";
import { MidnightScope } from "@/lib/midnight-preview";
import { DomRaceBoundary } from "@/components/DomRaceBoundary";
import { ProcessOrderDialog } from "@/components/ProcessOrderDialog";
import { processOrder } from "@/lib/order-process";
import type { PaymentMethod } from "@/lib/payment-summary";
import { DomRaceRecoveryPanel } from "@/components/DomRaceRecoveryPanel";
import { useFormDraft } from "@/lib/form-draft";
import { DraftSafetyNotice } from "@/components/DraftSafetyNotice";

export const Route = createFileRoute("/_authenticated/gudang")({
  head: () => ({
    meta: [
      { title: "Gudang & Supplier · Ace Storage" },
      { name: "description", content: "Kelola stok gudang, supplier, pembelian dan penjualan dengan perhitungan otomatis." },
    ],
  }),
  component: GudangRoute,
});

/**
 * Bungkus halaman Gudang dengan boundary anti race DOM (Android WebView
 * kadang melempar `removeChild ... not a child of this node` saat list besar
 * ter-commit ulang). Boundary retry diam-diam, tidak reload halaman penuh.
 */
function GudangRoute() {
  return (
    <DomRaceBoundary
      label="gudang"
      renderFallback={(error, reset, info) => (
        <DomRaceRecoveryPanel
          error={error}
          reset={reset}
          info={info}
          title="Halaman Gudang gagal ditampilkan"
        />
      )}
    >
      <MidnightScope />
      <GudangPage />
    </DomRaceBoundary>
  );
}

function AiPingButton() {
  const ping = useServerFn(pingLovableAi);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | null
    | {
        ok: boolean;
        status: number;
        elapsedMs: number;
        reply: string | null;
        runId: string | null;
        error: string | null;
      }
  >(null);

  const run = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await ping({ data: undefined as never });
      setResult(r);
      if (r.ok) {
        toast.success(`AI OK · ${r.elapsedMs}ms${r.runId ? ` · ${r.runId.slice(0, 8)}` : ""}`);
      } else {
        toast.error(`AI gagal (${r.status || "network"}): ${r.error ?? "unknown"}`);
      }
    } catch (e) {
      const msg = (e as Error).message;
      setResult({ ok: false, status: 0, elapsedMs: 0, reply: null, runId: null, error: msg });
      toast.error(`Uji AI gagal: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [ping]);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-ms-2xs">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 font-medium hover:bg-muted disabled:opacity-60"
        aria-label="Uji koneksi AI"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        {busy ? "Menguji AI…" : "Uji AI"}

      </button>
      {result && (
        <span
          role="status"
          className={
            "inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border px-2 py-1 " +
            (result.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-destructive/40 bg-destructive/10 text-destructive")
          }
        >
          <span className="font-semibold">{result.ok ? "OK" : "ERROR"}</span>
          <span>HTTP {result.status || "—"}</span>
          <span>{result.elapsedMs}ms</span>
          {result.runId && (
            <span className="font-mono">run {result.runId.slice(0, 12)}</span>
          )}
          {!result.ok && result.error && (
            <span className="max-w-[24ch] truncate" title={result.error}>
              {result.error}
            </span>
          )}
          {result.ok && result.reply && (
            <span className="opacity-70">balasan: {result.reply}</span>
          )}
        </span>
      )}
    </div>
  );
}

type PackageType = "gram" | "pcs" | "botol" | "sachet";

type Supplier = { id: string; name: string; contact: string | null; email: string | null; email_cc: string | null; email_bcc: string | null; notes: string | null };
type WItem = {
  id: string;
  name: string;
  category: string | null;
  package_type: PackageType;
  package_size: number;
  base_unit: "g" | "pcs";
  stock_base: number;
  avg_cost_per_base: number;
  selling_price_per_base: number | null;
  image_path: string | null;
};
type Purchase = {
  id: string;
  supplier_id: string | null;
  item_id: string;
  package_qty: number;
  package_size_snapshot: number;
  base_added: number;
  price_per_package: number;
  total_cost: number;
  payment_method: "kas" | "hutang";
  created_at: string;
};
type Sale = {
  id: string;
  item_id: string;
  qty_base: number;
  price_per_base: number;
  total_revenue: number;
  cost_at_sale: number;
  note: string | null;
  created_at: string;
  customer_id: string | null;
  payment_method: "kas" | "hutang";
};
type Payment = {
  id: string;
  supplier_id: string;
  purchase_id: string;
  amount: number;
  note: string | null;
  created_at: string;
};
type Customer = { id: string; name: string; contact: string | null; notes: string | null };
type CustomerPayment = {
  id: string;
  customer_id: string;
  sale_id: string | null;
  amount: number;
  note: string | null;
  created_at: string;
};

type OrderRequest = {
  id: string;
  customer_id: string | null;
  item_id: string;
  qty: number;
  qty_mode: "base" | "package";
  price_per_unit: number | null;
  note: string | null;
  status: "menunggu" | "siap" | "selesai";
  created_at: string;
};

import {
  BOTOL_PER_KARTON,
  fmtBase,
  fmtItemPrice,
  fmtItemQty,
  fmtQtyDual,
  rupiah,
} from "@/lib/stock-format";
export { BOTOL_PER_KARTON, fmtBase, fmtItemPrice, fmtItemQty, fmtQtyDual, rupiah };
import { computeBeliDerived } from "@/lib/beli-derived";
import { computeBeliWarnings } from "@/lib/beli-warnings";
import { beliResetKey } from "@/lib/beli-reset-key";
import { humanBaseUnit, isSameUnitLabel, stockBaseUnitLabel } from "@/lib/unit-label";
import { SmartWeightInput } from "@/components/SmartWeightInput";
import { KartonRumusPopover } from "@/components/KartonRumusPopover";
import { KemasanRumusPopover } from "@/components/KemasanRumusPopover";
import { KemasanKonversiBadge } from "@/components/KemasanKonversiBadge";
import { usePhotoEditorFlow } from "@/components/photo-editor/use-photo-editor-flow";
import { ReadyPrepPicker, type ReadyPrep } from "@/components/gudang/ReadyPrepPicker";
import { logPartyWriteFailure } from "@/lib/contact-telemetry";
import { notifyRlsRelogin } from "@/lib/rls-relogin";
import { findPartyDuplicate, type PartyDuplicateHit } from "@/lib/party-duplicate";
import { DuplicateConflictDialog } from "@/components/contacts/DuplicateConflictDialog";

function defaultBase(pt: PackageType): "g" | "pcs" {
  return pt === "gram" ? "g" : "pcs";
}

/* ----------------- Photo helpers ----------------- */
async function uploadItemPhoto(file: File, uid: string): Promise<string | null> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("item-photos").upload(path, file, {
    cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg",
  });
  if (error) {
    logStorageError({ bucket: "item-photos", op: "upload", path, source: "uploadItemPhoto" }, error);
    notifyError(error, { prefix: "Gagal upload foto: " });
    return null;
  }
  return path;
}

function PhotoPicker({ value, onChange, uid }: { value: string | null; onChange: (p: string | null) => void; uid: string | null }) {
  const [busy, setBusy] = useState(false);
  const photoFlow = usePhotoEditorFlow();
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f || !uid) return;
    await photoFlow.open([f], async ({ file }: { file: File }) => {
      setBusy(true);
      const p = await uploadItemPhoto(file, uid);
      setBusy(false);
      if (p) onChange(p);
    });
  }
  return (
    <div className="space-y-1">
      <div className="text-[0.6875rem] text-muted-foreground">Foto barang (opsional)</div>
      <div className="flex items-center gap-ms-2">
        {value ? (
          <SignedImg path={value} className="h-16 w-16 rounded-md border object-cover bg-muted" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed text-[0.6875rem] text-muted-foreground">Tidak ada</div>
        )}
        <label className="flex-1 cursor-pointer rounded-md border bg-background px-ms-2 py-1.5 text-center text-ms-xs hover:bg-accent">
          {busy ? "Mengunggah…" : "📷 Ambil / Pilih foto"}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} disabled={busy} />
        </label>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="rounded-md border px-ms-2 py-1.5 text-ms-xs text-destructive hover:bg-destructive/10">Hapus</button>
        )}
      </div>
      {photoFlow.element}
    </div>
  );
}

const signedUrlCache = new Map<string, { url: string; exp: number }>();
function SignedImg({ path, className, alt }: { path: string; className?: string; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const cached = signedUrlCache.get(path);
    if (cached && cached.exp > Date.now()) { setUrl(cached.url); return; }
    supabase.storage.from("item-photos").createSignedUrl(path, 3600).then(({ data, error }) => {
      logStorageError({ bucket: "item-photos", op: "createSignedUrl", path, source: "SignedImg" }, error);
      if (!alive || !data) return;
      signedUrlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
      setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  if (!url) return <div className={className} />;
  return <img src={url} alt={alt || ""} className={className} loading="lazy" />;
}

function GudangLoadingSkeleton() {
  return (
    <div className="space-ms-3" aria-busy="true" aria-live="polite">
      <div className="h-10 w-full animate-pulse rounded-lg bg-muted/60" />
      <div className="space-ms-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/30 p-3"
          >
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-md bg-muted/60" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted/60" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted/50" />
            </div>
            <div className="h-6 w-16 animate-pulse rounded bg-muted/50" />
          </div>
        ))}
      </div>
    </div>
  );
}

function GudangLoadProgress({
  wave1Done,
  wave2Done,
  subtle = false,
}: {
  wave1Done: boolean;
  wave2Done: boolean;
  /** Data lama sudah tampil — cukup garis tipis, jangan banner yang menggeser layout. */
  subtle?: boolean;
}) {
  if (wave1Done && wave2Done) return null;
  const step = wave1Done ? 2 : 1;
  const pct = wave1Done ? 66 : 25;
  const label = wave1Done
    ? "Gel-2 · memuat pembelian, piutang, pesanan…"
    : "Gel-1 · memuat stok & supplier…";
  if (subtle) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Menyegarkan data"
        className="h-0.5 w-full overflow-hidden rounded-full bg-muted/50"
      >
        <div className="h-full w-1/3 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-primary/70" />
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-ms-2xs"
    >
      <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium text-foreground/80">{label}</span>
          <span className="tabular-nums text-muted-foreground">{step}/2</span>
        </div>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted/60">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function GudangPage() {
  type GudangTab =
    | "stok"
    | "supplier"
    | "beli"
    | "jual"
    | "pesanan"
    | "hutang"
    | "pelanggan"
    | "piutang"
    | "riwayat";
  const GUDANG_TAB_KEY = "mcm:gudang:tab";
  const isGudangTab = (v: unknown): v is GudangTab =>
    v === "stok" || v === "supplier" || v === "beli" || v === "jual" ||
    v === "pesanan" || v === "hutang" || v === "pelanggan" ||
    v === "piutang" || v === "riwayat";
  // Persist active tab so an auto-reload (mis. crash boundary) tidak
  // melempar user kembali ke "Stok" saat sedang mengisi form Beli.
  const [tab, setTab] = useState<GudangTab>(() => {
    if (typeof window === "undefined") return "stok";
    try {
      const raw = window.sessionStorage.getItem(GUDANG_TAB_KEY);
      return isGudangTab(raw) ? raw : "stok";
    } catch {
      return "stok";
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.sessionStorage.setItem(GUDANG_TAB_KEY, tab); } catch { /* ignore */ }
  }, [tab]);
  // Kalau reload sebelumnya dipicu oleh crash saat input, munculkan
  // notifikasi berisi pesan errornya. Toast pernah dipakai tapi menghilang
  // terlalu cepat di HP dan tidak bisa di-screenshot; sekarang disimpan ke
  // state supaya bisa dirender sebagai banner persisten di atas halaman
  // (lihat render di bawah). Payload lengkap tetap di
  // sessionStorage["mcm:last-crash"].
  const [lastCrash, setLastCrash] = useState<
    { at: string; name: string; message: string; stack: string; route: string } | null
  >(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem("mcm:last-crash");
      if (!raw) return;
      const p = JSON.parse(raw) as {
        at?: string; name?: string; message?: string; stack?: string; route?: string;
      };
      const at = p.at ? new Date(p.at).getTime() : 0;
      // hanya tampilkan kalau crash terjadi < 10 menit lalu dan di rute Gudang
      if (!at || Date.now() - at > 10 * 60_000) return;
      if (p.route && !p.route.startsWith("/gudang")) return;
      setLastCrash({
        at: p.at || "",
        name: p.name || "Error",
        message: p.message || "(tanpa pesan)",
        stack: p.stack || "",
        route: p.route || "",
      });
    } catch {
      // ignore
    }
  }, []);
  const dismissLastCrash = () => {
    try {
      window.sessionStorage.removeItem("mcm:last-crash");
      window.sessionStorage.removeItem("mcm:last-crash:shown");
    } catch { /* ignore */ }
    setLastCrash(null);
  };
  const copyLastCrash = () => {
    if (!lastCrash) return;
    const text =
      `[${lastCrash.at}] ${lastCrash.route}\n${lastCrash.name}: ${lastCrash.message}\n\n${lastCrash.stack}`;
    try { void navigator.clipboard?.writeText(text); toast.success("Detail crash disalin"); }
    catch { /* ignore */ }
  };
  const [uid, setUid] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [beliDefaultPayment, setBeliDefaultPayment] = useState<"kas" | "hutang">("kas");
  const [beliPresetKey, setBeliPresetKey] = useState(0);
  const [items, setItems] = useState<WItem[]>([]);
  // Urutan kategori dari `warehouse_categories` (SSOT dengan Beranda).
  // Map key = lower(btrim(name)) supaya cocok dengan unique index DB
  // dan tidak sensitif terhadap kapitalisasi label item.
  const [categoryOrder, setCategoryOrder] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [custPayments, setCustPayments] = useState<CustomerPayment[]>([]);
  const [orders, setOrders] = useState<OrderRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // Wave-2 dependent tabs (Hutang/Jual/Pesanan/Pelanggan/Piutang/Riwayat)
  // baca `purchases/payments/customers/custPayments/orders` yang diambil
  // di gelombang 2. Sebelum gelombang 2 selesai kita tampilkan skeleton di
  // tab tersebut supaya user tidak menyimpulkan datanya kosong.
  const [secondaryLoading, setSecondaryLoading] = useState(true);
  // `uid` awalnya null lalu terisi setelah sesi terbaca. Tanpa penanda ini,
  // efek pemuatan jalan dua kali (null → uid) sehingga skeleton berkedip.
  const [uidReady, setUidReady] = useState(false);

  useEffect(() => {
    let alive = true;
    withPlainTimeout(supabase.auth.getSession(), "gudang-session", 3_000)
      .then(({ data }) => {
        if (!alive) return;
        setUid(data.session?.user?.id ?? null);
        setUidReady(true);
      })
      .catch((err) => {
        console.warn("[gudang] session lookup timeout, load tanpa cache user", err);
        if (!alive) return;
        setUid(null);
        setUidReady(true);
      });
    return () => { alive = false; };
  }, []);

  // H10: coalesce burst reloads within a short window into a single fetch.
  // Prevents `onLocalPayment` + `onChanged` (and similar dual-callbacks) from
  // firing two full 8-table reloads per mutation.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadInFlightRef = useRef(false);
  const reloadPendingRef = useRef(false);

  // Optimasi performa (2026-07-19, direvisi 2026-07-30): fetch dibagi dua
  // gelombang supaya paint awal Gudang tidak menunggu 9 query selesai.
  // Gelombang 1 = data ringkasan (Stok/summary cards). Gelombang 2 = data
  // tab lain (Beli/Jual/Pelanggan/Piutang/Pesanan).
  //
  // Revisi: kedua gelombang DIMULAI bersamaan (bukan wave-2 menunggu
  // wave-1 selesai). Yang bertahap hanya *penerapan* hasilnya — skeleton
  // utama lepas begitu wave-1 selesai. Sebelumnya total waktu = wave1 +
  // wave2 (berurutan); di jaringan seluler ini menambah 1-2 detik sebelum
  // tab Beli/Hutang bisa dipakai.
  async function reloadAllNow() {
    // Wave-2 di-fire duluan (tanpa await) agar RTT-nya tumpang tindih
    // dengan wave-1. `.catch` dipasang segera supaya tidak ada
    // unhandled rejection kalau wave-1 keburu gagal & return lebih awal.
    const wave2 = Promise.all([
      withSupabaseQueryTimeout((signal) => supabase.from("purchases").select("*").order("created_at", { ascending: false }).limit(200).abortSignal(signal), "purchases"),
      withSupabaseQueryTimeout((signal) => supabase.from("supplier_payments").select("*").order("created_at", { ascending: false }).limit(500).abortSignal(signal), "supplier_payments"),
      withSupabaseQueryTimeout((signal) => supabase.from("customers").select("*").order("created_at", { ascending: false }).abortSignal(signal), "customers"),
      withSupabaseQueryTimeout((signal) => supabase.from("customer_payments").select("*").order("created_at", { ascending: false }).limit(500).abortSignal(signal), "customer_payments"),
      withSupabaseQueryTimeout((signal) => supabase.from("order_requests").select("*").order("created_at", { ascending: false }).limit(200).abortSignal(signal), "order_requests"),
    ]).catch((err) => {
      console.warn("[gudang] wave-2 gagal", err);
      return null;
    });
    // Safety: query manapun yang menggantung (mis. WebView kehilangan
    // konektivitas saat berpindah tab) TIDAK boleh membekukan skeleton.
    // Pakai `abortSignal` asli agar fetch diputus, bukan hanya Promise.race.
    let w, s, sa, wc;
    try {
      [w, s, sa, wc] = await Promise.all([
        withSupabaseQueryTimeout((signal) => supabase.from("warehouse_items").select("*").order("name").abortSignal(signal), "warehouse_items"),
        withSupabaseQueryTimeout((signal) => supabase.from("suppliers").select("*").order("created_at", { ascending: false }).abortSignal(signal), "suppliers"),
        withSupabaseQueryTimeout((signal) => supabase.from("sales").select("*").order("created_at", { ascending: false }).limit(200).abortSignal(signal), "sales"),
        withSupabaseQueryTimeout(
          (signal) => supabase
            .from("warehouse_categories")
            .select("name, position")
            .order("position", { ascending: true })
            .abortSignal(signal),
          "warehouse_categories",
        ),
      ]);
    } catch (err) {
      // Gagal / timeout — jangan biarkan skeleton menggantung.
      // Cache SWR (bila ada) sudah terpasang di useEffect init.
      console.warn("[gudang] wave-1 gagal, lepas skeleton", err);
      setLoading(false);
      setSecondaryLoading(false);
      return;
    }
    const nextItems = (w.data as WItem[] | null) ?? [];
    const nextSuppliers = (s.data as Supplier[] | null) ?? [];
    const nextSales = (sa.data as Sale[] | null) ?? [];
    const wcRows = (wc.data as { name: string; position: number }[] | null) ?? [];
    const nextCatOrder: [string, number][] = wcRows.map((r, i) => [
      r.name.trim().toLowerCase(),
      r.position ?? i,
    ]);
    if (w.data) setItems(nextItems);
    if (s.data) setSuppliers(nextSuppliers);
    if (sa.data) setSales(nextSales);
    if (wc.data) setCategoryOrder(new Map(nextCatOrder));
    setLoading(false);

    // Gelombang 2 — sudah berjalan sejak awal, tinggal ditunggu hasilnya.
    const wave2Result = await wave2;
    if (!wave2Result) {
      // Gagal/timeout — jangan biarkan tab dependen (Hutang/Jual/Pesanan)
      // menampilkan skeleton selamanya.
      setSecondaryLoading(false);
      return;
    }
    const [p, py, c, cp, or] = wave2Result;
    const nextPurchases = (p.data as Purchase[] | null) ?? [];
    const nextPayments = (py.data as Payment[] | null) ?? [];
    const nextCustomers = (c.data as Customer[] | null) ?? [];
    const nextCustPayments = (cp.data as CustomerPayment[] | null) ?? [];
    const nextOrders = (or.data as OrderRequest[] | null) ?? [];
    if (p.data) setPurchases(nextPurchases);
    if (py.data) setPayments(nextPayments);
    if (c.data) setCustomers(nextCustomers);
    if (cp.data) setCustPayments(nextCustPayments);
    if (or.data) setOrders(nextOrders);
    setSecondaryLoading(false);

    // Simpan snapshot ke sessionStorage supaya masuk halaman Gudang
    // berikutnya dalam sesi ini bisa langsung memakai data ini
    // (SWR: paint instan, revalidasi di background).
    if (uid) {
      writeGudangCache(uid, {
        items: nextItems,
        suppliers: nextSuppliers,
        sales: nextSales,
        categoryOrder: nextCatOrder,
        purchases: nextPurchases,
        payments: nextPayments,
        customers: nextCustomers,
        custPayments: nextCustPayments,
        orders: nextOrders,
      });
    }
  }

  async function reloadAll() {
    if (reloadInFlightRef.current) {
      reloadPendingRef.current = true;
      return;
    }
    if (reloadTimerRef.current) return; // already scheduled
    reloadTimerRef.current = setTimeout(async () => {
      reloadTimerRef.current = null;
      reloadInFlightRef.current = true;
      try {
        await reloadAllNow();
      } finally {
        reloadInFlightRef.current = false;
        if (reloadPendingRef.current) {
          reloadPendingRef.current = false;
          reloadAll();
        }
      }
    }, 250);
  }

  useEffect(() => {
    if (!uidReady) return;
    if (uid) {
    // Hidrasi sinkron dari cache sesi bila ada — paint instan.
    // `reloadAllNow` kemudian tetap dijalankan sebagai revalidasi (SWR).
      const cached = readGudangCache(uid);
      if (cached) {
        setItems(cached.items as WItem[]);
        setSuppliers(cached.suppliers as Supplier[]);
        setSales(cached.sales as Sale[]);
        setCategoryOrder(new Map(cached.categoryOrder));
        setPurchases(cached.purchases as Purchase[]);
        setPayments(cached.payments as Payment[]);
        setCustomers(cached.customers as Customer[]);
        setCustPayments(cached.custPayments as CustomerPayment[]);
        setOrders(cached.orders as OrderRequest[]);
        setLoading(false);
        setSecondaryLoading(false);
      }
    }
    reloadAllNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, uidReady]);

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  // Sinkronisasi realtime stok: patch baris yang berubah secara instan
  // (tanpa refetch 9 tabel), sehingga Beranda & Gudang selalu sama.
  useEffect(() => {
    if (!uid) return;
    const unsub = subscribeStockChanges((evt) => {
      setItems((prev) => applyStockEvent(prev as unknown as LiveStockItem[], evt) as unknown as WItem[]);
    });
    return unsub;
  }, [uid]);

  const itemMap = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const supMap = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers]);

  const totalStokValue = useMemo(
    () => items.reduce((a, i) => a + i.stock_base * i.avg_cost_per_base, 0),
    [items],
  );
  const totalRevenue = useMemo(() => sales.reduce((a, s) => a + Number(s.total_revenue), 0), [sales]);
  const totalCost = useMemo(() => sales.reduce((a, s) => a + Number(s.cost_at_sale), 0), [sales]);

  const invSummary = useMemo(() => {
    let low = 0;
    let out = 0;
    for (const it of items) {
      const stock = Number(it.stock_base ?? 0);
      const size = Number(it.package_size ?? 0) || 1;
      if (stock <= 0) out += 1;
      else if (stock < size) low += 1;
    }
    return {
      totalProducts: items.length,
      lowStock: low,
      outOfStock: out,
      totalSuppliers: suppliers.length,
    };
  }, [items, suppliers]);

  const navItems = [
    // Label 1 kata konsisten Bahasa Indonesia, urut sesuai alur kerja:
    // barang → mitra → transaksi masuk/keluar → utang-piutang → arsip.
    { k: "stok", label: "Stok", icon: Boxes },
    { k: "supplier", label: "Supplier", icon: Truck },
    { k: "beli", label: "Beli", icon: ShoppingCart },
    { k: "jual", label: "Jual", icon: Banknote },
    { k: "pesanan", label: "Pesanan", icon: ClipboardList },
    { k: "pelanggan", label: "Pelanggan", icon: Users },
    { k: "hutang", label: "Hutang", icon: CreditCard },
    { k: "piutang", label: "Piutang", icon: Wallet },
    { k: "riwayat", label: "Riwayat", icon: History },
  ] as const;

  // Skeleton hanya untuk kondisi "belum ada apa-apa". Saat revalidasi
  // (SWR / setelah mutasi) data lama tetap tampil supaya tidak berkedip.
  const hasPrimaryData = items.length > 0 || suppliers.length > 0 || sales.length > 0;
  const hasSecondaryData =
    purchases.length > 0 ||
    payments.length > 0 ||
    customers.length > 0 ||
    custPayments.length > 0 ||
    orders.length > 0;
  const showPrimarySkeleton = loading && !hasPrimaryData;
  const isSecondaryTab =
    tab === "jual" || tab === "pesanan" || tab === "hutang" ||
    tab === "pelanggan" || tab === "piutang" || tab === "riwayat";
  const showSecondarySkeleton =
    !showPrimarySkeleton && isSecondaryTab && secondaryLoading && !hasSecondaryData;
  const showSkeleton = showPrimarySkeleton || showSecondarySkeleton;
  // Data lama tetap dipakai selama revalidasi; hanya indikator halus.
  const revalidating = !showSkeleton && (loading || (isSecondaryTab && secondaryLoading));

  return (
    <div className="min-h-app-vh bg-gradient-to-b from-background to-muted/20 text-foreground xl:flex">
      {/* Rail kontekstual Gudang — HANYA xl+.
          Di bawah xl, AppSidebar global (256px) sudah memakan lebar; rail
          kedua 224px membuat konten tersisa <300px pada tablet 768px.
          Navigasi tetap tersedia lewat PillsTabs di PageHeader. */}
      <aside className="sticky top-0 hidden h-app-vh w-56 shrink-0 border-r bg-card/80 backdrop-blur xl:flex xl:flex-col">
        <div className="border-b p-ms-4">
          <Link to="/" className="text-ms-2xs text-muted-foreground hover:underline">← Beranda</Link>
          <h1 className="mt-1 flex items-center gap-ms-1.5 text-ms-lg font-bold tracking-ms-tight">
            <Package className="h-[18px] w-[18px] text-primary" /> Gudang
          </h1>
          <div className="mt-3 rounded-lg border bg-muted/30 px-ms-3 py-ms-2">
            <p className="text-ms-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:tracking-[0.18em]">Nilai stok</p>
            <p className="text-ms-sm font-bold tabular-nums">{rupiah(totalStokValue)}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-ms-2">
          {navItems.map(({ k, label, icon: Icon }) => {
            const active = tab === k;
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`group relative flex w-full items-center gap-ms-2.5 rounded-lg px-ms-3 py-ms-2 text-left text-ms-sm font-medium transition-all duration-200 ${
                  active
                    ? "bg-gradient-to-r from-primary to-primary/90 text-primary-foreground shadow-sm"
                    : "text-foreground/75 hover:bg-accent hover:text-foreground"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary-foreground/80" />
                )}
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile header + horizontal nav (desktop pakai sidebar di atas) */}
      <div className="flex-1 min-w-0">
        <PageHeader
          icon={Package}
          title="Gudang"
          subtitle="Inventaris · Pembukuan"
          stat={{ label: "Nilai stok", value: rupiah(totalStokValue) }}
        >
          <PillsTabs
            tabs={navItems}
            value={tab}
            onChange={setTab}
            ariaLabel="Bagian Gudang"
          />
          <AiPingButton />
        </PageHeader>

        <PageContainer>
        {/* Inventory summary — always visible */}
        <section aria-label="Ringkasan inventaris" className="grid grid-cols-2 gap-ms-3 xl:grid-cols-4">
          <SummaryCard
            icon={Package}
            label="Total Produk"
            value={invSummary.totalProducts}
            tone="primary"
            loading={showPrimarySkeleton}
          />
          <SummaryCard
            icon={AlertTriangle}
            label="Stok Menipis"
            value={invSummary.lowStock}
            tone="warning"
            loading={showPrimarySkeleton}
          />
          <SummaryCard
            icon={PackageX}
            label="Stok Habis"
            value={invSummary.outOfStock}
            tone="danger"
            loading={showPrimarySkeleton}
          />
          <SummaryCard
            icon={Truck}
            label="Supplier"
            value={invSummary.totalSuppliers}
            tone="info"
            loading={showPrimarySkeleton}
          />
        </section>

        <GudangLoadProgress
          wave1Done={!loading}
          wave2Done={!secondaryLoading}
          subtle={revalidating}
        />

        {lastCrash && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-ms-2xs text-destructive"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  🐛 Halaman sempat error dan dimuat ulang otomatis
                </div>
                <div className="mt-1 text-[11px] opacity-80">
                  {lastCrash.at} · {lastCrash.route}
                </div>
                <div className="mt-1 break-words font-mono text-[11px]">
                  {lastCrash.name}: {lastCrash.message}
                </div>
                {lastCrash.stack && (
                  <details className="mt-2">
                    <summary className="cursor-pointer select-none text-[11px] underline">
                      Stack trace
                    </summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-tight">
{lastCrash.stack}
                    </pre>
                  </details>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  onClick={copyLastCrash}
                  className="rounded border border-destructive/40 px-2 py-1 text-[10px] font-medium hover:bg-destructive/20"
                >
                  Salin
                </button>
                <button
                  type="button"
                  onClick={dismissLastCrash}
                  className="rounded border border-destructive/40 px-2 py-1 text-[10px] font-medium hover:bg-destructive/20"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        )}

        {showSkeleton && <GudangLoadingSkeleton />}

        <div
          className={
            showSkeleton
              ? "hidden"
              : "animate-in fade-in duration-200 space-ms-3" +
                (revalidating ? " opacity-90 transition-opacity" : "")
          }
          aria-busy={revalidating || undefined}
        >
        {tab === "stok" && (
          <StokTab
            items={items}
            uid={uid}
            categoryOrder={categoryOrder}
            onChanged={reloadAll}
          />
        )}
        {tab === "supplier" && (
          <SupplierTab suppliers={suppliers} uid={uid} onChanged={reloadAll} />
        )}
        {tab === "beli" && (
          <BeliTab key={beliPresetKey} suppliers={suppliers} items={items} uid={uid} onChanged={reloadAll} defaultPayment={beliDefaultPayment} />
        )}
        {tab === "jual" && (
          <JualTab items={items} customers={customers} uid={uid} onChanged={reloadAll} />
        )}
        {tab === "pesanan" && (
          <PesananTab orders={orders} items={items} customers={customers} uid={uid} onChanged={reloadAll} />
        )}
        {tab === "hutang" && (
          <HutangTab
            purchases={purchases}
            payments={payments}
            suppliers={suppliers}
            itemMap={itemMap}
            uid={uid}
            onChanged={reloadAll}
            onAddDebt={() => {
              setBeliDefaultPayment("hutang");
              setBeliPresetKey((k) => k + 1);
              setTab("beli");
              toast.success("Tab Beli dibuka — metode bayar diset ke Hutang", {
                description: "Lengkapi supplier, barang, dan jumlah pembelian.",
              });
            }}
            onLocalPayment={(p) => setPayments((prev) => [p, ...prev])}
            onLocalRemovePayment={(id) => setPayments((prev) => prev.filter((x) => x.id !== id))}
          />
        )}
        {tab === "pelanggan" && (
          <CustomerTab customers={customers} uid={uid} onChanged={reloadAll} />
        )}
        {tab === "piutang" && (
          <PiutangTab
            customers={customers}
            sales={sales}
            custPayments={custPayments}
            itemMap={itemMap}
            uid={uid}
            onChanged={reloadAll}
            onLocalPayment={(p) => setCustPayments((prev) => [p, ...prev])}
            onLocalRemovePayment={(id) => setCustPayments((prev) => prev.filter((x) => x.id !== id))}
            onLocalUpdatePayment={(p) =>
              setCustPayments((prev) => prev.map((x) => (x.id === p.id ? p : x)))
            }
            onLocalUpdateSale={(s) =>
              setSales((prev) => prev.map((x) => (x.id === s.id ? s : x)))
            }
            onLocalRemoveSale={(id) =>
              setSales((prev) => prev.filter((x) => x.id !== id))
            }
            onLocalUpdateCustomer={(c) =>
              setCustomers((prev) => prev.map((x) => (x.id === c.id ? c : x)))
            }
          />
        )}
        {tab === "riwayat" && (
          <RiwayatTab
            purchases={purchases}
            sales={sales}
            itemMap={itemMap}
            supMap={supMap}
            onChanged={reloadAll}
            totalRevenue={totalRevenue}
            totalCost={totalCost}
          />
        )}
        </div>
        </PageContainer>
      </div>
    </div>
  );
}

/* ----------------- CUSTOMER ----------------- */
function CustomerTab({ customers, uid, onChanged }: { customers: Customer[]; uid: string | null; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const { data: myProfile } = useMyProfile();
  const [conflict, setConflict] = useState<{ hit: PartyDuplicateHit; ev: React.FormEvent } | null>(null);
  const normalizedMyPhone = normalizeWaNumber(myProfile?.phone, myProfile?.country_code);
  const canUseMyContact = !!(myProfile?.display_name || normalizedMyPhone);
  function useMyContact() {
    if (!myProfile) return;
    const filled: string[] = [];
    if (myProfile.display_name) { setName(myProfile.display_name); filled.push("nama"); }
    if (normalizedMyPhone) { setContact(normalizedMyPhone); filled.push("no. WA"); }
    else if (myProfile.phone) {
      toast.warning("Nomor WA di profil tidak valid — perbarui di halaman Profil Akun");
    }
    if (filled.length) toast.success(`Diisi dari akun Anda (${filled.join(" & ")})`);
  }

  function resetForm() { setEditingId(null); setName(""); setContact(""); setNotes(""); }
  function startEdit(c: Customer) {
    setEditingId(c.id); setName(c.name); setContact(c.contact ?? ""); setNotes(c.notes ?? "");
  }
  async function submit(e: React.FormEvent, opts?: { force?: boolean }) {
    e.preventDefault();
    if (!uid || !name.trim()) return;
    const payload = { name: name.trim(), contact: contact.trim() || null, notes: notes.trim() || null };
    // Nomor dinormalisasi dulu supaya 0812…, +62812…, dan 62812… dianggap sama.
    const dup = findPartyDuplicate({ rows: customers, currentId: editingId, name, contact });
    if (dup && !opts?.force) {
      setConflict({ hit: dup, ev: e });
      return;
    }
    if (editingId) {
      const { error } = await supabase.from("customers").update(payload).eq("id", editingId);
      if (error) {
        logPartyWriteFailure({ table: "customers", op: "update", error, source: "GudangCustomersForm" });
        if (!notifyRlsRelogin(error, { message: "Gagal memperbarui pelanggan.", onRetry: () => submit(e) })) {
          notifyError(error);
        }
        return;
      }
      toast.success("Pelanggan diperbarui");
    } else {
      let freshUid: string;
      try { freshUid = (await ensureFreshSession()).userId; }
      catch (e) { notifyError(e, { fallback: "Sesi berakhir. Silakan login ulang." }); return; }
      try { await assertStorageAccess(freshUid); }
      catch (e) { notifyError(e); return; }
      const { error } = await supabase.from("customers").insert({ user_id: freshUid, ...payload });
      if (error) {
        logPartyWriteFailure({ table: "customers", op: "insert", error, source: "GudangCustomersForm" });
        if (!notifyRlsRelogin(error, { message: "Gagal menambahkan pelanggan.", onRetry: () => submit(e) })) {
          notifyError(error);
        }
        return;
      }
      toast.success("Pelanggan ditambahkan");
    }
    resetForm(); onChanged();
  }
  async function remove(id: string, n: string) {
    if (!(await confirm({
      title: "Hapus pelanggan?",
      description: `Pelanggan "${n}" beserta seluruh pembayaran yang terkait akan dihapus permanen.`,
      confirmText: "Hapus",
    }))) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) notifyError(error);
    else { toast.success("Pelanggan dihapus"); if (editingId === id) resetForm(); onChanged(); }
  }
  return (
    <div className="space-ms-3">
      <form onSubmit={submit} className="space-ms-2 rounded-lg border bg-card p-ms-3">
        <div className="text-ms-xs font-semibold">{editingId ? "Edit Pelanggan" : "Tambah Pelanggan"}</div>
        <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="Nama pelanggan *" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="No. WA / kontak (opsional)" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={50} />
        <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="Catatan (opsional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
        <button
          type="button"
          onClick={useMyContact}
          disabled={!canUseMyContact}
          className="w-full rounded-md border border-dashed px-ms-3 py-1.5 text-[0.6875rem] text-muted-foreground hover:bg-accent disabled:opacity-50"
          title={canUseMyContact ? "Isi nama & no. WA dari profil akun Anda" : "Lengkapi profil akun terlebih dahulu"}
        >
          👤 Pakai kontak akun saya
        </button>
        <div className="flex gap-ms-2">
          <button className="flex-1 rounded-md bg-primary px-ms-3 py-ms-2 text-ms-sm font-semibold text-primary-foreground">{editingId ? "Perbarui" : "Simpan"}</button>
          {editingId && <button type="button" onClick={resetForm} className="rounded-md border px-ms-3 py-ms-2 text-ms-sm hover:bg-accent">Batal</button>}
        </div>
      </form>
      <DuplicateConflictDialog
        open={!!conflict}
        onOpenChange={(v) => { if (!v) setConflict(null); }}
        info={
          conflict
            ? {
                label: conflict.hit.label,
                reason: conflict.hit.reason,
                existing: {
                  name: conflict.hit.row.name,
                  phone: conflict.hit.row.contact,
                  note: (conflict.hit.row as Customer).notes ?? null,
                },
                incoming: { name, phone: contact || null },
              }
            : null
        }
        onKeep={() => {
          const ev = conflict?.ev;
          setConflict(null);
          if (ev) void submit(ev, { force: true });
        }}
      />
      {customers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">Belum ada pelanggan.</div>
      ) : (
        <ul className="space-ms-2">
          {customers.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-ms-2 rounded-lg border bg-card p-ms-3">
              <div className="min-w-0">
                <div className="truncate text-ms-sm font-semibold" title={c.name}>{c.name}</div>
                {c.contact && <div className="text-[0.6875rem] text-muted-foreground">📞 {c.contact}</div>}
                {c.notes && <div className="text-[0.6875rem] text-muted-foreground">{c.notes}</div>}
              </div>
              <div className="flex shrink-0 gap-ms-1">
                <button onClick={() => startEdit(c)} className={`rounded border px-ms-2 py-1 text-[0.6875rem] hover:bg-accent ${editingId === c.id ? "border-primary text-primary" : ""}`}>Edit</button>
                <button onClick={() => remove(c.id, c.name)} className="rounded border px-ms-2 py-1 text-[0.6875rem] text-destructive hover:bg-destructive/10">Hapus</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----------------- PIUTANG ----------------- */
function PiutangTab({
  customers, sales, custPayments, itemMap, uid, onChanged,
  onLocalPayment, onLocalRemovePayment,
  onLocalUpdatePayment, onLocalUpdateSale, onLocalRemoveSale, onLocalUpdateCustomer,
}: {
  customers: Customer[];
  sales: Sale[];
  custPayments: CustomerPayment[];
  itemMap: Record<string, WItem>;
  uid: string | null;
  onChanged: () => void;
  onLocalPayment: (p: CustomerPayment) => void;
  onLocalRemovePayment: (id: string) => void;
  onLocalUpdatePayment: (p: CustomerPayment) => void;
  onLocalUpdateSale: (s: Sale) => void;
  onLocalRemoveSale: (id: string) => void;
  onLocalUpdateCustomer: (c: Customer) => void;
}) {
  // Per-customer balance: piutang = sum(hutang sales) - sum(payments)
  // > 0 → pelanggan masih hutang, < 0 → kelebihan/deposit
  const groups = useMemo(() => {
    const out: Array<{
      customer: Customer;
      hutangSales: Sale[];
      payments: CustomerPayment[];
      totalHutang: number;
      totalBayar: number;
      balance: number; // positive = customer owes us
    }> = [];
    for (const c of customers) {
      const hutangSales = sales.filter((s) => s.customer_id === c.id && s.payment_method === "hutang");
      const pays = custPayments.filter((p) => p.customer_id === c.id);
      const totalHutang = hutangSales.reduce((a, s) => a + Number(s.total_revenue), 0);
      const totalBayar = pays.reduce((a, p) => a + Number(p.amount), 0);
      const balance = totalHutang - totalBayar;
      if (hutangSales.length === 0 && pays.length === 0) continue;
      out.push({ customer: c, hutangSales, payments: pays, totalHutang, totalBayar, balance });
    }
    return out.sort((a, b) => b.balance - a.balance);
  }, [customers, sales, custPayments]);

  const totals = useMemo(() => {
    let owed = 0, credit = 0;
    for (const g of groups) {
      if (g.balance > 0) owed += g.balance;
      else if (g.balance < 0) credit += -g.balance;
    }
    return { owed, credit };
  }, [groups]);

  // Sinkron dengan /hutang: total piutang harus ikut sertakan entri manual
  // dari tabel debts (kind=piutang). Sebelumnya kartu ini hanya menghitung
  // dari sales.payment_method='hutang' - customer_payments, sehingga total
  // di sini bisa jauh lebih kecil dari halaman Hutang & Piutang.
  const [piutangSSOT, setPiutangSSOT] = useState<PiutangSummary | null>(null);
  const [piutangSSOTAt, setPiutangSSOTAt] = useState<Date | null>(null);
  const [piutangSSOTLoading, setPiutangSSOTLoading] = useState(false);
  const refreshPiutangSSOT = useCallback(async () => {
    setPiutangSSOTLoading(true);
    try {
      const s = await fetchPiutangSummary();
      setPiutangSSOT(s);
      setPiutangSSOTAt(new Date());
    } finally {
      setPiutangSSOTLoading(false);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetchPiutangSummary().then((s) => {
      if (!cancelled) {
        setPiutangSSOT(s);
        setPiutangSSOTAt(new Date());
      }
    });
    return () => { cancelled = true; };
  }, [sales, custPayments]);
  // Transaksi hutang/piutang dari layar lain langsung menyegarkan kartu ini.
  useOnDebtTx(useCallback(() => { void refreshPiutangSSOT(); }, [refreshPiutangSSOT]));
  const owedDisplay = piutangSSOT ? piutangSSOT.total_outstanding : totals.owed;

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">
        Belum ada catatan piutang/kelebihan pelanggan. Jual dengan cara bayar <b>Hutang</b> di tab Jual untuk mulai mencatat.
      </div>
    );
  }

  return (
    <div className="space-ms-3">
      <div className="grid grid-cols-2 gap-ms-2 text-[0.6875rem]">
        <div className="rounded-md border bg-card p-ms-2">
          <div className="flex items-start justify-between gap-1">
            <div className="text-muted-foreground">Total piutang (pelanggan hutang)</div>
            <button
              type="button"
              onClick={refreshPiutangSSOT}
              disabled={piutangSSOTLoading}
              className="shrink-0 rounded border px-1.5 py-0.5 text-[0.625rem] hover:bg-muted disabled:opacity-50"
              aria-label="Hitung ulang piutang"
              title="Hitung ulang"
            >
              {piutangSSOTLoading ? "⏳" : "🔄"}
            </button>
          </div>
          <div className="text-ms-sm font-semibold text-warning dark:text-warning">{rupiah(owedDisplay)}</div>
          <div className="mt-0.5 text-[0.625rem] text-muted-foreground">
            SSOT: <code>piutang_summary_v1</code>
            {piutangSSOTAt && <> · 🕒 {piutangSSOTAt.toLocaleTimeString("id-ID")}</>}
          </div>
          {piutangSSOT && (
            <details className="mt-0.5 text-[0.625rem] text-muted-foreground">
              <summary className="cursor-pointer">Rincian sumber angka</summary>
              <div className="mt-1 space-y-0.5 pl-2">
                <div>Sales hutang: {rupiah(piutangSSOT.sales_hutang_gross)} − dibayar {rupiah(piutangSSOT.sales_hutang_paid)}</div>
                <div>Manual (<code>debts.kind='piutang'</code>): {rupiah(piutangSSOT.manual_gross)} − dibayar {rupiah(piutangSSOT.manual_paid)}</div>
                <div className="font-medium">= Outstanding: {rupiah(piutangSSOT.total_outstanding)}</div>
              </div>
            </details>
          )}
        </div>
        <div className="rounded-md border bg-card p-ms-2">
          <div className="text-muted-foreground">Total kelebihan/deposit</div>
          <div className="text-ms-sm font-semibold text-sky-600 dark:text-sky-400">{rupiah(totals.credit)}</div>
        </div>
      </div>

      {groups.map((g) => {
        const status: "hutang" | "lunas" | "kelebihan" =
          g.balance > 0.001 ? "hutang" : g.balance < -0.001 ? "kelebihan" : "lunas";
        return (
          <div key={g.customer.id} className="space-ms-2 rounded-lg border bg-card p-ms-3">
            <PiutangCustomerHeader
              customer={g.customer}
              totalHutang={g.totalHutang}
              totalBayar={g.totalBayar}
              balance={g.balance}
              status={status}
              onLocalUpdateCustomer={onLocalUpdateCustomer}
              onChanged={onChanged}
            />

            <ShareCustomer
              customer={g.customer}
              hutangSales={g.hutangSales}
              payments={g.payments}
              itemMap={itemMap}
              totalHutang={g.totalHutang}
              totalBayar={g.totalBayar}
              balance={g.balance}
            />

            {g.hutangSales.length > 0 && (
              <ul className="space-y-1.5">
                {g.hutangSales.map((s) => {
                  const it = itemMap[s.item_id];
                  return (
                    <EditableSaleRow
                      key={s.id}
                      sale={s}
                      item={it}
                      onLocalUpdateSale={onLocalUpdateSale}
                      onLocalRemoveSale={onLocalRemoveSale}
                      onChanged={onChanged}
                    />
                  );
                })}
              </ul>
            )}

            <CustomerPayForm
              customerId={g.customer.id}
              balance={g.balance}
              uid={uid}
              onChanged={onChanged}
              onLocalPayment={onLocalPayment}
            />

            {g.payments.length > 0 && (
              <ul className="space-y-1 border-t pt-2">
                {g.payments.map((pay) => (
                  <EditablePaymentRow
                    key={pay.id}
                    payment={pay}
                    onLocalUpdatePayment={onLocalUpdatePayment}
                    onLocalRemovePayment={onLocalRemovePayment}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Piutang: editable header, sale row, payment row ---------- */

/** Konversi ISO timestamp → nilai untuk <input type="date"> (yyyy-mm-dd, local). */
function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/** Kembalikan ISO timestamp baru dengan tanggal dari input (menjaga jam:menit:detik lama). */
function withNewDate(originalIso: string, ymd: string): string {
  const orig = new Date(originalIso);
  const [y, m, d] = ymd.split("-").map((s) => Number(s));
  if (!y || !m || !d) return originalIso;
  const next = new Date(orig);
  next.setFullYear(y, m - 1, d);
  return next.toISOString();
}

function PiutangCustomerHeader({
  customer, totalHutang, totalBayar, balance, status,
  onLocalUpdateCustomer, onChanged,
}: {
  customer: Customer;
  totalHutang: number;
  totalBayar: number;
  balance: number;
  status: "hutang" | "lunas" | "kelebihan";
  onLocalUpdateCustomer: (c: Customer) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(customer.name);
  const [contact, setContact] = useState(customer.contact ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [busy, setBusy] = useState(false);

  function cancel() {
    setName(customer.name);
    setContact(customer.contact ?? "");
    setNotes(customer.notes ?? "");
    setEditing(false);
  }
  async function save() {
    const nm = name.trim();
    if (!nm) { toast.error("Nama pelanggan wajib diisi"); return; }
    setBusy(true);
    const payload = {
      name: nm.slice(0, 100),
      contact: contact.trim() ? contact.trim().slice(0, 50) : null,
      notes: notes.trim() ? notes.trim().slice(0, 200) : null,
    };
    const { data, error } = await supabase
      .from("customers")
      .update(payload)
      .eq("id", customer.id)
      .select()
      .single();
    setBusy(false);
    if (error) { notifyError(error); return; }
    if (data) onLocalUpdateCustomer(data as Customer);
    toast.success("Data pelanggan diperbarui");
    setEditing(false);
    onChanged();
  }

  if (editing) {
    return (
      <div className="space-y-1.5 rounded border border-primary/40 bg-primary/5 p-ms-2">
        <div className="text-[0.6875rem] font-semibold text-primary">Edit pelanggan</div>
        <input className="w-full rounded border bg-background px-ms-2 py-1 text-ms-xs"
          placeholder="Nama pelanggan *" value={name} maxLength={100}
          onChange={(e) => setName(e.target.value)} />
        <input className="w-full rounded border bg-background px-ms-2 py-1 text-ms-xs"
          placeholder="No. WA / kontak (opsional)" value={contact} maxLength={50}
          onChange={(e) => setContact(e.target.value)} />
        <input className="w-full rounded border bg-background px-ms-2 py-1 text-ms-xs"
          placeholder="Catatan (opsional)" value={notes} maxLength={200}
          onChange={(e) => setNotes(e.target.value)} />
        <div className="flex gap-ms-1.5">
          <button type="button" disabled={busy} onClick={save}
            className="rounded bg-primary px-ms-2 py-1 text-[0.6875rem] font-semibold text-primary-foreground disabled:opacity-50">
            Simpan
          </button>
          <button type="button" disabled={busy} onClick={cancel}
            className="rounded border px-ms-2 py-1 text-[0.6875rem] hover:bg-accent">
            Batal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-ms-2">
      <div className="min-w-0">
        <div className="flex items-center gap-ms-1.5">
          <div className="truncate text-ms-sm font-semibold" title={customer.name}>{customer.name}</div>
          <button type="button" onClick={() => setEditing(true)}
            className="shrink-0 rounded border px-1.5 py-0.5 text-[0.625rem] hover:bg-accent"
            title="Edit info pelanggan">
            ✎ Edit
          </button>
        </div>
        <div className="text-[0.6875rem] text-muted-foreground">
          Hutang {rupiah(totalHutang)} · Bayar {rupiah(totalBayar)}
        </div>
      </div>
      <StatusBadge variant={status}>
        {status === "hutang" ? `Sisa ${rupiah(balance)}`
          : status === "kelebihan" ? `Kelebihan ${rupiah(-balance)}`
          : "✓ Lunas"}
      </StatusBadge>
    </div>
  );
}

function EditableSaleRow({
  sale, item, onLocalUpdateSale, onLocalRemoveSale, onChanged,
}: {
  sale: Sale;
  item: WItem | undefined;
  onLocalUpdateSale: (s: Sale) => void;
  onLocalRemoveSale: (id: string) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [total, setTotal] = useState(String(Number(sale.total_revenue)));
  const [note, setNote] = useState(sale.note ?? "");
  const [date, setDate] = useState(toDateInputValue(sale.created_at));
  const [busy, setBusy] = useState(false);

  function cancel() {
    setTotal(String(Number(sale.total_revenue)));
    setNote(sale.note ?? "");
    setDate(toDateInputValue(sale.created_at));
    setEditing(false);
  }

  async function save() {
    const parsed = Number(total);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("Nominal transaksi harus lebih dari 0");
      return;
    }
    setBusy(true);
    // Catatan: hanya mengubah nominal, catatan & tanggal — bukan qty/harga
    // per satuan — supaya stok gudang tidak ikut berubah tanpa reversal.
    // Untuk koreksi qty/berat, hapus baris ini lalu catat ulang di tab Jual.
    const patch: Partial<Sale> = {
      total_revenue: parsed,
      note: note.trim() ? note.trim().slice(0, 200) : null,
      created_at: withNewDate(sale.created_at, date),
    };
    const { data, error } = await supabase
      .from("sales")
      .update(patch)
      .eq("id", sale.id)
      .select()
      .single();
    setBusy(false);
    if (error) { notifyError(error); return; }
    if (data) onLocalUpdateSale(data as Sale);
    toast.success("Transaksi diperbarui");
    setEditing(false);
    onChanged();
  }

  async function remove() {
    if (!(await confirm({
      title: "Hapus baris transaksi?",
      description:
        "Baris hutang ini akan dihapus permanen. Stok gudang otomatis dikembalikan seolah penjualan tidak pernah terjadi.",
      confirmText: "Hapus",
    }))) return;
    setBusy(true);
    // C4: hapus di DB dulu; hanya update state lokal bila sukses,
    // supaya baris tidak "hilang" di UI padahal DB gagal.
    const { error } = await supabase.from("sales").delete().eq("id", sale.id);
    setBusy(false);
    if (error) { notifyError(error); return; }
    onLocalRemoveSale(sale.id);
    toast.success("Transaksi dihapus");
    onChanged();
  }

  if (editing) {
    return (
      <li className="rounded border border-primary/40 bg-primary/5 p-ms-2 text-ms-xs">
        <div className="mb-1 truncate text-[0.6875rem] font-semibold">
          {item?.name || "(barang dihapus)"}
        </div>
        <div className="grid grid-cols-2 gap-ms-1.5">
          <label className="text-[0.625rem] text-muted-foreground">
            Nominal
            <NumericTextField value={total} onValueChange={setTotal} step={1} decimal={false} className="mt-0.5 w-full rounded border bg-background px-ms-2 py-1 text-ms-xs" />
          </label>
          <label className="text-[0.625rem] text-muted-foreground">
            Tanggal
            <input type="date" value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-0.5 w-full rounded border bg-background px-ms-2 py-1 text-ms-xs" />
          </label>
        </div>
        <input type="text" placeholder="Catatan (opsional)" maxLength={200}
          value={note} onChange={(e) => setNote(e.target.value)}
          className="mt-1.5 w-full rounded border bg-background px-ms-2 py-1 text-ms-xs" />
        <div className="mt-1.5 flex gap-ms-1.5">
          <button type="button" disabled={busy} onClick={save}
            className="rounded bg-primary px-ms-2 py-1 text-[0.6875rem] font-semibold text-primary-foreground disabled:opacity-50">
            Simpan
          </button>
          <button type="button" disabled={busy} onClick={cancel}
            className="rounded border px-ms-2 py-1 text-[0.6875rem] hover:bg-accent">
            Batal
          </button>
          <button type="button" disabled={busy} onClick={remove}
            className="ml-auto rounded border px-ms-2 py-1 text-[0.6875rem] text-destructive hover:bg-destructive/10">
            Hapus
          </button>
        </div>
        <p className="mt-1 text-[0.625rem] text-muted-foreground">
          Untuk mengubah <b>jumlah/berat</b>, hapus baris ini lalu catat ulang di tab Jual — stok gudang menyesuaikan otomatis.
        </p>
      </li>
    );
  }

  return (
    <li className="rounded border bg-background p-ms-2 text-ms-xs">
      <div className="flex items-start justify-between gap-ms-2">
        <div className="min-w-0">
          <div className="truncate font-semibold" title={item?.name || "(barang dihapus)"}>
            {item?.name || "(barang dihapus)"}
          </div>
          <div className="text-[0.6875rem] text-muted-foreground">
            {new Date(sale.created_at).toLocaleDateString("id-ID")} · {fmtItemQty(Number(sale.qty_base), item)}
          </div>
          {sale.note && <div className="text-[0.6875rem] text-muted-foreground">{sale.note}</div>}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[0.6875rem] font-semibold">{rupiah(Number(sale.total_revenue))}</div>
          <button type="button" onClick={() => setEditing(true)}
            className="mt-1 rounded border px-1.5 py-0.5 text-[0.625rem] hover:bg-accent"
            title="Edit baris transaksi">
            ✎ Edit
          </button>
        </div>
      </div>
    </li>
  );
}

function EditablePaymentRow({
  payment, onLocalUpdatePayment, onLocalRemovePayment, onChanged,
}: {
  payment: CustomerPayment;
  onLocalUpdatePayment: (p: CustomerPayment) => void;
  onLocalRemovePayment: (id: string) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(Number(payment.amount)));
  const [note, setNote] = useState(payment.note ?? "");
  const [date, setDate] = useState(toDateInputValue(payment.created_at));
  const [busy, setBusy] = useState(false);

  function cancel() {
    setAmount(String(Number(payment.amount)));
    setNote(payment.note ?? "");
    setDate(toDateInputValue(payment.created_at));
    setEditing(false);
  }

  async function save() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("Nominal pembayaran harus lebih dari 0");
      return;
    }
    setBusy(true);
    const patch: Partial<CustomerPayment> = {
      amount: parsed,
      note: note.trim() ? note.trim().slice(0, 200) : null,
      created_at: withNewDate(payment.created_at, date),
    };
    const { data, error } = await supabase
      .from("customer_payments")
      .update(patch)
      .eq("id", payment.id)
      .select()
      .single();
    setBusy(false);
    if (error) { notifyError(error); return; }
    if (data) onLocalUpdatePayment(data as CustomerPayment);
    toast.success("Pembayaran diperbarui");
    setEditing(false);
    onChanged();
  }

  async function remove() {
    if (!(await confirm({
      title: "Hapus pembayaran?",
      description: "Catatan pembayaran ini akan dihapus permanen.",
      confirmText: "Hapus",
    }))) return;
    onLocalRemovePayment(payment.id);
    const { error } = await supabase.from("customer_payments").delete().eq("id", payment.id);
    if (error) { notifyError(error); onChanged(); return; }
    toast.success("Pembayaran dihapus");
    onChanged();
  }

  if (editing) {
    return (
      <li className="rounded border border-primary/40 bg-primary/5 p-ms-2 text-ms-xs">
        <div className="mb-1 text-[0.6875rem] font-semibold text-primary">Edit pembayaran</div>
        <div className="grid grid-cols-2 gap-ms-1.5">
          <label className="text-[0.625rem] text-muted-foreground">
            Nominal
            <NumericTextField value={amount} onValueChange={setAmount} step={1} decimal={false} className="mt-0.5 w-full rounded border bg-background px-ms-2 py-1 text-ms-xs" />
          </label>
          <label className="text-[0.625rem] text-muted-foreground">
            Tanggal
            <input type="date" value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-0.5 w-full rounded border bg-background px-ms-2 py-1 text-ms-xs" />
          </label>
        </div>
        <input type="text" placeholder="Catatan (opsional)" maxLength={200}
          value={note} onChange={(e) => setNote(e.target.value)}
          className="mt-1.5 w-full rounded border bg-background px-ms-2 py-1 text-ms-xs" />
        <div className="mt-1.5 flex gap-ms-1.5">
          <button type="button" disabled={busy} onClick={save}
            className="rounded bg-primary px-ms-2 py-1 text-[0.6875rem] font-semibold text-primary-foreground disabled:opacity-50">
            Simpan
          </button>
          <button type="button" disabled={busy} onClick={cancel}
            className="rounded border px-ms-2 py-1 text-[0.6875rem] hover:bg-accent">
            Batal
          </button>
          <button type="button" disabled={busy} onClick={remove}
            className="ml-auto rounded border px-ms-2 py-1 text-[0.6875rem] text-destructive hover:bg-destructive/10">
            Hapus
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-ms-2 text-[0.6875rem]">
      <span className="min-w-0 truncate">
        {new Date(payment.created_at).toLocaleDateString("id-ID")} ·{" "}
        <b className="text-success dark:text-success">{rupiah(Number(payment.amount))}</b>
        {payment.note && <span className="text-muted-foreground"> · {payment.note}</span>}
      </span>
      <div className="flex shrink-0 gap-ms-1">
        <button type="button" onClick={() => setEditing(true)}
          className="rounded border px-1.5 py-0.5 text-[0.6875rem] hover:bg-accent">
          Edit
        </button>
        <button type="button" onClick={remove}
          className="rounded border px-1.5 py-0.5 text-[0.6875rem] text-destructive hover:bg-destructive/10">
          Hapus
        </button>
      </div>
    </li>
  );
}

function CustomerPayForm({
  customerId, balance, uid, onChanged, onLocalPayment,
}: {
  customerId: string;
  balance: number; // positive = customer still owes
  uid: string | null;
  onChanged: () => void;
  onLocalPayment: (p: CustomerPayment) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function pay(useAmount: number) {
    if (!uid) return;
    if (!Number.isFinite(useAmount) || useAmount <= 0) {
      toast.error("Nominal wajib diisi dan harus lebih dari 0");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.from("customer_payments").insert({
      user_id: uid,
      customer_id: customerId,
      amount: useAmount,
      note: note.trim() || null,
    }).select().single();
    setBusy(false);
    if (error) { notifyError(error); return; }
    if (data) onLocalPayment(data as CustomerPayment);
    toast.success("Pembayaran dicatat");
    setAmount(""); setNote("");
    onChanged();
  }

  const raw = amount.trim();
  const parsed = raw === "" ? NaN : Number(raw);
  const isEmpty = raw === "";
  const isInvalid = !isEmpty && (!Number.isFinite(parsed) || parsed <= 0);
  const errorMsg = isEmpty ? null : isInvalid ? "Nominal harus lebih dari 0" : null;
  const payDisabled = busy || isEmpty || isInvalid;

  return (
    <div className="space-y-1.5 rounded border border-dashed p-ms-2">
      <div className="flex gap-ms-1.5">
        <NumericTextField value={amount} onValueChange={setAmount} step={1} decimal={false} className={`flex-1 rounded border bg-background px-ms-2 py-1 text-ms-xs ${errorMsg ? "border-destructive" : ""}`} placeholder="Nominal terima (Rp)" />
        <button type="button" disabled={payDisabled} onClick={() => pay(parsed)}
          className="rounded bg-primary px-ms-2 py-1 text-ms-xs font-semibold text-primary-foreground disabled:opacity-50">
          Terima
        </button>
        {balance > 0.001 && (
          <button type="button" disabled={busy} onClick={() => pay(balance)}
            className="rounded border border-success px-ms-2 py-1 text-ms-xs font-semibold text-success hover:bg-success/10 disabled:opacity-50 dark:text-success">
            Lunasi
          </button>
        )}
      </div>
      {errorMsg && <div className="text-[0.6875rem] text-destructive">{errorMsg}</div>}
      <input type="text" placeholder="Catatan (opsional)" maxLength={200}
        className="w-full rounded border bg-background px-ms-2 py-1 text-ms-xs"
        value={note} onChange={(e) => setNote(e.target.value)} />
    </div>
  );
}

function ShareCustomer({
  customer, hutangSales, payments, itemMap, totalHutang, totalBayar, balance,
}: {
  customer: Customer;
  hutangSales: Sale[];
  payments: CustomerPayment[];
  itemMap: Record<string, WItem>;
  totalHutang: number; totalBayar: number; balance: number;
}) {
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  const message = useMemo(() => {
    const lines: string[] = [];
    if (balance > 0.001) {
      lines.push(`Halo ${customer.name}, berikut catatan transaksi & sisa tagihan Anda:`);
    } else if (balance < -0.001) {
      lines.push(`Halo ${customer.name}, Anda memiliki kelebihan pembayaran/deposit pada kami:`);
    } else {
      lines.push(`Halo ${customer.name}, berikut catatan transaksi Anda (status: LUNAS):`);
    }
    lines.push("");
    if (hutangSales.length > 0) {
      lines.push("Pembelian (hutang):");
      hutangSales.forEach((s, i) => {
        const it = itemMap[s.item_id];
        const tgl = new Date(s.created_at).toLocaleDateString("id-ID");
        lines.push(`${i + 1}. ${it?.name || "(barang)"} — ${tgl} · ${rupiah(Number(s.total_revenue))}`);
      });
      lines.push("");
    }
    if (payments.length > 0) {
      lines.push("Pembayaran diterima:");
      payments.forEach((p, i) => {
        const tgl = new Date(p.created_at).toLocaleDateString("id-ID");
        lines.push(`${i + 1}. ${tgl} — ${rupiah(Number(p.amount))}${p.note ? ` (${p.note})` : ""}`);
      });
      lines.push("");
    }
    lines.push(`TOTAL HUTANG: ${rupiah(totalHutang)}`);
    lines.push(`SUDAH DIBAYAR: ${rupiah(totalBayar)}`);
    if (balance > 0.001) lines.push(`SISA TAGIHAN: ${rupiah(balance)}`);
    else if (balance < -0.001) lines.push(`KELEBIHAN/DEPOSIT: ${rupiah(-balance)}`);
    else lines.push(`STATUS: LUNAS ✓`);
    lines.push("");
    lines.push(balance > 0.001 ? "Mohon segera diselesaikan ya 🙏" : "Terima kasih 🙏");
    return lines.join("\n");
  }, [customer, hutangSales, payments, itemMap, totalHutang, totalBayar, balance]);

  const phoneDigits = (customer.contact || "").replace(/\D+/g, "");
  const waPhone = phoneDigits.startsWith("0") ? `62${phoneDigits.slice(1)}` : phoneDigits;
  const encoded = encodeURIComponent(message);

  function openLink(url: string) { window.open(url, "_blank", "noopener,noreferrer"); }
  async function copyText() {
    try { await navigator.clipboard.writeText(message); toast.success("Pesan disalin"); }
    catch { toast.error("Gagal menyalin"); }
  }

  // Kumpulkan foto unik untuk barang-barang yang ada di hutangSales
  const uniqueImagePaths = useMemo(() => {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const s of hutangSales) {
      const it = itemMap[s.item_id];
      if (it?.image_path && !seen.has(it.image_path)) {
        seen.add(it.image_path);
        paths.push(it.image_path);
      }
    }
    return paths;
  }, [hutangSales, itemMap]);

  async function shareWithPhotos() {
    if (uniqueImagePaths.length === 0) {
      toast.error("Tidak ada foto barang untuk dibagikan");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.share) {
      toast.error("Perangkat ini tidak mendukung bagikan dengan gambar. Salin pesan & kirim foto manual.");
      return;
    }
    setSharing(true);
    try {
      const files: File[] = [];
      for (const path of uniqueImagePaths.slice(0, 10)) {
        const { data: signed } = await supabase.storage
          .from("item-photos")
          .createSignedUrl(path, 600);
        if (!signed?.signedUrl) continue;
        const resp = await fetch(signed.signedUrl);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        const ext = (blob.type.split("/")[1] || "jpg").split("+")[0];
        const base = path.split("/").pop()?.replace(/\.[^.]+$/, "") || "foto";
        files.push(new File([blob], `${base}.${ext}`, { type: blob.type || "image/jpeg" }));
      }
      if (files.length === 0) {
        toast.error("Gagal memuat foto barang");
        return;
      }
      const payload: ShareData = { text: message, title: `Catatan ${customer.name}`, files };
      if (typeof navigator.canShare === "function" && !navigator.canShare(payload)) {
        toast.error("Browser ini tidak mengizinkan berbagi file. Coba dari WhatsApp/Chrome di HP.");
        return;
      }
      await navigator.share(payload);
    } catch (e) {
      const msg = (e as Error)?.message || "";
      if (!/abort/i.test(msg)) toast.error("Gagal membagikan dengan foto");
    } finally {
      setSharing(false);
    }
  }

  const links = [
    { label: "Kirim via WhatsApp", emoji: "💬", href: waPhone ? `https://wa.me/${waPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`, cls: "border-success text-success hover:bg-success/10 dark:text-success" },
    { label: "Kirim via WhatsApp Business", emoji: "🏪", href: waPhone ? `whatsapp://send?phone=${waPhone}&text=${encoded}` : `whatsapp://send?text=${encoded}`, cls: "border-success text-success hover:bg-success/10 dark:text-success" },
    { label: "Viber", emoji: "📞", href: waPhone ? `viber://chat?number=%2B${waPhone}&text=${encoded}` : `viber://forward?text=${encoded}`, cls: "border-purple-500 text-purple-600 hover:bg-purple-500/10 dark:text-purple-400" },
    { label: "Telegram", emoji: "✈️", href: `https://t.me/share/url?url=${encodeURIComponent(" ")}&text=${encoded}`, cls: "border-sky-500 text-sky-600 hover:bg-sky-500/10 dark:text-sky-400" },
    { label: "SMS", emoji: "✉️", href: waPhone ? `sms:+${waPhone}?body=${encoded}` : `sms:?body=${encoded}`, cls: "border-warning text-warning hover:bg-warning/10 dark:text-warning" },
  ];

  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-ms-2">
      <div className="flex items-center justify-between gap-ms-2">
        <div className="text-[0.6875rem] text-muted-foreground">
          {customer.contact ? <>📞 {customer.contact}</> : <>Tidak ada nomor kontak — pesan tetap bisa dikirim</>}
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-primary px-ms-2.5 py-1 text-[0.6875rem] font-semibold text-primary-foreground">
          {open ? "Tutup" : balance > 0.001 ? "📤 Ingatkan tagihan" : "📤 Kirim catatan"}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-ms-2">
          <textarea readOnly value={message} className="h-32 w-full resize-none rounded border bg-background p-ms-2 text-[0.6875rem]" />
          <div className="flex flex-wrap gap-ms-1.5">
            {links.map((l) => (
              <button key={l.label} type="button" onClick={() => openLink(l.href)}
                className={`rounded-md border px-ms-2 py-1 text-[0.6875rem] font-semibold ${l.cls}`}>
                {l.emoji} {l.label}
              </button>
            ))}
            <button type="button" onClick={copyText}
              className="rounded-md border px-ms-2 py-1 text-[0.6875rem] font-semibold hover:bg-accent">
              📋 Salin
            </button>
            <button type="button" onClick={shareWithPhotos} disabled={sharing || uniqueImagePaths.length === 0}
              className="rounded-md border border-fuchsia-500 px-ms-2 py-1 text-[0.6875rem] font-semibold text-fuchsia-600 hover:bg-fuchsia-500/10 disabled:opacity-50 dark:text-fuchsia-400">
              {sharing ? "Menyiapkan…" : `📷 Bagikan + Foto (${uniqueImagePaths.length})`}
            </button>
          </div>
          {uniqueImagePaths.length > 0 && (
            <p className="text-[0.6875rem] text-muted-foreground">
              Tombol "Bagikan + Foto" memakai berbagi bawaan HP (Android/iOS) sehingga foto barang ikut terkirim. Tombol WhatsApp/Telegram di atas hanya mengirim teks karena tidak mendukung lampiran via link.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------- SHARE DEBT (WA/Viber/Telegram/SMS) ----------------- */
function ShareDebt({
  supplier, debts, paidByPurchase, itemMap, total, paid, remaining,
}: {
  supplier: Supplier;
  debts: Purchase[];
  paidByPurchase: Record<string, number>;
  itemMap: Record<string, WItem>;
  total: number; paid: number; remaining: number;
}) {
  const [open, setOpen] = useState(false);

  const message = useMemo(() => {
    const lines: string[] = [];
    lines.push(`Halo ${supplier.name}, berikut rincian hutang kami:`);
    lines.push("");
    debts.forEach((d, i) => {
      const it = itemMap[d.item_id];
      const p = paidByPurchase[d.id] || 0;
      const sisa = Math.max(0, Number(d.total_cost) - p);
      const tgl = new Date(d.created_at).toLocaleDateString("id-ID");
      lines.push(`${i + 1}. ${it?.name || "(barang)"} — ${tgl}`);
      lines.push(`   Total ${rupiah(Number(d.total_cost))} · Bayar ${rupiah(p)} · Sisa ${rupiah(sisa)}`);
    });
    lines.push("");
    lines.push(`TOTAL: ${rupiah(total)}`);
    lines.push(`SUDAH DIBAYAR: ${rupiah(paid)}`);
    lines.push(`SISA HUTANG: ${rupiah(remaining)}`);
    lines.push("");
    lines.push("Mohon konfirmasi. Terima kasih 🙏");
    return lines.join("\n");
  }, [supplier, debts, paidByPurchase, itemMap, total, paid, remaining]);

  // Sanitize phone: digits only, drop leading 0 → +62 if Indonesian-ish
  const phoneDigits = (supplier.contact || "").replace(/\D+/g, "");
  const waPhone = phoneDigits.startsWith("0") ? `62${phoneDigits.slice(1)}` : phoneDigits;
  const encoded = encodeURIComponent(message);

  function openLink(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  async function copyText() {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Pesan disalin");
    } catch {
      toast.error("Gagal menyalin");
    }
  }

  const links: Array<{ label: string; emoji: string; href: string; cls: string }> = [
    {
      label: "Kirim via WhatsApp",
      emoji: "💬",
      href: waPhone ? `https://wa.me/${waPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`,
      cls: "border-success text-success hover:bg-success/10 dark:text-success",
    },
    {
      label: "Kirim via WhatsApp Business",
      emoji: "🏪",
      href: waPhone
        ? `whatsapp://send?phone=${waPhone}&text=${encoded}`
        : `whatsapp://send?text=${encoded}`,
      cls: "border-success text-success hover:bg-success/10 dark:text-success",
    },
    {
      label: "Viber",
      emoji: "📞",
      href: waPhone
        ? `viber://chat?number=%2B${waPhone}&text=${encoded}`
        : `viber://forward?text=${encoded}`,
      cls: "border-purple-500 text-purple-600 hover:bg-purple-500/10 dark:text-purple-400",
    },
    {
      label: "Telegram",
      emoji: "✈️",
      href: `https://t.me/share/url?url=${encodeURIComponent(" ")}&text=${encoded}`,
      cls: "border-sky-500 text-sky-600 hover:bg-sky-500/10 dark:text-sky-400",
    },
    {
      label: "SMS",
      emoji: "✉️",
      href: waPhone ? `sms:+${waPhone}?body=${encoded}` : `sms:?body=${encoded}`,
      cls: "border-warning text-warning hover:bg-warning/10 dark:text-warning",
    },
  ];

  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-ms-2">
      <div className="flex items-center justify-between gap-ms-2">
        <div className="text-[0.6875rem] text-muted-foreground">
          {supplier.contact ? <>📞 {supplier.contact}</> : <>Tidak ada nomor kontak — pesan tetap bisa dikirim</>}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-primary px-ms-2.5 py-1 text-[0.6875rem] font-semibold text-primary-foreground"
        >
          {open ? "Tutup" : "📤 Kirim tagihan"}
        </button>
      </div>

      {open && (
        <div className="mt-2 space-ms-2">
          <textarea
            readOnly
            value={message}
            className="h-28 w-full resize-none rounded border bg-background p-ms-2 text-[0.6875rem]"
          />
          <div className="flex flex-wrap gap-ms-1.5">
            {links.map((l) => (
              <button
                key={l.label}
                type="button"
                onClick={() => openLink(l.href)}
                className={`rounded-md border px-ms-2 py-1 text-[0.6875rem] font-semibold ${l.cls}`}
              >
                {l.emoji} {l.label}
              </button>
            ))}
            <button
              type="button"
              onClick={copyText}
              className="rounded-md border px-ms-2 py-1 text-[0.6875rem] font-semibold hover:bg-accent"
            >
              📋 Salin
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------- STOK ----------------- */
function StokTab({
  items,
  uid,
  categoryOrder,
  onChanged,
}: {
  items: WItem[];
  uid: string | null;
  /**
   * Peta urutan kategori dari `warehouse_categories.position` (SSOT
   * dengan Beranda). Key = `name.trim().toLowerCase()` supaya cocok
   * dengan unique index DB dan tidak terganggu oleh perbedaan
   * kapitalisasi antara label item vs master.
   */
  categoryOrder: Map<string, number>;
  onChanged: () => void;
}) {
  /**
   * Comparator konsisten Beranda-Gudang:
   * - Kategori yang ada di master → urut posisi.
   * - Kategori "orphan" (belum ada di master) → setelah semua master,
   *   dan di antara mereka urut alfabetis.
   * - "Tanpa Kategori" selalu terakhir.
   */
  const compareCats = (a: string, b: string) => {
    if (a === b) return 0;
    if (a === "Tanpa Kategori") return 1;
    if (b === "Tanpa Kategori") return -1;
    const pa = categoryOrder.get(a.trim().toLowerCase());
    const pb = categoryOrder.get(b.trim().toLowerCase());
    if (pa != null && pb != null) return pa - pb;
    if (pa != null) return -1;
    if (pb != null) return 1;
    return a.localeCompare(b, "id");
  };
  const [editing, setEditing] = useState<WItem | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Callback stabil supaya `StokItemRow` yang di-memoize tidak re-render
  // hanya karena identitas fungsi berubah tiap render.
  const handleEdit = useCallback((it: WItem) => setEditing(it), []);
  const handleRemove = useCallback(
    async (it: WItem) => {
      if (!(await confirm({
        title: "Hapus barang?",
        description: `Barang "${it.name}" beserta seluruh pembelian dan penjualan terkait akan dihapus permanen.`,
        confirmText: "Hapus",
      }))) return;
      const { error } = await supabase.from("warehouse_items").delete().eq("id", it.id);
      if (error) notifyError(error);
      else { toast.success("Barang dihapus"); onChanged(); }
    },
    [onChanged],
  );
  // Pre-computed lowercase index — dihitung sekali per perubahan `items`,
  // sehingga filter pencarian tidak melakukan `.toLowerCase()` per keystroke.
  const searchIndex = useMemo(
    () =>
      items.map((i) => ({
        item: i,
        hay: `${i.name}\u0000${i.category ?? ""}`.toLowerCase(),
        catKey: (i.category ?? "").trim() || "Tanpa Kategori",
      })),
    [items],
  );

  // Defer query supaya input tetap responsif saat daftar besar.
  const deferredQuery = useDeferredValue(query);
  const q = deferredQuery.trim().toLowerCase();

  const filtered = useMemo(
    () => (q ? searchIndex.filter((r) => r.hay.includes(q)).map((r) => r.item) : items),
    [q, searchIndex, items],
  );

  const { groups, groupKeys } = useMemo(() => {
    const g = new Map<string, WItem[]>();
    for (const it of filtered) {
      const key = (it.category ?? "").trim() || "Tanpa Kategori";
      let arr = g.get(key);
      if (!arr) {
        arr = [];
        g.set(key, arr);
      }
      arr.push(it);
    }
    const keys = Array.from(g.keys()).sort(compareCats);
    for (const k of keys) g.get(k)!.sort((a, b) => a.name.localeCompare(b.name, "id"));
    return { groups: g, groupKeys: keys };
  }, [filtered, categoryOrder]);

  const { totalItems, totalValue, totalCategories } = useMemo(() => {
    let value = 0;
    const cats = new Set<string>();
    for (const i of items) {
      value += i.stock_base * i.avg_cost_per_base;
      cats.add((i.category ?? "").trim() || "Tanpa Kategori");
    }
    return { totalItems: items.length, totalValue: value, totalCategories: cats.size };
  }, [items]);

  // Ringkasan per-kategori (memoized) — sebelumnya IIFE per-render/keystroke.
  const catSummaryRows = useMemo(() => {
    const m = new Map<string, { count: number; value: number }>();
    for (const it of items) {
      const key = (it.category ?? "").trim() || "Tanpa Kategori";
      const cur = m.get(key) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += it.stock_base * it.avg_cost_per_base;
      m.set(key, cur);
    }
    return Array.from(m.entries()).sort((a, b) => {
      const c = compareCats(a[0], b[0]);
      if (c !== 0) return c;
      return b[1].value - a[1].value;
    });
  }, [items, categoryOrder]);

  // Early-return SETELAH semua hook — memindahkan return sebelum hook di
  // atas menyebabkan React error #310 (jumlah hook berubah antar render)
  // saat data pertama kali masuk.
  if (items.length === 0)
    return (
      <EmptyState
        icon={PackageX}
        title="Belum ada barang di gudang"
        description={
          <>
            Barang muncul otomatis begitu kamu mencatat pembelian pertama di tab{" "}
            <b>Beli</b>.
          </>
        }
      />
    );


  return (
    <>
    {/* Ringkasan profesional */}
    <section className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-stretch">
        <div className="flex flex-1 items-center px-ms-4 py-ms-3">
          <div className="min-w-0">
            <div className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Inventaris Gudang
            </div>
            <div className="mt-0.5 truncate text-ms-sm font-semibold tabular-nums">
              {rupiah(totalValue)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 divide-x border-l text-right">
          <Stat label="Item" value={totalItems.toLocaleString("id-ID")} />
          <Stat label="Kategori" value={totalCategories.toLocaleString("id-ID")} />
        </div>
      </div>
      <div className="border-t p-ms-2">
        <input
          type="search"
          placeholder="Cari nama atau kategori…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border bg-background px-ms-3 py-1.5 text-ms-sm outline-none ring-primary/20 focus:ring-2"
        />
      </div>
    </section>

    {/* Ringkasan per kategori (berdasarkan seluruh stok, bukan hasil filter) */}
    {(() => {
      const rows = catSummaryRows;
      if (rows.length === 0) return null;
      return (
        <section className="mt-3 overflow-hidden rounded-xl border bg-card shadow-sm">
          <header className="flex items-center justify-between border-b bg-muted/40 px-ms-3 py-ms-2">
            <h3 className="min-w-0 flex-1 truncate text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.08em] text-muted-foreground">
              Total per Kategori
            </h3>
            <span
              className="inline-flex h-5 max-w-[7rem] shrink-0 items-center rounded-full border bg-background px-1.5 text-[0.6875rem] font-medium leading-none text-muted-foreground tabular-nums"
              title={`${rows.length} kategori`}
            >
              <span className="min-w-0 truncate whitespace-nowrap">{rows.length} kategori</span>
            </span>
          </header>
          <ul className="divide-y text-ms-sm">
            {rows.map(([cat, { count, value }]) => {
              const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
              return (
                <li
                  key={cat}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-ms-3 py-ms-2 hover:bg-muted/30"
                >
                  <div className="flex min-w-0 items-center gap-ms-2">
                    <span
                      aria-hidden
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${cat === "Tanpa Kategori" ? "bg-muted-foreground/50" : "bg-primary"}`}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium" title={cat}>{cat}</span>
                    <span
                      className="inline-flex h-5 max-w-[7rem] shrink-0 items-center rounded-full border bg-background px-1.5 text-[0.6875rem] font-medium leading-none text-muted-foreground tabular-nums"
                      title={`${count} item`}
                    >
                      <span className="min-w-0 truncate whitespace-nowrap">{count}</span>
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-ms-sm font-semibold tabular-nums">{rupiah(value)}</div>
                    <div className="text-[0.6875rem] text-muted-foreground tabular-nums">
                      {pct.toFixed(pct >= 10 ? 0 : 1)}%
                    </div>
                  </div>
                  <div className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary/70"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      );
    })()}

    {filtered.length === 0 && (
      <div className="mt-3 rounded-lg border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">
        Tidak ada barang cocok dengan pencarian.
      </div>
    )}

    {/* Daftar dikelompokkan per kategori */}
    <div className="mt-3 space-ms-3">
      {groupKeys.map((cat) => {
        const list = groups.get(cat)!;
        const catValue = list.reduce((s, i) => s + i.stock_base * i.avg_cost_per_base, 0);
        const isCollapsed = !!collapsed[cat];
        return (
          <section key={cat} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <header
              className="flex cursor-pointer items-center justify-between gap-ms-2 border-b bg-muted/40 px-ms-3 py-ms-2"
              onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
            >
              <div className="flex min-w-0 flex-1 items-center gap-ms-2">
                <span
                  aria-hidden
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${cat === "Tanpa Kategori" ? "bg-muted-foreground/50" : "bg-primary"}`}
                />
                <h3 className="min-w-0 flex-1 truncate text-ms-sm font-semibold leading-snug" title={cat}>{cat}</h3>
                <span
                  className="inline-flex h-5 max-w-[7rem] shrink-0 items-center rounded-full border bg-background px-1.5 text-[0.6875rem] font-medium leading-none text-muted-foreground tabular-nums"
                  title={`${list.length} item`}
                >
                  <span className="min-w-0 truncate whitespace-nowrap">{list.length} item</span>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-ms-2 text-[0.6875rem] leading-snug">
                <span className="hidden text-muted-foreground sm:inline">Nilai</span>
                <span className="whitespace-nowrap font-semibold tabular-nums">{rupiah(catValue)}</span>
                <span className="text-muted-foreground">{isCollapsed ? "▸" : "▾"}</span>
              </div>
            </header>
            {!isCollapsed && (
              <VirtualStokList
                items={list}
                onEdit={handleEdit}
                onRemove={handleRemove}
              />
            )}
          </section>
        );
      })}
    </div>
    {editing && (
      <EditItemDialog
        item={editing}
        uid={uid}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); onChanged(); }}
        onSilentRefresh={onChanged}
      />
    )}
    </>
  );
}

/**
 * Virtualisasi daftar barang per-kategori.
 *
 * Halaman Gudang scroll pada window; kita pakai `useWindowVirtualizer`
 * dengan `scrollMargin` = offsetTop container agar posisi rendering
 * mengikuti scroll global. Tinggi tiap kartu bervariasi (nama panjang,
 * baris konversi karton) sehingga diukur dinamis via `measureElement`.
 *
 * Optimasi:
 * - `overscan` 6 baris supaya smooth di Android WebView.
 * - Fallback non-virtual untuk daftar pendek (`<= 20`) — overhead
 *   virtualizer tidak sepadan pada list kecil dan menjaga kompatibilitas
 *   dengan pengukuran halaman.
 */
function VirtualStokList({
  items,
  onEdit,
  onRemove,
}: {
  items: WItem[];
  onEdit: (it: WItem) => void;
  onRemove: (it: WItem) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);

  if (items.length <= 20) {
    return (
      <ul className="divide-y">
        {items.map((i) => (
          <StokItemRow key={i.id} item={i} onEdit={onEdit} onRemove={onRemove} />
        ))}
      </ul>
    );
  }

  return (
    <VirtualStokListInner
      items={items}
      onEdit={onEdit}
      onRemove={onRemove}
      parentRef={parentRef}
    />
  );
}

function VirtualStokListInner({
  items,
  onEdit,
  onRemove,
  parentRef,
}: {
  items: WItem[];
  onEdit: (it: WItem) => void;
  onRemove: (it: WItem) => void;
  parentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [scrollMargin, setScrollMargin] = useState(0);
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setScrollMargin(rect.top + window.scrollY);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [parentRef]);

  const virt = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => 168,
    overscan: 6,
    scrollMargin,
  });

  const virtualItems = virt.getVirtualItems();
  const totalSize = virt.getTotalSize();

  return (
    <div ref={parentRef} className="relative" style={{ height: totalSize }}>
      <ul
        className="divide-y"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          transform: `translateY(${(virtualItems[0]?.start ?? 0) - scrollMargin}px)`,
        }}
      >
        {virtualItems.map((v) => {
          const it = items[v.index]!;
          return (
            <StokItemRow
              key={it.id}
              item={it}
              onEdit={onEdit}
              onRemove={onRemove}
              measureRef={virt.measureElement}
              dataIndex={v.index}
            />
          );
        })}
      </ul>
    </div>
  );
}

const StokItemRow = memo(function StokItemRow({
  item: i,
  onEdit,
  onRemove,
  measureRef,
  dataIndex,
}: {
  item: WItem;
  onEdit: (it: WItem) => void;
  onRemove: (it: WItem) => void;
  measureRef?: (node: Element | null) => void;
  dataIndex?: number;
}) {
  return (
    <li
      ref={measureRef}
      data-index={dataIndex}
      className="p-ms-3 transition-colors hover:bg-muted/30"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-ms-2">
        <div className="flex min-w-0 gap-ms-2">
          {i.image_path ? (
            <SignedImg path={i.image_path} className="h-12 w-12 shrink-0 rounded-md border object-cover bg-muted" />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground">
              <ImageIcon className="h-4 w-4" aria-hidden />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 break-words text-ms-sm font-semibold leading-snug [overflow-wrap:anywhere]">{i.name}</div>
            <div className="mt-0.5 text-[0.6875rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              per {i.package_type}
              {i.package_type !== "pcs" && ` (${i.package_size} ${humanBaseUnit(i.package_type, i.base_unit)}/kemasan)`}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-ms-1 min-[360px]:flex-row">
          <button
            onClick={() => onEdit(i)}
            className="rounded border px-ms-2 py-1 text-[0.6875rem] hover:bg-accent"
          >
            Edit
          </button>
          <button
            onClick={() => onRemove(i)}
            className="rounded border px-ms-2 py-1 text-[0.6875rem] text-destructive hover:bg-destructive/10"
          >
            Hapus
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-ms-2 text-[0.6875rem] leading-snug min-[380px]:grid-cols-3">

        <div className="min-w-0 rounded bg-muted/50 p-ms-2">
          <div className="truncate text-muted-foreground">Stok</div>
          {i.package_type === "botol" ? (
            <KartonRumusPopover
              botol={i.base_unit === "pcs" ? i.stock_base : i.stock_base / (Number(i.package_size) || 1)}
              packageSize={i.package_size}
              testId="stok-label-trigger"
            >
              <span className="font-semibold tabular-nums [overflow-wrap:anywhere]">{fmtItemQty(i.stock_base, i)}</span>
            </KartonRumusPopover>
          ) : (
            <div className="font-semibold tabular-nums [overflow-wrap:anywhere]">{fmtItemQty(i.stock_base, i)}</div>
          )}
        </div>
        <div className="min-w-0 rounded bg-muted/50 p-ms-2">
          <div className="truncate text-muted-foreground">HPP / {humanBaseUnit(i.package_type, i.base_unit)}</div>
          <div className="font-semibold tabular-nums [overflow-wrap:anywhere]">{rupiah(i.avg_cost_per_base)}</div>
        </div>
        <div className="min-w-0 rounded bg-muted/50 p-ms-2">
          <div className="truncate text-muted-foreground">Nilai</div>
          <div className="font-semibold tabular-nums [overflow-wrap:anywhere]">{rupiah(i.stock_base * i.avg_cost_per_base)}</div>
        </div>
      </div>
      {i.package_type === "botol" && (
        <div className="mt-1.5 text-[0.625rem] text-muted-foreground">
          <KartonRumusPopover
            botol={i.base_unit === "pcs" ? i.stock_base : i.stock_base / (Number(i.package_size) || 1)}
            packageSize={i.package_size}
            testId="stok-konversi-trigger"
          >
            <span className="inline-flex min-w-0 items-center gap-1">
              <Info className="h-3 w-3 shrink-0" aria-hidden />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                Konversi: 1 karton = {BOTOL_PER_KARTON} botol
              </span>
            </span>

          </KartonRumusPopover>
        </div>
      )}
    </li>
  );
});

const Stat = memo(function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col justify-center px-ms-3 py-ms-2 sm:px-ms-4">
      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="text-ms-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
});

function EditItemDialog({ item, uid, onClose, onSaved, onSilentRefresh }: { item: WItem; uid: string | null; onClose: () => void; onSaved: () => void; onSilentRefresh?: () => void }) {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category ?? "");
  const [packageType, setPackageType] = useState<PackageType>(item.package_type as PackageType);
  const [packageSize, setPackageSize] = useState(String(item.package_size));
  const [stockBase, setStockBase] = useState(String(item.stock_base));
  const [avgCost, setAvgCost] = useState(String(item.avg_cost_per_base));
  const [sellingPrice, setSellingPrice] = useState(item.selling_price_per_base == null ? "" : String(item.selling_price_per_base));
  const [description, setDescription] = useState((item as { description?: string | null }).description ?? "");
  const [imagePath, setImagePath] = useState<string | null>(item.image_path);
  const [saving, setSaving] = useState(false);
  const [showPackages, setShowPackages] = useState(false);
  const [currentStock, setCurrentStock] = useState(item.stock_base);
  const baseUnit = defaultBase(packageType);
  const effectiveSize = packageType === "pcs" ? 1 : Number(packageSize) || 0;
  const originalBaseUnit = item.base_unit;
  const baseUnitChanged = baseUnit !== originalBaseUnit;

  async function save() {
    if (!name.trim()) { toast.error("Nama wajib"); return; }
    if (packageType !== "pcs" && effectiveSize <= 0) { toast.error("Ukuran kemasan > 0"); return; }
    if (baseUnitChanged) {
      const fromLabel = originalBaseUnit === "g" ? "gram" : "pcs";
      const toLabel = baseUnit === "g" ? "gram" : "pcs";
      const ok = await confirm({
        title: `Ubah satuan dasar ${fromLabel} → ${toLabel}?`,
        description:
          `Stok (${item.stock_base} ${originalBaseUnit}) & HPP (Rp${item.avg_cost_per_base}/${originalBaseUnit}) ` +
          `TIDAK dikonversi otomatis. Histori pembelian & penjualan akan terbaca dalam satuan baru. ` +
          `Lanjutkan hanya bila Anda yakin (mis. barang ini belum pernah terpakai). ` +
          `Sebaiknya buat barang baru bila ingin ganti antara botol/sachet/pcs ⇄ gram.`,
        confirmText: "Ya, paham risikonya",
      });
      if (!ok) return;
    }
    setSaving(true);
    const { error } = await supabase.from("warehouse_items").update({
      name: name.trim(),
      category: category.trim() || null,
      package_type: packageType,
      package_size: effectiveSize,
      base_unit: baseUnit,
      stock_base: Number(stockBase) || 0,
      avg_cost_per_base: Number(avgCost) || 0,
      selling_price_per_base: sellingPrice.trim() === "" ? null : Number(sellingPrice) || null,
      description: description.trim() || null,
      image_path: imagePath,
    }).eq("id", item.id);
    setSaving(false);
    if (error) { notifyError(error); return; }
    toast.success("Barang diperbarui");
    onSaved();
  }

  const editTrapRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });
  const editVvBox = useVisualViewportBox();
  const editVvStyle = visualViewportDialogStyle(editVvBox);

  return (
    <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose}>
      <div
        ref={editTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Edit barang"
        style={
          editVvStyle
            ? { top: editVvStyle.top, maxHeight: editVvStyle.maxHeight, transform: "translate(-50%, -50%)" }
            : undefined
        }
        className={`fixed left-1/2 flex w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 flex-col rounded-lg border bg-card ${
          editVvStyle
            ? ""
            : "top-1/2 -translate-y-1/2 [max-height:calc(var(--app-vh-visible,var(--app-vh,100dvh))-2rem)]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b px-ms-4 py-ms-3 text-ms-sm font-semibold">Edit Barang</div>
        <div className="min-h-0 flex-1 space-ms-3 overflow-y-auto overscroll-contain px-ms-4 py-ms-3">
        <label className="block">
          <span className="text-[0.6875rem] text-muted-foreground">Nama</span>
          <input className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <PhotoPicker value={imagePath} onChange={setImagePath} uid={uid} />
        <label className="block">
          <span className="text-[0.6875rem] text-muted-foreground">Kategori</span>
          <input className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[0.6875rem] text-muted-foreground">Deskripsi (tampil di katalog publik)</span>
          <textarea
            rows={3}
            className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Contoh: kemasan 1 kg, kualitas premium, cocok untuk…"
          />
        </label>
        <div className="grid grid-cols-2 gap-ms-2">
          <label className="block">
            <span className="text-[0.6875rem] text-muted-foreground">Jenis kemasan</span>
            <select className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" value={packageType} onChange={(e) => setPackageType(e.target.value as PackageType)}>
              <option value="gram">gram (curah, ecer: gram)</option>
              <option value="botol">botol (ecer: botol · 1 karton = 100 botol)</option>
              <option value="sachet">sachet (ecer: sachet)</option>
              <option value="pcs">pcs (ecer: pcs)</option>
            </select>
          </label>
          {packageType !== "pcs" && (
            <label className="block">
              <span className="text-[0.6875rem] text-muted-foreground">Isi / kemasan ({baseUnit})</span>
              {baseUnit === "g" ? (
                <SmartWeightInput
                  value={packageSize}
                  onChange={setPackageSize}
                  baseUnit="g"
                  className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
                  min={0.01}
                  ariaLabel="Isi per kemasan (gram/kg/ons)"
                />
              ) : (
                <NumericTextField value={packageSize} onValueChange={setPackageSize} step={0.01} decimal={true} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" />
              )}
            </label>
          )}
        </div>
        <div className="grid grid-cols-2 gap-ms-2">
          <label className="block">
            <span className="text-[0.6875rem] text-muted-foreground">Stok ({baseUnit})</span>
            {baseUnit === "g" ? (
              <SmartWeightInput
                value={stockBase}
                onChange={setStockBase}
                baseUnit="g"
                className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
                min={0}
                ariaLabel="Stok saat ini (gram/kg/ons)"
              />
            ) : (
              <NumericTextField value={stockBase} onValueChange={setStockBase} step={0.01} decimal={true} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" />
            )}
          </label>
          <label className="block">
            <span className="text-[0.6875rem] text-muted-foreground">HPP / {baseUnit} (Rp)</span>
            <NumericTextField value={avgCost} onValueChange={setAvgCost} step={0.01} decimal={true} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" />
          </label>
        </div>
        <label className="block">
          <span className="text-[0.6875rem] text-muted-foreground">Harga jual / {baseUnit} (Rp) — opsional</span>
          <NumericTextField value={sellingPrice} onValueChange={setSellingPrice} step={0.01} decimal={true} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" />
        </label>
        <div className="text-[0.6875rem] text-warning">
          ⚠️ Mengubah stok / HPP manual akan menimpa nilai dari riwayat pembelian.
        </div>
        {baseUnitChanged && (
          <div className="rounded-md border border-destructive bg-destructive/10 p-ms-2 text-[0.6875rem] text-destructive">
            🚨 Anda mengubah satuan dasar <b>{originalBaseUnit}</b> → <b>{baseUnit}</b>. Stok & HPP
            TIDAK dikonversi otomatis, dan histori pembelian/penjualan akan terbaca dalam satuan baru.
            Untuk barang yang sudah punya transaksi, sebaiknya buat <b>barang baru</b> daripada mengganti
            jenis kemasan antara <i>gram</i> dan <i>botol/sachet/pcs</i>.
          </div>
        )}
        </div>
        {/* Footer sticky: aksi selalu terjangkau meski soft-keyboard terbuka. */}
        <div className="shrink-0 space-ms-2 border-t bg-card px-ms-4 py-ms-3 [padding-bottom:max(var(--app-safe-bottom,env(safe-area-inset-bottom,0px)),0.75rem)] rounded-b-lg">
          <div className="flex gap-ms-2">
            <button disabled={saving} onClick={save} className="flex-1 rounded-md bg-primary px-ms-3 py-ms-2 text-ms-sm font-semibold text-primary-foreground disabled:opacity-50">
              {saving ? "Menyimpan..." : "Simpan"}
            </button>
            <button onClick={onClose} className="rounded-md border px-ms-3 py-ms-2 text-ms-sm hover:bg-accent">Batal</button>
          </div>
          <button
            type="button"
            onClick={() => setShowPackages(true)}
            className="mt-1 w-full rounded-md border bg-background px-ms-3 py-ms-2 text-ms-xs font-semibold hover:bg-accent"
          >
            📦 Paket Siap Kirim
          </button>
        </div>
      </div>
      {showPackages && uid && (
        <ReadyPackagesPanel
          item={{
            id: item.id,
            name: item.name,
            base_unit: baseUnit,
            stock_base: currentStock,
            package_type: item.package_type,
            package_size: item.package_size,
          }}
          uid={uid}
          onClose={() => setShowPackages(false)}
          onStockChanged={async () => {
            const { data } = await supabase.from("warehouse_items").select("stock_base").eq("id", item.id).single();
            if (data) {
              setCurrentStock(Number(data.stock_base) || 0);
              setStockBase(String(Number(data.stock_base) || 0));
            }
            onSilentRefresh?.();
          }}
        />
      )}
    </div>
  );
}

/* ----------------- SUPPLIER ----------------- */
function SupplierTab({ suppliers, uid, onChanged }: { suppliers: Supplier[]; uid: string | null; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailBcc, setEmailBcc] = useState("");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const { data: myProfile } = useMyProfile();
  const [supConflict, setSupConflict] = useState<{ hit: PartyDuplicateHit; ev: React.FormEvent } | null>(null);
  const normalizedMyPhone = normalizeWaNumber(myProfile?.phone, myProfile?.country_code);
  const canUseMyContact = !!(myProfile?.display_name || normalizedMyPhone);
  function useMyContact() {
    if (!myProfile) return;
    const filled: string[] = [];
    if (myProfile.display_name) { setName(myProfile.display_name); filled.push("nama"); }
    if (normalizedMyPhone) { setContact(normalizedMyPhone); filled.push("no. WA"); }
    else if (myProfile.phone) {
      toast.warning("Nomor WA di profil tidak valid — perbarui di halaman Profil Akun");
    }
    if (filled.length) toast.success(`Diisi dari akun Anda (${filled.join(" & ")})`);
  }

  function resetForm() {
    setEditingId(null); setName(""); setContact(""); setEmail(""); setEmailCc(""); setEmailBcc(""); setNotes("");
  }
  function startEdit(s: Supplier) {
    setEditingId(s.id);
    setName(s.name);
    setContact(s.contact ?? "");
    setEmail(s.email ?? "");
    setEmailCc(s.email_cc ?? "");
    setEmailBcc(s.email_bcc ?? "");
    setNotes(s.notes ?? "");
  }
  async function submit(e: React.FormEvent, opts?: { force?: boolean }) {
    e.preventDefault();
    if (!uid || !name.trim()) return;
    const payload = {
      name: name.trim(),
      contact: contact.trim() || null,
      email: email.trim() || null,
      email_cc: emailCc.trim() || null,
      email_bcc: emailBcc.trim() || null,
      notes: notes.trim() || null,
    };
    const dup = findPartyDuplicate({ rows: suppliers, currentId: editingId, name, contact, email });
    if (dup && !opts?.force) {
      setSupConflict({ hit: dup, ev: e });
      return;
    }
    if (editingId) {
      const { error } = await supabase.from("suppliers").update(payload).eq("id", editingId);
      if (error) { notifyError(error); return; }
      toast.success("Supplier diperbarui");
    } else {
      const { error } = await supabase.from("suppliers").insert({ user_id: uid, ...payload });
      if (error) { notifyError(error); return; }
      toast.success("Supplier ditambahkan");
    }
    resetForm();
    onChanged();
  }
  async function remove(id: string, n: string) {
    if (!(await confirm({
      title: "Hapus supplier?",
      description: `Data supplier "${n}" akan dihapus permanen.`,
      confirmText: "Hapus",
    }))) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) notifyError(error);
    else {
      toast.success("Supplier dihapus");
      if (editingId === id) resetForm();
      onChanged();
    }
  }
  return (
    <div className="space-ms-3">
      <form onSubmit={submit} className="space-ms-2 rounded-lg border bg-card p-ms-3">
        <div className="text-ms-xs font-semibold">{editingId ? "Edit Supplier" : "Tambah Supplier"}</div>
        <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="Nama supplier *" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="Kontak (opsional)" value={contact} onChange={(e) => setContact(e.target.value)} />
        <input type="email" className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="Email (opsional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="CC (pisahkan dengan koma, opsional)" value={emailCc} onChange={(e) => setEmailCc(e.target.value)} />
        <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="BCC (pisahkan dengan koma, opsional)" value={emailBcc} onChange={(e) => setEmailBcc(e.target.value)} />
        <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="Catatan (opsional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button
          type="button"
          onClick={useMyContact}
          disabled={!canUseMyContact}
          className="w-full rounded-md border border-dashed px-ms-3 py-1.5 text-[0.6875rem] text-muted-foreground hover:bg-accent disabled:opacity-50"
          title={canUseMyContact ? "Isi nama & no. WA dari profil akun Anda" : "Lengkapi profil akun terlebih dahulu"}
        >
          👤 Pakai kontak akun saya
        </button>
        <div className="flex gap-ms-2">
          <button className="flex-1 rounded-md bg-primary px-ms-3 py-ms-2 text-ms-sm font-semibold text-primary-foreground">
            {editingId ? "Perbarui" : "Simpan"}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="rounded-md border px-ms-3 py-ms-2 text-ms-sm hover:bg-accent">
              Batal
            </button>
          )}
        </div>
      </form>
      <DuplicateConflictDialog
        open={!!supConflict}
        onOpenChange={(v) => { if (!v) setSupConflict(null); }}
        info={
          supConflict
            ? {
                label: supConflict.hit.label,
                reason: supConflict.hit.reason,
                existing: {
                  name: supConflict.hit.row.name,
                  phone: supConflict.hit.row.contact,
                  email: supConflict.hit.row.email,
                  note: (supConflict.hit.row as Supplier).notes ?? null,
                },
                incoming: { name, phone: contact || null, email: email || null },
              }
            : null
        }
        onKeep={() => {
          const ev = supConflict?.ev;
          setSupConflict(null);
          if (ev) void submit(ev, { force: true });
        }}
      />
      {suppliers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">Belum ada supplier.</div>
      ) : (
        <ul className="space-ms-2">
          {suppliers.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-ms-2 rounded-lg border bg-card p-ms-3">
              <div className="min-w-0">
                <div className="truncate text-ms-sm font-semibold" title={s.name}>{s.name}</div>
                {s.contact && (
                  <div className="mt-1 flex flex-wrap items-center gap-ms-1.5">
                    <span className="text-[0.6875rem] text-muted-foreground">📞 {s.contact}</span>
                    {(() => {
                      const digits = s.contact.replace(/\D/g, "");
                      const wa = digits.startsWith("0") ? "62" + digits.slice(1) : digits;
                      return (
                        <>
                          <a
                            href={`tel:${s.contact}`}
                            className="rounded border border-sky-500 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-sky-600 hover:bg-sky-500/10 dark:text-sky-400"
                            aria-label={`Panggil ${s.name}`}
                          >
                            📞 Panggil
                          </a>
                          {wa && (
                            <a
                              href={`https://wa.me/${wa}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded border border-success px-1.5 py-0.5 text-[0.6875rem] font-semibold text-success hover:bg-success/10 dark:text-success"
                              aria-label={`Kirim via WhatsApp ke ${s.name}`}
                            >
                              💬 Chat
                            </a>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
                {s.email && (
                  <div className="mt-1 flex flex-wrap items-center gap-ms-1.5">
                    <span className="truncate text-[0.6875rem] text-muted-foreground" title={s.email}>📧 {s.email}</span>
                    <a
                      href={buildMailto({ to: s.email, cc: s.email_cc, bcc: s.email_bcc }).href}
                      className="rounded border border-indigo-500 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-indigo-600 hover:bg-indigo-500/10 dark:text-indigo-400"
                      aria-label={`Email ${s.name}`}
                    >
                      📧 Email
                    </a>
                  </div>
                )}
                {(s.email_cc || s.email_bcc) && (() => {
                  const split = (raw: string | null) =>
                    (raw ?? "").split(",").map((x) => x.trim()).filter(Boolean);
                  const ccAll = split(s.email_cc);
                  const bccAll = split(s.email_bcc);
                  const ccInvalid = ccAll.filter((x) => !isValidEmail(x));
                  const bccInvalid = bccAll.filter((x) => !isValidEmail(x));
                  return (
                    <>
                      <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                        {ccAll.length > 0 && <span>CC: {ccAll.join(", ")}</span>}
                        {ccAll.length > 0 && bccAll.length > 0 && <span> · </span>}
                        {bccAll.length > 0 && <span>BCC: {bccAll.join(", ")}</span>}
                      </div>
                      {(ccInvalid.length > 0 || bccInvalid.length > 0) && (
                        <div className="mt-0.5 text-[0.6875rem] text-warning">
                          ⚠️ Alamat tidak valid diabaikan: {[...ccInvalid, ...bccInvalid].join(", ")}
                        </div>
                      )}
                    </>
                  );
                })()}
                {s.notes && <div className="mt-1 text-[0.6875rem] text-muted-foreground">{s.notes}</div>}
              </div>
              <div className="flex shrink-0 gap-ms-1">
                <button
                  onClick={() => startEdit(s)}
                  className={`rounded border px-ms-2 py-1 text-[0.6875rem] hover:bg-accent ${editingId === s.id ? "border-primary text-primary" : ""}`}
                >
                  Edit
                </button>
                <button onClick={() => remove(s.id, s.name)} className="rounded border px-ms-2 py-1 text-[0.6875rem] text-destructive hover:bg-destructive/10">Hapus</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----------------- BELI ----------------- */
function BeliTab({ suppliers, items, uid, onChanged, defaultPayment = "kas" }: { suppliers: Supplier[]; items: WItem[]; uid: string | null; onChanged: () => void; defaultPayment?: "kas" | "hutang" }) {
  const [supplierId, setSupplierId] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [itemId, setItemId] = useState("");
  // new item
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [packageType, setPackageType] = useState<PackageType>("botol");
  const [packageSize, setPackageSize] = useState("500");
  const [newImagePath, setNewImagePath] = useState<string | null>(null);
  // purchase
  const [packageQty, setPackageQty] = useState("1");
  const [pricePerPackage, setPricePerPackage] = useState("");
  const [priceMode, setPriceMode] = useState<"package" | "base">("package");
  const [pricePerBase, setPricePerBase] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"kas" | "hutang">(defaultPayment);
  // Input dalam karton (hanya untuk satuan botol). 1 karton = 100 botol.
  const [inputKarton, setInputKarton] = useState(false);

  // ── Draft persisten ───────────────────────────────────────────────
  // Form ini panjang dan sering diketik sambil keyboard/notifikasi WA
  // muncul. Bila WebView me-restart tab ATAU DomRaceBoundary memulihkan
  // subtree setelah race `removeChild`, seluruh state lokal hilang.
  // Draft di localStorage (per user) membuat ketikan kembali otomatis.
  const beliDraft = useMemo(
    () => ({
      supplierId, mode, itemId, name, category, packageType, packageSize,
      packageQty, pricePerPackage, priceMode, pricePerBase, paymentMethod, inputKarton,
    }),
    [supplierId, mode, itemId, name, category, packageType, packageSize,
      packageQty, pricePerPackage, priceMode, pricePerBase, paymentMethod, inputKarton],
  );
  const draft = useFormDraft("mcm:draft:gudang-beli", uid, beliDraft, (d) => {
    if (typeof d.supplierId === "string") setSupplierId(d.supplierId);
    if (d.mode === "new" || d.mode === "existing") setMode(d.mode);
    if (typeof d.itemId === "string") setItemId(d.itemId);
    if (typeof d.name === "string") setName(d.name);
    if (typeof d.category === "string") setCategory(d.category);
    if (typeof d.packageType === "string") setPackageType(d.packageType as PackageType);
    if (typeof d.packageSize === "string") setPackageSize(d.packageSize);
    if (typeof d.packageQty === "string") setPackageQty(d.packageQty);
    if (typeof d.pricePerPackage === "string") setPricePerPackage(d.pricePerPackage);
    if (d.priceMode === "package" || d.priceMode === "base") setPriceMode(d.priceMode);
    if (typeof d.pricePerBase === "string") setPricePerBase(d.pricePerBase);
    if (d.paymentMethod === "kas" || d.paymentMethod === "hutang") setPaymentMethod(d.paymentMethod);
    if (typeof d.inputKarton === "boolean") setInputKarton(d.inputKarton);
  });

  useEffect(() => {
    if (mode === "existing" && !itemId && items[0]) setItemId(items[0].id);
  }, [mode, items, itemId]);

  // Aturan alur botol: satuan terkecil = **botol**, tingkat di atas =
  // **karton** (1 karton = 100 botol). Tidak ada sub-unit "pcs" di dalam
  // botol. Paksa package_size=1 saat user memilih Jenis kemasan "botol"
  // agar field "Isi/kemasan (pcs)" tidak muncul & ringkasan tidak lagi
  // menampilkan "500 pcs".
  useEffect(() => {
    if (packageType === "botol" && packageSize !== "1") setPackageSize("1");
  }, [packageType, packageSize]);

  // Untuk mode "existing", SEMUA turunan (jenis kemasan, ukuran, base unit)
  // WAJIB diambil dari item terpilih — bukan state form "barang baru".
  // Anotasi eksplisit + useMemo mencegah TDZ (TS2448/TS2454) bila hook lain
  // di bawah memindahkan urutan referensi di edit-edit berikutnya.
  const selectedItem: WItem | null = useMemo(
    () => (mode === "existing" ? items.find((i) => i.id === itemId) ?? null : null),
    [mode, items, itemId],
  );
  // Type guard eksplisit: menyempitkan `WItem | null` menjadi `WItem`.
  // Dipakai di setiap titik akses agar tidak ada properti yang dibaca
  // dari nilai null saat itemId kosong / item terhapus.
  const isWItem = (v: WItem | null): v is WItem => v !== null;
  // GUARD DEP ARRAY MINIMAL — turunan (derived/warnings) dan effect
  // downstream hanya bergantung pada TIGA primitif yang jadi kunci
  // identitas item: `mode`, `itemId`, `packageType`. Field selectedItem
  // yang dibutuhkan compute (package_type, package_size, base_unit,
  // stock_base, avg_cost_per_base) dibaca via closure di dalam body memo,
  // sehingga refetch `items` yang mengganti identitas objek TIDAK memicu
  // useMemo untuk re-eksekusi. Selain itu, computeBeliDerived/Warnings
  // sudah content-memoize hasilnya jadi walau factory sesekali jalan
  // ulang, referensi output tetap stabil.
  //
  // Catatan: `itemId` adalah proxy dep untuk konten item — di aplikasi ini
  // fields packaging pada satu itemId bersifat immutable dari perspektif
  // form (perubahan schema akan menghasilkan itemId berbeda / mode 'new').
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const derived = useMemo(
    () =>
      computeBeliDerived({
        mode,
        selectedItem: isWItem(selectedItem) ? selectedItem : null,
        newPackageType: packageType,
        newPackageSize: packageSize,
        packageQty,
        pricePerPackage,
        priceMode,
        pricePerBase,
        inputKarton,
      }),
    [
      mode,
      itemId,
      packageType,
      packageSize,
      packageQty,
      pricePerPackage,
      priceMode,
      pricePerBase,
      inputKarton,
    ],
  );
  const { effPackageType, effBaseUnit, effectivePkgSize, kartonActive, pkgQ, price, baseAdded, totalCost } = derived;
  const baseUnit = effBaseUnit;
  // Label & ringkasan HARUS mengikuti pilihan Jenis kemasan pada mode "new"
  // atau item terpilih pada mode "existing" — dihitung langsung tanpa
  // memoization agar tidak pernah tertinggal sinkron dengan dropdown.
  const displayPackageType: PackageType = mode === "existing" && isWItem(selectedItem)
    ? (selectedItem.package_type as PackageType)
    : packageType;
  const displayBaseUnit: "g" | "pcs" = mode === "existing" && isWItem(selectedItem)
    ? (selectedItem.base_unit as "g" | "pcs")
    : defaultBase(packageType);
  const displayPkgSize: number = mode === "existing" && isWItem(selectedItem)
    ? Number(selectedItem.package_size) || 0
    : (packageType === "pcs" ? 1 : Number(packageSize) || 0);
  // Satuan dasar untuk display stok. Menghormati `package_size`: hanya
  // GS-like (botol/pcs dengan package_size===1) yang dilabel "botol"; untuk
  // botol dengan isi >1 pcs, satuan stok = "pcs" (bukan "botol").
  // Tanpa ini, kalimat "Stok disimpan dalam botol" muncul padahal stok
  // base bertambah pcs — membingungkan user (smoke-test Beli).
  const displayHumanBase = stockBaseUnitLabel(displayPackageType, displayBaseUnit, displayPkgSize);
  // True jika label jenis kemasan secara semantik SAMA dengan satuan dasar
  // (mis. package_type="gram" dgn base_unit="g"). Kalau iya, semua tombol/
  // hint "per package" hanya menduplikasi label satuan dasar — sembunyikan.
  const packageDuplicatesBase = isSameUnitLabel(displayPackageType, displayBaseUnit)
    || isSameUnitLabel(displayPackageType, displayHumanBase);
  // `warnings` — memoized: dep array minimal (mode, itemId, packageType,
  // derived, priceMode, inputKarton). Refetch identitas selectedItem tidak
  // menembak memo karena selectedItem TIDAK ada di deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const warnings = useMemo(
    () =>
      computeBeliWarnings({
        mode,
        selectedItem: isWItem(selectedItem) ? selectedItem : null,
        derived,
        priceMode,
        inputKarton,
      }).filter((w) => w.level !== "error"),
    [mode, itemId, packageType, derived, priceMode, inputKarton],
  );

  // Bila item terpilih bukan botol, mode karton wajib mati agar tidak
  // ×100 dari qty. Bila pindah ke item pcs, harga per-kemasan tidak
  // punya arti — paksa priceMode ke "base".
  //
  // Dep array minimal: [mode, itemId, inputKarton, priceMode]. `itemId`
  // adalah proxy identitas item — refetch dengan itemId sama TIDAK memicu
  // effect. `selectedItem` dibaca via closure untuk mengambil package_type
  // pada saat effect dijalankan.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isWItem(selectedItem)) return;
    if (selectedItem.package_type !== "botol" && inputKarton) setInputKarton(false);
    if (selectedItem.package_type === "pcs" && priceMode !== "base") setPriceMode("base");
    // Kalau jenis kemasan cuma sinonim dari satuan dasar (mis. gram vs g),
    // paksa priceMode "base" agar tidak ada label duplikat di ringkasan/input.
    if (packageDuplicatesBase && priceMode !== "base") setPriceMode("base");
  }, [mode, itemId, inputKarton, priceMode]);

  // Kunci/reset state saat pengguna cepat mengganti item atau mode agar
  // sisa state (karton, priceMode, harga, qty, nilai "barang baru") dari
  // pilihan sebelumnya tidak ikut terbawa ke item/mode berikutnya.
  // `resetKey` di-memoize sehingga identitas string-nya STABIL selama trigger
  // (mode, itemId, packageType) tidak berubah. Ini yang membuat effect di
  // bawah bisa hanya bergantung pada `resetKey` — tidak ada alokasi/kompute
  // ulang saat render biasa (mis. items refetch dengan identitas baru).
  const resetKey = useMemo(
    () => beliResetKey({ mode, itemId, packageType }),
    [mode, itemId, packageType],
  );
  // Nilai priceMode default dibaca via ref agar effect tidak perlu menaruh
  // `selectedItem`/`mode`/`packageType` di dep array — jadi effect benar-benar
  // hanya jalan saat `resetKey` berubah, bukan setiap kali `selectedItem`
  // dapat identitas baru dari refetch items.
  const nextPriceModeRef = useRef<"package" | "base">("package");
  nextPriceModeRef.current =
    mode === "existing"
      ? isWItem(selectedItem) && selectedItem.package_type === "pcs"
        ? "base"
        : "package"
      : packageType === "pcs"
        ? "base"
        : "package";
  useEffect(() => {
    // Angka pembelian selalu direset agar tidak terbawa lintas item.
    setPackageQty("1");
    setPricePerPackage("");
    setPricePerBase("");
    // Karton hanya masuk akal untuk item botol; matikan default.
    setInputKarton(false);
    // priceMode default: "package" untuk item non-pcs, "base" untuk pcs.
    // Dibaca via ref (di-refresh tiap render) agar dep effect tetap minimal.
    setPriceMode(nextPriceModeRef.current);
  }, [resetKey]);

  function resetBeliForm() {
    setSupplierId("");
    setMode("new");
    setItemId("");
    setName("");
    setCategory("");
    setPackageType("botol");
    setPackageSize("500");
    setNewImagePath(null);
    setPackageQty("1");
    setPricePerPackage("");
    setPriceMode("package");
    setPricePerBase("");
    setPaymentMethod(defaultPayment);
    setInputKarton(false);
    draft.clear();
    toast.success("Form direset");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!uid) return;
    if (pkgQ <= 0 || price < 0) { toast.error("Periksa jumlah & harga"); return; }
    if (paymentMethod === "hutang" && !supplierId) {
      toast.error("Pembelian hutang wajib memilih supplier");
      return;
    }

    let useItemId = itemId;
    let useSize = effectivePkgSize;
    if (mode === "new") {
      if (!name.trim()) { toast.error("Nama barang wajib"); return; }
      if (packageType !== "pcs" && effectivePkgSize <= 0) { toast.error("Ukuran kemasan harus > 0"); return; }
      let freshUid: string;
      try { freshUid = (await ensureFreshSession()).userId; }
      catch (e) { notifyError(e, { fallback: "Sesi berakhir. Silakan login ulang." }); return; }
      try { await assertStorageAccess(freshUid); }
      catch (e) { notifyError(e); return; }
      const { data, error } = await supabase.from("warehouse_items").insert({
        user_id: freshUid,
        name: name.trim(),
        category: category.trim() || null,
        package_type: packageType,
        package_size: packageType === "pcs" ? 1 : effectivePkgSize,
        base_unit: baseUnit,
        image_path: newImagePath,
      }).select().single();
      if (error || !data) { notifyError(error, { fallback: "Gagal buat barang" }); return; }
      useItemId = (data as WItem).id;
      useSize = (data as WItem).package_size;
    } else {
      if (!isWItem(selectedItem)) { toast.error("Pilih barang"); return; }
      useItemId = selectedItem.id;
      useSize = selectedItem.package_size;
    }

    const { error } = await supabase.from("purchases").insert({
      user_id: uid,
      supplier_id: supplierId || null,
      item_id: useItemId,
      package_qty: pkgQ,
      package_size_snapshot: useSize,
      base_added: pkgQ * useSize,
      price_per_package: price,
      total_cost: pkgQ * price,
      payment_method: paymentMethod,
    });
    if (error) { notifyError(error); return; }
    toast.success(`Pembelian dicatat (${paymentMethod === "hutang" ? "hutang" : "kas"}), stok bertambah`);
    setName(""); setCategory(""); setPackageQty("1"); setPricePerPackage(""); setPricePerBase(""); setNewImagePath(null);
    draft.clear();
    onChanged();
  }

  return (
    <form onSubmit={submit} className="space-ms-3 rounded-lg border bg-card p-ms-3">
      <div className="flex items-center justify-between">
        <div className="text-ms-xs font-semibold">Catat Pembelian</div>
        <button
          type="button"
          onClick={resetBeliForm}
          className="rounded border px-ms-2 py-1 text-[0.6875rem] hover:bg-muted"
          aria-label="Reset form pembelian"
        >
          Reset
        </button>
      </div>

      <DraftSafetyNotice status={draft.status} savedAt={draft.savedAt} />

      <label className="block">
        <span className="text-[0.6875rem] text-muted-foreground">Supplier</span>
        <select className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">— Tanpa supplier —</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>

      <div className="flex gap-ms-1 text-ms-xs">
        <button type="button" onClick={() => setMode("new")} className={`flex-1 rounded border px-ms-2 py-1 ${mode === "new" ? "bg-primary text-primary-foreground border-primary" : ""}`}>Barang baru</button>
        <button type="button" onClick={() => setMode("existing")} className={`flex-1 rounded border px-ms-2 py-1 ${mode === "existing" ? "bg-primary text-primary-foreground border-primary" : ""}`} disabled={items.length === 0}>Barang yang ada</button>
      </div>

      {mode === "new" ? (
        <div className="space-ms-2">
          <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="Nama barang *" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="Kategori (opsional, mis. Minuman)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <div className="grid grid-cols-2 gap-ms-2">
            <label className="block">
              <span className="text-[0.6875rem] text-muted-foreground">Jenis kemasan</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
                value={packageType === "botol" && inputKarton ? "karton" : packageType}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "karton") {
                    // Karton = wadah 100 botol; secara internal item disimpan
                    // sebagai botol (satuan ecer), input pembelian per karton.
                    setPackageType("botol");
                    setInputKarton(true);
                    setPriceMode("package");
                  } else {
                    setPackageType(v as PackageType);
                    setInputKarton(false);
                  }
                }}
              >
                <option value="gram">gram (curah, ecer: gram)</option>
                <option value="karton">karton (ecer: botol · 1 karton = 100 botol)</option>
                <option value="botol">botol (ecer: botol)</option>
                <option value="sachet">sachet (ecer: sachet)</option>
                <option value="pcs">pcs (ecer: pcs)</option>
              </select>
            </label>
            {packageType !== "pcs" && packageType !== "botol" && (
              <label className="block">
                <span className="text-[0.6875rem] text-muted-foreground">Isi / kemasan ({displayBaseUnit})</span>
                {displayBaseUnit === "g" ? (
                  <SmartWeightInput
                    value={packageSize}
                    onChange={setPackageSize}
                    baseUnit="g"
                    className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
                    required
                    min={0.01}
                    ariaLabel="Isi per kemasan (gram/kg/ons)"
                  />
                ) : (
                  <NumericTextField value={packageSize} onValueChange={setPackageSize} step={0.01} decimal={true} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" required />
                )}
              </label>
            )}
          </div>
          <div className="text-[0.6875rem] text-muted-foreground">
            {displayPackageType === "botol" ? (
              <>
                Pembelian dicatat per <b>{kartonActive ? "karton" : "botol"}</b>. 1 karton = {BOTOL_PER_KARTON} botol. Stok bertambah dalam <b>botol</b>.
              </>
            ) : packageType !== "pcs" && displayPkgSize > 0 && !packageDuplicatesBase ? (
              <>
                Pembelian dicatat per <b>{displayPackageType}</b>. 1 {displayPackageType} = {displayPkgSize} {displayHumanBase}. Stok bertambah dalam <b>{displayHumanBase}</b>.
              </>
            ) : (
              <>Stok disimpan dalam <b>{displayHumanBase}</b>.</>
            )}
          </div>
          <PhotoPicker value={newImagePath} onChange={setNewImagePath} uid={uid} />
        </div>
      ) : (
        <label className="block">
          <span className="text-[0.6875rem] text-muted-foreground">Pilih barang</span>
          <select className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" value={itemId} onChange={(e) => setItemId(e.target.value)} required>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.package_type}{i.package_type !== "pcs" ? ` ${i.package_size} ${humanBaseUnit(i.package_type, i.base_unit)}` : ""}) · stok {fmtItemQty(i.stock_base, i)}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-ms-2">
        <label className="block">
          <span className="text-[0.6875rem] text-muted-foreground">
            Jumlah {kartonActive
              ? "karton"
              : (displayPackageType && displayPackageType !== "pcs"
                  ? displayPackageType
                  : displayHumanBase || "unit")}
          </span>
          <NumericTextField value={packageQty} onValueChange={setPackageQty} step={0.01} decimal={true} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" required />
        </label>
        {priceMode === "package" ? (
          <label className="block">
            <span className="text-[0.6875rem] text-muted-foreground">
              Harga beli / {kartonActive ? "karton" : displayPackageType} (Rp)
            </span>
            <NumericTextField value={pricePerPackage} onValueChange={setPricePerPackage} step={1} decimal={false} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" required />
          </label>
        ) : (
          <label className="block">
            <span className="text-[0.6875rem] text-muted-foreground">Harga beli / {displayHumanBase} (Rp)</span>
            <NumericTextField value={pricePerBase} onValueChange={setPricePerBase} step={0.01} decimal={true} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" required />
          </label>
        )}
      </div>

      {displayPackageType === "botol" && (
        <label className="flex items-center gap-ms-2 text-[0.6875rem] text-muted-foreground">
          <input
            type="checkbox"
            checked={inputKarton}
            onChange={(e) => { setInputKarton(e.target.checked); setPriceMode("package"); }}
            className="h-3.5 w-3.5"
          />
          Input dalam karton (1 karton = {BOTOL_PER_KARTON} botol)
          {kartonActive && (Number(packageQty) || 0) > 0 && (
            <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
              = {pkgQ.toLocaleString("id-ID")} botol
            </span>
          )}
        </label>
      )}

      {displayPackageType !== "pcs" && !packageDuplicatesBase && (
        <div className="flex gap-ms-1 text-ms-xs">
          <button type="button" onClick={() => setPriceMode("package")} className={`flex-1 rounded border px-ms-2 py-1 ${priceMode === "package" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
            Harga per {displayPackageType}
          </button>
          <button type="button" onClick={() => setPriceMode("base")} className={`flex-1 rounded border px-ms-2 py-1 ${priceMode === "base" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
            Harga per {displayBaseUnit}
          </button>
        </div>
      )}

      <div>
        <div className="text-[0.6875rem] text-muted-foreground mb-1">Cara bayar</div>
        <div className="flex gap-ms-1 text-ms-xs">
          <button
            type="button"
            onClick={() => setPaymentMethod("kas")}
            className={`flex-1 rounded border px-ms-2 py-1.5 ${paymentMethod === "kas" ? "bg-primary text-primary-foreground border-primary" : ""}`}
          >
            💵 Kas (lunas)
          </button>
          <button
            type="button"
            onClick={() => setPaymentMethod("hutang")}
            className={`flex-1 rounded border px-ms-2 py-1.5 ${paymentMethod === "hutang" ? "bg-warning text-warning-foreground border-warning" : ""}`}
          >
            📝 Hutang
          </button>
        </div>
      </div>

      <div
        className="rounded-md border bg-muted/50 p-ms-2 text-[0.6875rem] space-y-1"
        aria-live="polite"
        aria-label="Ringkasan pembelian"
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold text-foreground">Ringkasan</span>
          {isWItem(selectedItem) ? (
            <span className="text-[0.625rem] text-muted-foreground">
              {selectedItem.name} · {displayPackageType}
              {displayPackageType !== "pcs" &&
                !(displayPackageType === "botol" && displayBaseUnit === "pcs" && displayPkgSize === 1)
                ? ` ${displayPkgSize} ${displayBaseUnit}`
                : ""}
            </span>
          ) : (
            <span className="text-[0.625rem] text-muted-foreground">
              Barang baru · {displayPackageType}
              {displayPackageType !== "pcs" &&
                !(displayPackageType === "botol" && displayBaseUnit === "pcs" && displayPkgSize === 1)
                ? ` ${displayPkgSize} ${displayBaseUnit}`
                : ""}
            </span>
          )}
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Jumlah beli</span>
          <b>
            <KemasanRumusPopover
              packageType={displayPackageType}
              packageSize={displayPkgSize}
              baseUnit={displayBaseUnit}
              qty={pkgQ}
              mode="package"
              testId="beli-jumlah-kemasan-rumus"
            >
              {kartonActive
                ? `${(pkgQ / BOTOL_PER_KARTON).toLocaleString("id-ID")} karton`
                : `${pkgQ.toLocaleString("id-ID")} ${displayPackageType}`}
            </KemasanRumusPopover>
          </b>
        </div>
        {kartonActive ? (
          <div className="flex justify-between text-[0.625rem] text-muted-foreground">
            <span>Konversi</span>
            <span>
              {(pkgQ / BOTOL_PER_KARTON).toLocaleString("id-ID")} karton = {pkgQ.toLocaleString("id-ID")} botol
            </span>
          </div>
        ) : displayPackageType !== "pcs" && displayPkgSize > 1 && !packageDuplicatesBase ? (
          <div className="flex justify-between text-[0.625rem] text-muted-foreground">
            <span>Konversi</span>
            <span>
              1 {displayPackageType} = {displayPkgSize.toLocaleString("id-ID")} {displayHumanBase}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tambahan stok</span>
          <b>
            {isWItem(selectedItem)
              ? fmtItemQty(baseAdded, selectedItem)
              : displayPackageType === "botol"
                ? `${Math.round(baseAdded).toLocaleString("id-ID")} botol`
                : fmtBase(baseAdded, displayBaseUnit)}
          </b>
        </div>
        {kartonActive ? (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Harga per karton</span>
              <b>{rupiah(price * BOTOL_PER_KARTON)}</b>
            </div>
            <div className="flex justify-between text-[0.625rem] text-muted-foreground">
              <span>Harga per botol</span>
              <span>{rupiah(price)}</span>
            </div>
          </>
        ) : (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Harga per {displayPackageType}</span>
            <b>{rupiah(price)}</b>
          </div>
        )}
        {displayPackageType !== "pcs" && baseAdded > 0 && !packageDuplicatesBase && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Harga per {displayHumanBase}</span>
            <b>{rupiah(totalCost / baseAdded)}</b>
          </div>
        )}
        <div className="mt-1 flex justify-between border-t pt-1">
          <span className="text-muted-foreground">Total biaya</span>
          <b>
            {rupiah(totalCost)}{" "}
            <span className="text-[0.625rem] font-normal text-muted-foreground">
              ({paymentMethod === "hutang" ? "hutang" : "lunas"})
            </span>
          </b>
        </div>
        {isWItem(selectedItem) && Number(selectedItem.avg_cost_per_base) > 0 && baseAdded > 0 && (
          <div className="flex justify-between text-[0.625rem] text-muted-foreground">
            <span>Rata-rata modal item</span>
            <span>
              {rupiah(selectedItem.avg_cost_per_base)}/{stockBaseUnitLabel(selectedItem.package_type, selectedItem.base_unit, selectedItem.package_size)}
            </span>
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <ul
          className="space-y-1 rounded-md border border-warning bg-warning p-ms-2 text-[0.6875rem] text-warning dark:border-warning dark:bg-warning/40 dark:text-warning"
          role="alert"
          aria-label="Peringatan pembelian"
        >
          {warnings.map((w) => (
            <li key={w.code} className="flex gap-ms-1.5">
              <span aria-hidden>⚠️</span>
              <span>{w.message}</span>
            </li>
          ))}
          <li className="pt-0.5 text-[0.625rem] text-warning/80 dark:text-warning/80">
            Periksa kembali sebelum menyimpan. Tekan "Simpan pembelian" untuk tetap melanjutkan.
          </li>
        </ul>
      )}

      <button className="w-full rounded-md bg-primary px-ms-3 py-ms-2 text-ms-sm font-semibold text-primary-foreground">Simpan pembelian</button>
    </form>
  );
}

/* ----------------- JUAL ----------------- */
function JualTab({ items, customers, uid, onChanged }: { items: WItem[]; customers: Customer[]; uid: string | null; onChanged: () => void }) {
  const [itemId, setItemId] = useState("");
  const [sellMode, setSellMode] = useState<"base" | "package" | "karton">("base");
  const [qty, setQty] = useState("");
  const [pricePerBase, setPricePerBase] = useState("");
  const [pricePerPackage, setPricePerPackage] = useState("");
  const [note, setNote] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [newCustName, setNewCustName] = useState("");
  const [newCustWa, setNewCustWa] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"kas" | "hutang">("kas");
  // Paket "barang sudah jadi" yang sedang dipilih (hasil penyiapan pegawai).
  const [prep, setPrep] = useState<ReadyPrep | null>(null);

  useEffect(() => {
    if (!itemId && items[0]) setItemId(items[0].id);
  }, [items, itemId]);

  // Reset mode & input saat item berganti agar label satuan (g/pcs/botol)
  // selalu mengikuti item aktif — bukan warisan mode dari item sebelumnya.
  // Tanpa reset ini, memilih item gram setelah item botol tetap menampilkan
  // "Jumlah (botol)" / "Harga / botol" karena sellMode="package" stuck.
  useEffect(() => {
    setSellMode("base");
    setQty("");
    setPricePerBase("");
    setPricePerPackage("");
  }, [itemId]);

  // Setelah item terkunci oleh paket siap, isi jumlah dari berat paket.
  // Efek ini sengaja berada SETELAH reset di atas supaya nilainya menang.
  useEffect(() => {
    if (!prep) return;
    setSellMode("base");
    setQty(prep.grams > 0 ? String(prep.grams) : "");
  }, [prep, itemId]);

  const item = items.find((i) => i.id === itemId);
  const qtyN = Number(qty) || 0;
  // 1 karton = BOTOL_PER_KARTON botol. Faktor pengali ke base untuk tiap mode.
  const baseFactor = item
    ? sellMode === "base"
      ? 1
      : sellMode === "package"
        ? item.package_size
        : BOTOL_PER_KARTON * item.package_size
    : 0;
  const qtyBase = qtyN * baseFactor;
  const pricePerBaseEff = item
    ? sellMode === "base"
      ? Number(pricePerBase) || 0
      : baseFactor > 0
        ? (Number(pricePerPackage) || 0) / baseFactor
        : 0
    : 0;
  const total = qtyBase * pricePerBaseEff;
  const profit = item ? (pricePerBaseEff - item.avg_cost_per_base) * qtyBase : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !item) return;
    if (!Number.isFinite(qtyN) || qtyN <= 0) {
      toast.error("Jumlah harus diisi dan lebih dari 0");
      return;
    }
    const minBase = 0.01; // 0.01 g atau 0.01 pcs
    if (qtyBase < minBase) {
      const minLabel = humanBaseUnit(item.package_type, item.base_unit);
      toast.error(
        `Jumlah minimal ${minBase} ${minLabel}. Tidak bisa menjual di bawah itu.`
      );
      return;
    }
    if (qtyBase > item.stock_base) { toast.error(`Stok kurang. Tersedia ${fmtItemQty(item.stock_base, item)}`); return; }
    let useCustomerId: string | null = customerId || null;
    if (customerId === "__new__") {
      const nm = newCustName.trim();
      if (!nm) { toast.error("Isi nama pelanggan baru"); return; }
      const wa = newCustWa.trim();
      const { data: nc, error: ncErr } = await supabase
        .from("customers")
        .insert({ user_id: uid, name: nm, contact: wa || null })
        .select("id")
        .single();
      if (ncErr || !nc) { notifyError(ncErr ?? new Error("Gagal simpan pelanggan")); return; }
      useCustomerId = nc.id;
    }
    if (paymentMethod === "hutang" && !useCustomerId) {
      toast.error("Penjualan hutang wajib pilih pelanggan");
      return;
    }
    // H3: total_revenue & cost_at_sale diisi trigger apply_sale (SSOT).
    const { error } = await supabase.from("sales").insert({
      user_id: uid,
      item_id: item.id,
      qty_base: qtyBase,
      price_per_base: pricePerBaseEff,
      total_revenue: 0,
      note: note.trim() || null,
      customer_id: useCustomerId,
      payment_method: paymentMethod,
    });
    if (error) { notifyError(error); return; }
    if (prep) {
      // Tandai paket siap sebagai terjual agar tidak bisa dijual dua kali
      // dan status di /ecer ikut sinkron. Kegagalan di sini tidak
      // membatalkan penjualan — hanya diberitahukan ke operator.
      const { error: prepErr } = await supabase
        .from("ecer_preparations")
        .update({
          sold_at: new Date().toISOString(),
          sold_customer_id: useCustomerId,
          sold_total: total,
          sold_paid_amount: paymentMethod === "hutang" ? 0 : total,
          sold_payment_method: paymentMethod,
          sold_party_name: customers.find((c) => c.id === useCustomerId)?.name ?? null,
        })
        .eq("id", prep.id);
      if (prepErr) toast.warning("Penjualan tersimpan, tapi status paket siap gagal diperbarui");
      setPrep(null);
    }
    toast.success(`Penjualan dicatat (${paymentMethod === "hutang" ? "hutang" : "kas"}), stok berkurang`);
    setQty(""); setPricePerBase(""); setPricePerPackage(""); setNote("");
    setNewCustName(""); setNewCustWa("");
    if (customerId === "__new__") setCustomerId("");
    onChanged();
  }

  if (items.length === 0) {
    return <div className="rounded-lg border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">Belum ada barang. Catat pembelian dulu di tab <b>Beli</b>.</div>;
  }

  return (
    <form onSubmit={submit} className="space-ms-3 rounded-lg border bg-card p-ms-3">
      <div className="text-ms-xs font-semibold">Catat Penjualan</div>

      <ReadyPrepPicker
        selectedId={prep?.id ?? null}
        itemNameById={(id) => items.find((i) => i.id === id)?.name ?? null}
        onPick={(p) => {
          if (!p.warehouseItemId || !items.some((i) => i.id === p.warehouseItemId)) {
            toast.error("Paket ini belum tertaut ke barang gudang");
            return;
          }
          setItemId(p.warehouseItemId);
          setPrep(p);
        }}
        onClear={() => {
          setPrep(null);
          setQty("");
        }}
      />

      <label className="block">
        <span className="text-[0.6875rem] text-muted-foreground">Barang</span>
        <select className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" value={itemId} disabled={!!prep} onChange={(e) => setItemId(e.target.value)}>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} · stok {fmtQtyDual(i.stock_base, i.base_unit, i.package_type, i.package_size, i.package_type !== "pcs" ? "package" : "base", i.name)} · HPP {rupiah(i.avg_cost_per_base)}/{humanBaseUnit(i.package_type, i.base_unit)}
            </option>
          ))}
        </select>
      </label>

      {item && (() => {
        // SSOT label satuan jual: `humanBaseUnit(pt, bu)` — hanya
        // mengembalikan "botol" bila item benar-benar botol per-pcs
        // (pt='botol' & bu='pcs'). Untuk item gram (bu='g') selalu
        // "g"/"gram" tanpa peduli pt yang mungkin salah tag. Untuk pcs
        // murni → "pcs". Tidak ada fallback ke "botol".
        const humU = humanBaseUnit(item.package_type, item.base_unit) || "unit";
        const isBotolTrue =
          (item.package_type ?? "").trim().toLowerCase() === "botol" &&
          (item.base_unit ?? "").trim().toLowerCase() === "pcs";
        const pkgLabel = (item.package_type ?? "").trim();
        // Sembunyikan tombol "per package" kalau labelnya sama persis dengan
        // label satuan dasar (mis. GS: base "botol" = package "botol"), atau
        // kalau package_size ≤ 1 sehingga tidak ada konversi bermakna.
        // Untuk botol asli, tombol "per package" selalu redundan (karton
        // dipilih lewat tombol khusus di bawah).
        const showPackageBtn =
          !isBotolTrue &&
          pkgLabel !== "" &&
          pkgLabel !== "pcs" &&
          !isSameUnitLabel(pkgLabel, humU) &&
          !isSameUnitLabel(pkgLabel, item.base_unit) &&
          Number(item.package_size) > 1;
        const showKartonBtn = isBotolTrue;
        // Sinkronkan sellMode kalau tombolnya hilang (mis. ganti item
        // dari botol ke gram: mode 'karton'/'package' jadi invalid).
        if (!showPackageBtn && sellMode === "package") {
          // schedule via microtask to avoid setState during render
          Promise.resolve().then(() => setSellMode("base"));
        }
        if (!showKartonBtn && sellMode === "karton") {
          Promise.resolve().then(() => setSellMode("base"));
        }
        const packageLabelForQty = showPackageBtn ? pkgLabel : humU;
        return (
        <>
          <div className="flex gap-ms-1 text-ms-xs">
            <button type="button" onClick={() => setSellMode("base")} className={`flex-1 rounded border px-ms-2 py-1 ${sellMode === "base" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
              Jual per {humU}
            </button>
            {showPackageBtn && (
              <button type="button" onClick={() => setSellMode("package")} className={`flex-1 rounded border px-ms-2 py-1 ${sellMode === "package" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                Jual per {pkgLabel}
              </button>
            )}
            {showKartonBtn && (
              <button type="button" onClick={() => setSellMode("karton")} className={`flex-1 rounded border px-ms-2 py-1 ${sellMode === "karton" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                Jual per karton
              </button>
            )}
          </div>
          <div className="text-[0.625rem] text-muted-foreground">
            <KemasanRumusPopover
              packageType={item.package_type}
              packageSize={item.package_size}
              baseUnit={item.base_unit}
              qty={Number(qty) || 0}
              mode={sellMode}
              testId="jual-kemasan-hint-trigger"
            >
              {(() => {
                if (isBotolTrue) {
                  return `ℹ️ 1 karton = ${BOTOL_PER_KARTON} botol`;
                }
                // Base unit gram → selalu tampilkan aturan ons yang konsisten.
                if (item.base_unit === "g" && isSameUnitLabel(pkgLabel, "ons")) {
                  return `ℹ️ 1 ons = 100 gram`;
                }
                if (showPackageBtn) {
                  return `ℹ️ 1 ${pkgLabel} = ${item.package_size} ${humU}`;
                }
                // Kasus g/gram (label kemasan hanya sinonim satuan dasar).
                if (item.base_unit === "g") {
                  return `ℹ️ 1 kg = 1000 gram · 1 ons = 100 gram`;
                }
                return `ℹ️ Satuan dasar: ${humU}`;
              })()}
            </KemasanRumusPopover>
            <KemasanKonversiBadge
              packageType={item.package_type}
              packageSize={item.package_size}
              baseUnit={item.base_unit}
              qty={Number(qty) || 0}
              mode={sellMode}
              testId="jual-kemasan-konversi-badge"
            />
          </div>

          <div className="grid grid-cols-2 gap-ms-2">
            <label className="block">
              <span className="text-[0.6875rem] text-muted-foreground">
                Jumlah ({sellMode === "base" ? humU : sellMode === "karton" ? "karton" : packageLabelForQty})
              </span>
              {sellMode === "base" && item.base_unit === "g" ? (
                <SmartWeightInput
                  value={qty}
                  onChange={setQty}
                  baseUnit="g"
                  className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
                  required
                  min={0.01}
                  ariaLabel="Jumlah jual (gram/kg/ons)"
                />
              ) : (
                <NumericTextField value={qty} onValueChange={setQty} step={0.01} decimal={true} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" required />
              )}
            </label>
            {sellMode === "base" ? (
              <label className="block">
                <span className="text-[0.6875rem] text-muted-foreground">Harga / {humU} (Rp)</span>
                <NumericTextField value={pricePerBase} onValueChange={setPricePerBase} step={1} decimal={false} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" required />
              </label>
            ) : (
              <label className="block">
                <span className="text-[0.6875rem] text-muted-foreground">
                  Harga / {sellMode === "karton" ? "karton" : packageLabelForQty} (Rp)
                </span>
                <NumericTextField value={pricePerPackage} onValueChange={setPricePerPackage} step={1} decimal={false} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" required />
              </label>
            )}
          </div>

          <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />

          <label className="block">
            <span className="text-[0.6875rem] text-muted-foreground">Pelanggan {paymentMethod === "hutang" && <span className="text-destructive">*</span>}</span>
            <select className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Tanpa pelanggan —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__new__">+ Pelanggan baru…</option>
            </select>
          </label>

          {customerId === "__new__" && (
            <div className="grid grid-cols-1 gap-ms-2 rounded-md border border-dashed bg-muted/30 p-ms-2">
              <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="Nama pelanggan baru *" value={newCustName} onChange={(e) => setNewCustName(e.target.value)} maxLength={100} required />
              <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="No. WA / HP (cth: 0812xxxxx)" inputMode="tel" value={newCustWa} onChange={(e) => setNewCustWa(e.target.value)} maxLength={50} />
              <div className="text-[0.6875rem] text-muted-foreground">Pelanggan & nomor WA akan otomatis tersimpan ke daftar pelanggan.</div>
            </div>
          )}

          {customerId && customerId !== "__new__" && (() => {
            const c = customers.find((x) => x.id === customerId);
            if (!c) return null;
            return (
              <div className="rounded-md border border-dashed bg-muted/30 px-ms-2 py-1.5 text-[0.6875rem] text-muted-foreground">
                No. WA pelanggan: {c.contact ? <span className="font-medium text-foreground">📞 {c.contact}</span> : <span className="italic">belum ada — tambahkan di menu Pelanggan</span>}
              </div>
            );
          })()}

          <div>
            <div className="text-[0.6875rem] text-muted-foreground mb-1">Cara bayar</div>
            <div className="flex gap-ms-1 text-ms-xs">
              <button type="button" onClick={() => setPaymentMethod("kas")} className={`flex-1 rounded border px-ms-2 py-1.5 ${paymentMethod === "kas" ? "bg-primary text-primary-foreground border-primary" : ""}`}>💵 Kas (lunas)</button>
              <button type="button" onClick={() => setPaymentMethod("hutang")} className={`flex-1 rounded border px-ms-2 py-1.5 ${paymentMethod === "hutang" ? "bg-warning text-warning-foreground border-warning" : ""}`}>📝 Hutang pelanggan</button>
            </div>
          </div>

          {(() => {
            const kurang = qtyBase > item.stock_base;
            const sisa = item.stock_base - qtyBase;
            const dispMode: "base" | "package" = sellMode === "base" ? "base" : "package";
            return (
              <div className="rounded-md bg-muted/50 p-ms-2 text-[0.6875rem] space-y-0.5">
                <div>
                  Akan kurangi stok: <b>{fmtQtyDual(qtyBase, item.base_unit, item.package_type, item.package_size, dispMode, item.name)}</b>
                </div>
                <div>
                  Stok tersedia: <b>{fmtQtyDual(item.stock_base, item.base_unit, item.package_type, item.package_size, dispMode, item.name)}</b>
                </div>
                <div className={kurang ? "text-destructive font-semibold" : ""}>
                  {kurang
                    ? <>Stok kurang {fmtQtyDual(qtyBase - item.stock_base, item.base_unit, item.package_type, item.package_size, dispMode, item.name)} — tidak bisa disimpan</>
                    : <>Sisa setelah jual: <b>{fmtQtyDual(sisa, item.base_unit, item.package_type, item.package_size, dispMode, item.name)}</b></>}
                </div>
                <div>Total pendapatan: <b>{rupiah(total)}</b> ({paymentMethod === "hutang" ? "piutang ke pelanggan" : "lunas tunai"})</div>
                <div className={profit >= 0 ? "text-success dark:text-success" : "text-destructive"}>
                  Estimasi laba: <b>{rupiah(profit)}</b>
                </div>
              </div>
            );
          })()}

          <button className="w-full rounded-md bg-primary px-ms-3 py-ms-2 text-ms-sm font-semibold text-primary-foreground">Simpan penjualan</button>
        </>
        );
      })()}
    </form>
  );
}

/* ----------------- RIWAYAT ----------------- */
function RiwayatTab({
  purchases, sales, itemMap, supMap, onChanged, totalRevenue, totalCost,
}: {
  purchases: Purchase[]; sales: Sale[];
  itemMap: Record<string, WItem>; supMap: Record<string, Supplier>;
  onChanged: () => void;
  totalRevenue: number; totalCost: number;
}) {
  const [sub, setSub] = useState<"jual" | "beli">("jual");
  async function delPurchase(id: string) {
    if (!(await confirm({
      title: "Hapus pembelian?",
      description: "Stok akan dikurangi sesuai isi pembelian ini.",
      confirmText: "Hapus",
    }))) return;
    const { error } = await supabase.from("purchases").delete().eq("id", id);
    if (error) notifyError(error); else { toast.success("Pembelian dihapus"); onChanged(); }
  }
  async function delSale(id: string) {
    if (!(await confirm({
      title: "Hapus penjualan?",
      description: "Stok akan dikembalikan ke gudang.",
      confirmText: "Hapus",
    }))) return;
    const { error } = await supabase.from("sales").delete().eq("id", id);
    if (error) notifyError(error); else { toast.success("Penjualan dihapus"); onChanged(); }
  }

  return (
    <div className="space-ms-3">
      <div className="grid grid-cols-3 gap-ms-2 text-[0.6875rem]">
        <div className="rounded-md border bg-card p-ms-2">
          <div className="text-muted-foreground">Pendapatan</div>
          <div className="text-ms-sm font-semibold">{rupiah(totalRevenue)}</div>
        </div>
        <div className="rounded-md border bg-card p-ms-2">
          <div className="text-muted-foreground">Modal terjual</div>
          <div className="text-ms-sm font-semibold">{rupiah(totalCost)}</div>
        </div>
        <div className="rounded-md border bg-card p-ms-2">
          <div className="text-muted-foreground">Laba</div>
          <div className={`text-ms-sm font-semibold ${totalRevenue - totalCost >= 0 ? "text-success dark:text-success" : "text-destructive"}`}>
            {rupiah(totalRevenue - totalCost)}
          </div>
        </div>
      </div>

      <div className="flex gap-ms-1 text-ms-xs">
        <button onClick={() => setSub("jual")} className={`flex-1 rounded border px-ms-2 py-1 ${sub === "jual" ? "bg-primary text-primary-foreground border-primary" : ""}`}>Penjualan</button>
        <button onClick={() => setSub("beli")} className={`flex-1 rounded border px-ms-2 py-1 ${sub === "beli" ? "bg-primary text-primary-foreground border-primary" : ""}`}>Pembelian</button>
      </div>

      {sub === "jual" ? (
        sales.length === 0 ? (
          <div className="rounded-lg border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">Belum ada penjualan.</div>
        ) : (
          <ul className="space-ms-2">
            {sales.map((s) => {
              const it = itemMap[s.item_id];
              return (
                <li key={s.id} className="rounded-lg border bg-card p-ms-3 text-ms-xs">
                  <div className="flex items-start justify-between gap-ms-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold" title={it?.name || "(barang dihapus)"}>{it?.name || "(barang dihapus)"}</div>
                      <div className="text-[0.6875rem] text-muted-foreground">
                        {new Date(s.created_at).toLocaleString("id-ID")} {s.note && `· ${s.note}`}
                      </div>
                    </div>
                    <button onClick={() => delSale(s.id)} className="shrink-0 rounded border px-ms-2 py-1 text-[0.6875rem] text-destructive hover:bg-destructive/10">Hapus</button>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-ms-2">
                    <div><span className="text-muted-foreground">Jumlah </span><b>{fmtItemQty(Number(s.qty_base), it)}</b></div>
                    <div><span className="text-muted-foreground">Harga </span><b>{fmtItemPrice(Number(s.price_per_base), it)}</b></div>
                    <div><span className="text-muted-foreground">Total </span><b>{rupiah(Number(s.total_revenue))}</b></div>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        purchases.length === 0 ? (
          <div className="rounded-lg border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">Belum ada pembelian.</div>
        ) : (
          <ul className="space-ms-2">
            {purchases.map((p) => {
              const it = itemMap[p.item_id];
              const sup = p.supplier_id ? supMap[p.supplier_id] : null;
              return (
                <li key={p.id} className="rounded-lg border bg-card p-ms-3 text-ms-xs">
                  <div className="flex items-start justify-between gap-ms-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold" title={it?.name || "(barang dihapus)"}>{it?.name || "(barang dihapus)"}</div>
                      <div className="text-[0.6875rem] text-muted-foreground">
                        {new Date(p.created_at).toLocaleString("id-ID")} · dari {sup?.name || "—"}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-ms-1">
                      <StatusBadge size="xs" variant={p.payment_method === "hutang" ? "hutang" : "lunas"}>
                        {p.payment_method === "hutang" ? "📝 Hutang" : "💵 Kas"}
                      </StatusBadge>
                      <button onClick={() => delPurchase(p.id)} className="rounded border px-ms-2 py-1 text-[0.6875rem] text-destructive hover:bg-destructive/10">Hapus</button>
                    </div>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-ms-2">
                  <div><span className="text-muted-foreground">Kemasan </span><b>{Number(p.package_qty)} × {Number(p.package_size_snapshot)}{it ? humanBaseUnit(it.package_type, it.base_unit) : ""}</b></div>
                    <div><span className="text-muted-foreground">Harga </span><b>{rupiah(Number(p.price_per_package))}</b></div>
                    <div><span className="text-muted-foreground">Total </span><b>{rupiah(Number(p.total_cost))}</b></div>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
}

/* ----------------- HUTANG ----------------- */
function HutangTab({
  purchases, payments, suppliers, itemMap, uid, onChanged, onAddDebt, onLocalPayment, onLocalRemovePayment,
}: {
  purchases: Purchase[];
  payments: Payment[];
  suppliers: Supplier[];
  itemMap: Record<string, WItem>;
  uid: string | null;
  onChanged: () => void;
  onAddDebt: () => void;
  onLocalPayment: (p: Payment) => void;
  onLocalRemovePayment: (id: string) => void;
}) {
  const debts = useMemo(() => purchases.filter((p) => p.payment_method === "hutang"), [purchases]);

  const paidByPurchase = useMemo(() => {
    const m: Record<string, number> = {};
    for (const pay of payments) {
      m[pay.purchase_id] = (m[pay.purchase_id] || 0) + Number(pay.amount);
    }
    return m;
  }, [payments]);

  const paymentsByPurchase = useMemo(() => {
    const m: Record<string, Payment[]> = {};
    for (const pay of payments) {
      (m[pay.purchase_id] ||= []).push(pay);
    }
    return m;
  }, [payments]);

  // Group debts by supplier
  const groups = useMemo(() => {
    const m = new Map<string, { supplier: Supplier | null; debts: Purchase[]; total: number; paid: number; remaining: number }>();
    const supMap = Object.fromEntries(suppliers.map((s) => [s.id, s]));
    for (const d of debts) {
      const key = d.supplier_id || "_none";
      const g = m.get(key) || {
        supplier: d.supplier_id ? supMap[d.supplier_id] || null : null,
        debts: [],
        total: 0, paid: 0, remaining: 0,
      };
      const paid = paidByPurchase[d.id] || 0;
      g.debts.push(d);
      g.total += Number(d.total_cost);
      g.paid += paid;
      g.remaining += Math.max(0, Number(d.total_cost) - paid);
      m.set(key, g);
    }
    return Array.from(m.values()).sort((a, b) => b.remaining - a.remaining);
  }, [debts, suppliers, paidByPurchase]);

  const totals = useMemo(() => {
    let total = 0, paid = 0, remaining = 0;
    for (const d of debts) {
      const p = paidByPurchase[d.id] || 0;
      total += Number(d.total_cost);
      paid += p;
      remaining += Math.max(0, Number(d.total_cost) - p);
    }
    return { total, paid, remaining };
  }, [debts, paidByPurchase]);

  // Sinkron dengan /hutang-piutang: total hutang harus ikut sertakan entri
  // manual dari tabel debts (kind=hutang). Sebelumnya kartu ini hanya
  // menghitung dari purchases.payment_method='hutang' - supplier_payments,
  // sehingga total di sini bisa lebih kecil dari halaman Hutang & Piutang.
  const [hutangSSOT, setHutangSSOT] = useState<HutangSummary | null>(null);
  const [hutangSSOTAt, setHutangSSOTAt] = useState<Date | null>(null);
  const [hutangSSOTLoading, setHutangSSOTLoading] = useState(false);
  const refreshHutangSSOT = useCallback(async () => {
    setHutangSSOTLoading(true);
    try {
      const s = await fetchHutangSummary();
      setHutangSSOT(s);
      setHutangSSOTAt(new Date());
    } finally {
      setHutangSSOTLoading(false);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetchHutangSummary().then((s) => {
      if (!cancelled) {
        setHutangSSOT(s);
        setHutangSSOTAt(new Date());
      }
    });
    return () => { cancelled = true; };
  }, [purchases, payments]);
  // Transaksi hutang/piutang dari layar lain langsung menyegarkan kartu ini.
  useOnDebtTx(useCallback(() => { void refreshHutangSSOT(); }, [refreshHutangSSOT]));
  const totalDisplay = hutangSSOT
    ? hutangSSOT.purchase_hutang_gross + hutangSSOT.manual_gross
    : totals.total;
  const paidDisplay = hutangSSOT
    ? hutangSSOT.purchase_hutang_paid + hutangSSOT.manual_paid
    : totals.paid;
  const remainingDisplay = hutangSSOT ? hutangSSOT.total_outstanding : totals.remaining;

  if (debts.length === 0) {
    return (
      <div className="space-ms-3">
        <button
          onClick={onAddDebt}
          className="w-full rounded-md bg-primary px-ms-3 py-ms-2 text-ms-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          ➕ Tambah hutang (catat pembelian)
        </button>
        {hutangSSOT && remainingDisplay > 0 && (
          <div className="rounded-md border bg-card p-ms-2 text-[0.6875rem]">
            <div className="flex items-start justify-between gap-1">
              <div className="text-muted-foreground">Total hutang (sinkron /hutang-piutang)</div>
              <button
                type="button"
                onClick={refreshHutangSSOT}
                disabled={hutangSSOTLoading}
                className="shrink-0 rounded border px-1.5 py-0.5 text-[0.625rem] hover:bg-muted disabled:opacity-50"
                aria-label="Hitung ulang hutang"
                title="Hitung ulang"
              >
                {hutangSSOTLoading ? "⏳" : "🔄"}
              </button>
            </div>
            <div className="text-ms-sm font-semibold text-warning dark:text-warning">{rupiah(remainingDisplay)}</div>
            <div className="mt-0.5 text-[0.625rem] text-muted-foreground">
              SSOT: <code>hutang_summary_v1</code>
              {hutangSSOTAt && <> · 🕒 {hutangSSOTAt.toLocaleTimeString("id-ID")}</>}
            </div>
            <details className="mt-0.5 text-[0.625rem] text-muted-foreground">
              <summary className="cursor-pointer">Rincian sumber angka</summary>
              <div className="mt-1 space-y-0.5 pl-2">
                <div>Pembelian hutang: {rupiah(hutangSSOT.purchase_hutang_gross)} − dibayar {rupiah(hutangSSOT.purchase_hutang_paid)}</div>
                <div>Manual (<code>debts.kind='hutang'</code>): {rupiah(hutangSSOT.manual_gross)} − dibayar {rupiah(hutangSSOT.manual_paid)}</div>
                <div className="font-medium">= Outstanding: {rupiah(hutangSSOT.total_outstanding)}</div>
              </div>
            </details>
          </div>
        )}
        <div className="rounded-lg border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">
          Tidak ada hutang ke supplier. Pembelian dengan cara bayar <b>Hutang</b> akan muncul di sini.
        </div>
      </div>
    );
  }

  return (
    <div className="space-ms-3">
      <button
        onClick={onAddDebt}
        className="w-full rounded-md bg-primary px-ms-3 py-ms-2 text-ms-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        ➕ Tambah hutang (catat pembelian)
      </button>
      <div className="grid grid-cols-3 gap-ms-2 text-[0.6875rem]">
        <div className="rounded-md border bg-card p-ms-2">
          <div className="flex items-start justify-between gap-1">
            <div className="text-muted-foreground">Total hutang</div>
            <button
              type="button"
              onClick={refreshHutangSSOT}
              disabled={hutangSSOTLoading}
              className="shrink-0 rounded border px-1.5 py-0.5 text-[0.625rem] hover:bg-muted disabled:opacity-50"
              aria-label="Hitung ulang hutang"
              title="Hitung ulang"
            >
              {hutangSSOTLoading ? "⏳" : "🔄"}
            </button>
          </div>
          <div className="text-ms-sm font-semibold">{rupiah(totalDisplay)}</div>
          <div className="mt-0.5 text-[0.625rem] text-muted-foreground">
            SSOT: <code>hutang_summary_v1</code>
            {hutangSSOTAt && <> · 🕒 {hutangSSOTAt.toLocaleTimeString("id-ID")}</>}
          </div>
          {hutangSSOT && (
            <details className="mt-0.5 text-[0.625rem] text-muted-foreground">
              <summary className="cursor-pointer">Rincian</summary>
              <div className="mt-1 space-y-0.5 pl-2">
                <div>Pembelian: {rupiah(hutangSSOT.purchase_hutang_gross)} − dibayar {rupiah(hutangSSOT.purchase_hutang_paid)}</div>
                <div>Manual: {rupiah(hutangSSOT.manual_gross)} − dibayar {rupiah(hutangSSOT.manual_paid)}</div>
                <div className="font-medium">= Sisa: {rupiah(hutangSSOT.total_outstanding)}</div>
              </div>
            </details>
          )}
        </div>
        <div className="rounded-md border bg-card p-ms-2">
          <div className="text-muted-foreground">Sudah dibayar</div>
          <div className="text-ms-sm font-semibold text-success dark:text-success">{rupiah(paidDisplay)}</div>
        </div>
        <div className="rounded-md border bg-card p-ms-2">
          <div className="text-muted-foreground">Sisa</div>
          <div className="text-ms-sm font-semibold text-warning dark:text-warning">{rupiah(remainingDisplay)}</div>
        </div>
      </div>

      {groups.map((g, idx) => (
        <div key={g.supplier?.id || `_none-${idx}`} className="space-ms-2 rounded-lg border bg-card p-ms-3">
          <div className="flex items-center justify-between">
            <div className="text-ms-sm font-semibold">{g.supplier?.name || "(tanpa supplier)"}</div>
            <div className="text-[0.6875rem]">
              Sisa: <span className="font-semibold text-warning dark:text-warning">{rupiah(g.remaining)}</span>
              <span className="text-muted-foreground"> / {rupiah(g.total)}</span>
            </div>
          </div>
          {g.supplier && (
            <ShareDebt
              supplier={g.supplier}
              debts={g.debts}
              paidByPurchase={paidByPurchase}
              itemMap={itemMap}
              total={g.total}
              paid={g.paid}
              remaining={g.remaining}
            />
          )}
          <ul className="space-ms-2">
            {g.debts.map((d) => {
              const it = itemMap[d.item_id];
              const paid = paidByPurchase[d.id] || 0;
              const remaining = Math.max(0, Number(d.total_cost) - paid);
              const isPaid = remaining <= 0;
              return (
                <li key={d.id} className="rounded-md border bg-background p-ms-2 text-ms-xs">
                  <div className="flex items-start justify-between gap-ms-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold" title={it?.name || "(barang dihapus)"}>{it?.name || "(barang dihapus)"}</div>
                      <div className="text-[0.6875rem] text-muted-foreground">
                        {new Date(d.created_at).toLocaleDateString("id-ID")} · {Number(d.package_qty)} × {rupiah(Number(d.price_per_package))}
                      </div>
                    </div>
                    <StatusBadge size="xs" variant={isPaid ? "lunas" : "hutang"}>
                      {isPaid ? "✓ Lunas" : "Hutang"}
                    </StatusBadge>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-ms-2 text-[0.6875rem]">
                    <div><span className="text-muted-foreground">Total </span><b>{rupiah(Number(d.total_cost))}</b></div>
                    <div><span className="text-muted-foreground">Bayar </span><b className="text-success dark:text-success">{rupiah(paid)}</b></div>
                    <div><span className="text-muted-foreground">Sisa </span><b className="text-warning dark:text-warning">{rupiah(remaining)}</b></div>
                  </div>
                  {!isPaid && g.supplier && (
                    <PayForm purchase={d} supplierId={g.supplier.id} remaining={remaining} uid={uid} onChanged={onChanged} onLocalPayment={onLocalPayment} />
                  )}
                  {(paymentsByPurchase[d.id]?.length ?? 0) > 0 && (
                    <ul className="mt-2 space-y-1 border-t pt-1.5">
                      {paymentsByPurchase[d.id]!.map((pay) => (
                        <li key={pay.id} className="flex items-center justify-between gap-ms-2 text-[0.6875rem]">
                          <span className="truncate">
                            {new Date(pay.created_at).toLocaleDateString("id-ID")} ·{" "}
                            <b className="text-success dark:text-success">{rupiah(Number(pay.amount))}</b>
                            {pay.note && <span className="text-muted-foreground"> · {pay.note}</span>}
                          </span>
                          <button
                            onClick={async () => {
                              if (!(await confirm({
                                title: "Hapus pembayaran?",
                                description: "Catatan pembayaran ini akan dihapus permanen.",
                                confirmText: "Hapus",
                              }))) return;
                              onLocalRemovePayment(pay.id);
                              const { error } = await supabase.from("supplier_payments").delete().eq("id", pay.id);
                              if (error) { notifyError(error); onChanged(); }
                              else { toast.success("Pembayaran dihapus"); onChanged(); }
                            }}
                            className="shrink-0 rounded border px-1.5 py-0.5 text-[0.6875rem] text-destructive hover:bg-destructive/10"
                          >
                            Hapus
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PayForm({
  purchase, supplierId, remaining, uid, onChanged, onLocalPayment,
}: {
  purchase: Purchase;
  supplierId: string;
  remaining: number;
  uid: string | null;
  onChanged: () => void;
  onLocalPayment: (p: Payment) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function pay(useAmount: number) {
    if (!uid) return;
    if (!Number.isFinite(useAmount) || useAmount <= 0) {
      toast.error("Nominal pembayaran wajib diisi dan harus lebih dari 0");
      return;
    }
    if (useAmount > remaining + 0.0001) {
      toast.error(`Pembayaran melebihi sisa hutang. Maksimal ${rupiah(remaining)}`);
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.from("supplier_payments").insert({
      user_id: uid,
      supplier_id: supplierId,
      purchase_id: purchase.id,
      amount: useAmount,
      note: note.trim() || null,
    }).select().single();
    setBusy(false);
    if (error) { notifyError(error); return; }
    if (data) onLocalPayment(data as Payment);
    toast.success(useAmount >= remaining ? "Hutang lunas" : "Pembayaran dicatat");
    setAmount(""); setNote("");
    onChanged();
  }

  const raw = amount.trim();
  const parsed = raw === "" ? NaN : Number(raw);
  const isEmpty = raw === "";
  const isInvalid = !isEmpty && (!Number.isFinite(parsed) || parsed <= 0);
  const isOver = Number.isFinite(parsed) && parsed > remaining + 0.0001;
  const errorMsg = isEmpty
    ? null
    : isInvalid
      ? "Nominal harus lebih dari 0"
      : isOver
        ? `Maksimal ${rupiah(remaining)}`
        : null;
  const payDisabled = busy || isEmpty || isInvalid || isOver;

  return (
    <div className="mt-2 space-y-1.5 rounded border border-dashed p-ms-2">
      <div className="flex gap-ms-1.5">
        <NumericTextField value={amount} onValueChange={setAmount} step={1} decimal={false} className={`flex-1 rounded border bg-background px-ms-2 py-1 text-ms-xs ${errorMsg ? "border-destructive" : ""}`} placeholder="Nominal bayar (Rp)" />
        <button
          type="button"
          disabled={payDisabled}
          onClick={() => pay(parsed)}
          className="rounded bg-primary px-ms-2 py-1 text-ms-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          Bayar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => pay(remaining)}
          className="rounded border border-success px-ms-2 py-1 text-ms-xs font-semibold text-success hover:bg-success/10 disabled:opacity-50 dark:text-success"
        >
          Lunas
        </button>
      </div>
      {errorMsg && <div className="text-[0.6875rem] text-destructive">{errorMsg}</div>}
      <input
        type="text"
        placeholder="Catatan (opsional)"
        className="w-full rounded border bg-background px-ms-2 py-1 text-ms-xs"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
      />
    </div>
  );
}
/* ----------------- PESANAN (request preparation) ----------------- */
function PesananTab({
  orders, items, customers, uid, onChanged,
}: {
  orders: OrderRequest[]; items: WItem[]; customers: Customer[];
  uid: string | null; onChanged: () => void;
}) {
  const [itemId, setItemId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [newCustName, setNewCustName] = useState("");
  const [newCustWa, setNewCustWa] = useState("");
  const [qty, setQty] = useState("");
  const [qtyMode, setQtyMode] = useState<"base" | "package" | "karton">("base");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<"aktif" | "semua">("aktif");
  const [pending, setPending] = useState<OrderRequest | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!itemId && items[0]) setItemId(items[0].id);
  }, [items, itemId]);

  const item = items.find((i) => i.id === itemId);
  const qtyN = Number(qty) || 0;
  // Faktor pengali ke base. karton = ×100 botol × isi/botol.
  const qtyFactor = item
    ? qtyMode === "base"
      ? 1
      : qtyMode === "package"
        ? item.package_size
        : BOTOL_PER_KARTON * item.package_size
    : 0;
  const qtyBase = qtyN * qtyFactor;
  const enough = item ? qtyBase <= item.stock_base : false;

  const itemMap = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const custMap = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);
  const visible = orders.filter((o) => filter === "semua" || o.status !== "selesai");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !item) return;
    if (qtyN <= 0) { toast.error("Jumlah harus > 0"); return; }
    if (qtyMode !== "base" && item.package_type === "pcs") {
      toast.error("Barang pcs tidak punya kemasan"); return;
    }
    if (qtyMode === "karton" && item.package_type !== "botol") {
      toast.error("Mode karton hanya untuk barang satuan botol"); return;
    }
    let useCustomerId: string | null = customerId || null;
    if (customerId === "__new__") {
      const nm = newCustName.trim();
      if (!nm) { toast.error("Isi nama pelanggan baru"); return; }
      const wa = newCustWa.trim();
      const { data: nc, error: ncErr } = await supabase
        .from("customers")
        .insert({ user_id: uid, name: nm, contact: wa || null })
        .select("id")
        .single();
      if (ncErr || !nc) { notifyError(ncErr ?? new Error("Gagal simpan pelanggan")); return; }
      useCustomerId = nc.id;
    }
    // Simpan ke skema lama: karton → konversi ke package (botol) ×100.
    const storedMode: "base" | "package" = qtyMode === "base" ? "base" : "package";
    const storedQty = qtyMode === "karton" ? qtyN * BOTOL_PER_KARTON : qtyN;
    const storedPrice = price
      ? qtyMode === "karton"
        ? Number(price) / BOTOL_PER_KARTON
        : Number(price)
      : null;
    const { error } = await supabase.from("order_requests").insert({
      user_id: uid,
      customer_id: useCustomerId,
      item_id: item.id,
      qty: storedQty,
      qty_mode: storedMode,
      price_per_unit: storedPrice,
      note: note.trim() || null,
    });
    if (error) { notifyError(error); return; }
    toast.success("Pesanan ditambahkan");
    setQty(""); setPrice(""); setNote("");
    setNewCustName(""); setNewCustWa("");
    if (customerId === "__new__") setCustomerId("");
    onChanged();
  }

  async function setStatus(id: string, status: OrderRequest["status"], opts: { silent?: boolean } = {}) {
    const { error } = await supabase.from("order_requests").update({ status }).eq("id", id);
    if (error) {
      if (/sudah selesai/i.test(error.message ?? "")) {
        toast.error("Pesanan sudah selesai — status tidak bisa dikembalikan.");
      } else notifyError(error);
      return false;
    }
    if (!opts.silent) toast.success(`Status: ${status}`);
    onChanged();
    return true;
  }

  /** Buka dialog pembayaran; proses sebenarnya lewat RPC atomik. */
  function konversiKePenjualan(o: OrderRequest) {
    if (!uid) return;
    const it = itemMap[o.item_id]; if (!it) return;
    if (o.status === "selesai") {
      toast.error("Pesanan sudah selesai — tidak bisa diproses ulang.");
      return;
    }
    const qBase = o.qty_mode === "base" ? Number(o.qty) : Number(o.qty) * it.package_size;
    if (qBase > it.stock_base) { toast.error("Stok kurang untuk konversi"); return; }
    setPending(o);
  }

  async function confirmProses(method: PaymentMethod, paid: number | null) {
    const o = pending;
    if (!o || processing) return;
    setProcessing(true);
    const res = await processOrder(o.id, method, paid);
    setProcessing(false);
    if (!res.ok) { toast.error(res.message); return; }
    setPending(null);
    toast.success(res.alreadyProcessed
      ? "Pesanan ini sudah diproses sebelumnya."
      : "✅ Pesanan diproses jadi penjualan");
    onChanged();
  }

  async function tandaiSiap(o: OrderRequest) {
    const it = itemMap[o.item_id];
    const qBase = it ? (o.qty_mode === "base" ? Number(o.qty) : Number(o.qty) * it.package_size) : 0;
    const ringkasan = it
      ? `${it.name} — ${fmtItemQty(qBase, it)}${o.price_per_unit != null ? ` × ${rupiah(Number(o.price_per_unit))}/${o.qty_mode === "base" ? humanBaseUnit(it.package_type, it.base_unit) : it.package_type}` : ""}`
      : "pesanan ini";
    const labelPelanggan = o.customer_id ? (custMap[o.customer_id]?.name ?? "pelanggan") : "tanpa pelanggan";
    const pilihan = await confirm({
      title: "Proses jadi penjualan sekarang?",
      description: `${ringkasan}\n\nLanjut → proses jadi PENJUALAN (stok berkurang, status: selesai)\nBatal → hanya tandai siap, jangan proses dulu`,
      confirmText: "Lanjut",
    });
    if (pilihan) {
      konversiKePenjualan(o);
    } else {
      if (
        await confirm({
          title: "Tandai pesanan sebagai SIAP?",
          description: "Pesanan akan ditandai siap tanpa memproses penjualan dan stok belum dikurangi.",
          confirmText: "Tandai SIAP",
        })
      ) {
        const ok = await setStatus(o.id, "siap", { silent: true });
        if (ok) {
          toast.success("📦 Pesanan ditandai siap", {
            description: `${ringkasan}\nPelanggan: ${labelPelanggan}\nStatus: menunggu → siap · Stok belum dikurangi`,
          });
        }
      } else {
        toast("ℹ️ Tidak ada perubahan status", {
          description: `${ringkasan} tetap berstatus "menunggu".`,
        });
      }
    }
  }

  async function hapus(id: string) {
    if (!(await confirm({
      title: "Hapus pesanan?",
      description: "Pesanan ini akan dihapus permanen.",
      confirmText: "Hapus",
    }))) return;
    const { error } = await supabase.from("order_requests").delete().eq("id", id);
    if (error) notifyError(error); else { toast.success("Dihapus"); onChanged(); }
  }

  function fmtQty(o: OrderRequest) {
    const it = itemMap[o.item_id];
    if (!it) return `${o.qty}`;
    if (o.qty_mode === "base") return `${o.qty} ${humanBaseUnit(it.package_type, it.base_unit)}`;
    return `${o.qty} ${it.package_type}${it.package_type !== "pcs" ? ` (≈${Number(o.qty) * it.package_size} ${humanBaseUnit(it.package_type, it.base_unit)})` : ""}`;
  }

  if (items.length === 0) {
    return <div className="rounded-lg border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">Belum ada barang. Tambah di tab <b>Beli</b> dulu.</div>;
  }

  return (
    <div className="space-ms-3">
      <form onSubmit={submit} className="space-ms-3 rounded-lg border bg-card p-ms-3">
        <div className="text-ms-xs font-semibold">📝 Tambah Pesanan</div>

        <label className="block">
          <span className="text-[0.6875rem] text-muted-foreground">Pelanggan (opsional)</span>
          <select className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— Tanpa pelanggan —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__new__">+ Pelanggan baru…</option>
          </select>
        </label>

        {customerId === "__new__" && (
          <div className="grid grid-cols-1 gap-ms-2 rounded-md border border-dashed bg-muted/30 p-ms-2">
            <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="Nama pelanggan baru *" value={newCustName} onChange={(e) => setNewCustName(e.target.value)} maxLength={100} required />
            <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="No. WA / HP (cth: 0812xxxxx)" inputMode="tel" value={newCustWa} onChange={(e) => setNewCustWa(e.target.value)} maxLength={50} />
            <div className="text-[0.6875rem] text-muted-foreground">Pelanggan & nomor WA akan otomatis tersimpan ke daftar pelanggan.</div>
          </div>
        )}

        {customerId && customerId !== "__new__" && (() => {
          const c = customers.find((x) => x.id === customerId);
          if (!c) return null;
          return (
            <div className="rounded-md border border-dashed bg-muted/30 px-ms-2 py-1.5 text-[0.6875rem] text-muted-foreground">
              No. WA pelanggan: {c.contact ? <span className="font-medium text-foreground">📞 {c.contact}</span> : <span className="italic">belum ada — tambahkan di menu Pelanggan</span>}
            </div>
          );
        })()}

        <label className="block">
          <span className="text-[0.6875rem] text-muted-foreground">Barang</span>
          <select className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} · stok {fmtQtyDual(i.stock_base, i.base_unit, i.package_type, i.package_size, i.package_type !== "pcs" ? "package" : "base", i.name)}
              </option>
            ))}
          </select>
        </label>

        {item && (
          <>
            <div className="flex gap-ms-1 text-ms-xs">
              <button type="button" onClick={() => setQtyMode("base")} className={`flex-1 rounded border px-ms-2 py-1 ${qtyMode === "base" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                Per {humanBaseUnit(item.package_type, item.base_unit)}
              </button>
              {item.package_type !== "pcs" && (
                <button type="button" onClick={() => setQtyMode("package")} className={`flex-1 rounded border px-ms-2 py-1 ${qtyMode === "package" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                  Per {item.package_type}
                </button>
              )}
              {item.package_type === "botol" && (
                <button type="button" onClick={() => setQtyMode("karton")} className={`flex-1 rounded border px-ms-2 py-1 ${qtyMode === "karton" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                  Per karton
                </button>
              )}
            </div>
            <div className="text-[0.625rem] text-muted-foreground">
              <KemasanRumusPopover
                packageType={item.package_type}
                packageSize={item.package_size}
                baseUnit={item.base_unit}
                qty={Number(qty) || 0}
                mode={qtyMode}
                testId="pesanan-kemasan-hint-trigger"
              >
                {item.package_type === "botol"
                  ? `ℹ️ 1 karton = ${BOTOL_PER_KARTON} botol`
                  : item.package_type !== "pcs" && Number(item.package_size) > 1
                    ? `ℹ️ 1 ${item.package_type} = ${item.package_size} ${humanBaseUnit(item.package_type, item.base_unit)}`
                    : `ℹ️ Rumus konversi`}
              </KemasanRumusPopover>
              <KemasanKonversiBadge
                packageType={item.package_type}
                packageSize={item.package_size}
                baseUnit={item.base_unit}
                qty={Number(qty) || 0}
                mode={qtyMode}
                testId="pesanan-kemasan-konversi-badge"
              />
            </div>

            <div className="grid grid-cols-2 gap-ms-2">
              <label className="block">
                <span className="text-[0.6875rem] text-muted-foreground">
                  Jumlah ({qtyMode === "base" ? humanBaseUnit(item.package_type, item.base_unit) : qtyMode === "karton" ? "karton" : item.package_type})
                </span>
                {qtyMode === "base" && item.base_unit === "g" ? (
                  <SmartWeightInput
                    value={qty}
                    onChange={setQty}
                    baseUnit="g"
                    className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
                    required
                    min={0.01}
                    ariaLabel="Jumlah pesanan (gram/kg/ons)"
                  />
                ) : (
                  <NumericTextField value={qty} onValueChange={setQty} step={0.01} decimal={true} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" required />
                )}
              </label>
              <label className="block">
                <span className="text-[0.6875rem] text-muted-foreground">
                  Harga / {qtyMode === "base" ? humanBaseUnit(item.package_type, item.base_unit) : qtyMode === "karton" ? "karton" : item.package_type} (opsional)
                </span>
                <NumericTextField value={price} onValueChange={setPrice} step={1} decimal={false} className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" />
              </label>
            </div>

            <input className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" placeholder="Catatan (mis. dijemput sore)" value={note} onChange={(e) => setNote(e.target.value)} />

            <div className={`rounded-md p-ms-2 text-[0.6875rem] space-y-0.5 ${enough ? "bg-muted/50" : "bg-destructive/10 text-destructive"}`}>
              <div>Butuh siapkan: <b>{fmtQtyDual(qtyBase, item.base_unit, item.package_type, item.package_size, qtyMode === "base" ? "base" : "package", item.name)}</b></div>
              <div>Stok tersedia: <b>{fmtQtyDual(item.stock_base, item.base_unit, item.package_type, item.package_size, qtyMode === "base" ? "base" : "package", item.name)}</b></div>
              {!enough && <div className="font-semibold">Kurang {fmtBase(qtyBase - item.stock_base, item.base_unit)}</div>}
            </div>
          </>
        )}

        <button className="w-full rounded-md bg-primary px-ms-3 py-ms-2 text-ms-sm font-semibold text-primary-foreground">Simpan pesanan</button>
      </form>

      <div className="flex gap-ms-1 text-ms-xs">
        <button onClick={() => setFilter("aktif")} className={`flex-1 rounded border px-ms-2 py-1 ${filter === "aktif" ? "bg-primary text-primary-foreground border-primary" : ""}`}>Aktif</button>
        <button onClick={() => setFilter("semua")} className={`flex-1 rounded border px-ms-2 py-1 ${filter === "semua" ? "bg-primary text-primary-foreground border-primary" : ""}`}>Semua</button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">Tidak ada pesanan.</div>
      ) : (
        <ul className="space-ms-2">
          {visible.map((o) => {
            const it = itemMap[o.item_id];
            const cust = o.customer_id ? custMap[o.customer_id] : null;
            return (
              <li key={o.id} className="rounded-lg border bg-card p-ms-3 space-ms-2">
                <div className="flex items-start justify-between gap-ms-2">
                  <div className="min-w-0">
                    <div className="truncate text-ms-sm font-semibold" title={it?.name ?? "?"}>{it?.name ?? "?"}</div>
                    <div className="text-[0.6875rem] text-muted-foreground">
                      {cust?.name ?? "Tanpa pelanggan"} · {new Date(o.created_at).toLocaleString("id-ID")}
                    </div>
                    <div className="mt-1 text-[0.6875rem]">
                      Jumlah: <b>{fmtQty(o)}</b>
                      {o.price_per_unit != null && <> · {rupiah(Number(o.price_per_unit))}/{o.qty_mode === "base" ? (it ? humanBaseUnit(it.package_type, it.base_unit) : "") : it?.package_type}</>}
                    </div>
                    {o.note && <div className="text-[0.6875rem] text-muted-foreground">📌 {o.note}</div>}
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="flex flex-wrap gap-ms-1">
                  {o.status === "menunggu" && (
                    <button onClick={() => tandaiSiap(o)} className="rounded border px-ms-2 py-1 text-[0.6875rem] hover:bg-accent">✅ Tandai Siap</button>
                  )}
                  {o.status === "siap" && (
                    <button onClick={() => setStatus(o.id, "menunggu")} className="rounded border px-ms-2 py-1 text-[0.6875rem] hover:bg-accent">↩️ Batal Siap</button>
                  )}
                  {o.status !== "selesai" && (
                    <button onClick={() => konversiKePenjualan(o)} className="rounded border px-ms-2 py-1 text-[0.6875rem] hover:bg-accent">💰 Jadikan Penjualan</button>
                  )}
                  <Link to="/gudang/pesanan/$id" params={{ id: o.id }} className="ml-auto rounded border px-ms-2 py-1 text-[0.6875rem] hover:bg-accent">🔍 Detail</Link>
                  <button onClick={() => hapus(o.id)} className="rounded border px-ms-2 py-1 text-[0.6875rem] text-destructive hover:bg-destructive/10">Hapus</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {pending && (() => {
        const it = itemMap[pending.item_id];
        const qBase = it ? (pending.qty_mode === "base" ? Number(pending.qty) : Number(pending.qty) * it.package_size) : 0;
        const perBase = pending.price_per_unit != null && it
          ? (pending.qty_mode === "base" ? Number(pending.price_per_unit) : Number(pending.price_per_unit) / it.package_size)
          : 0;
        return (
          <ProcessOrderDialog
            open
            onOpenChange={(v) => { if (!v && !processing) setPending(null); }}
            summary={it ? `${it.name} — ${fmtItemQty(qBase, it)} × ${fmtItemPrice(perBase, it)}` : "Pesanan"}
            total={qBase * perBase}
            busy={processing}
            onConfirm={confirmProses}
          />
        );
      })()}
    </div>
  );
}
