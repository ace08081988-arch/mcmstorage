import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { genPin, genShareToken, publicTaskUrl, signedUrl } from "@/lib/prep";
import { shareToWhatsApp, urlToFile, buildWhatsAppUrl, notifyShareResult, copyText } from "@/lib/share-wa";
import { fmtItemQty } from "@/lib/stock-format";
import { Plus, Trash2, Send, Copy, MessageCircle, Image as ImageIcon, MapPin, ExternalLink, X, Settings2, ShieldCheck, CheckCircle2, AlertTriangle, ShieldAlert, Search, Download, ArrowUpDown, RotateCcw, ListTodo, Clock, PlayCircle, Timer, Flame, CalendarClock, Users, QrCode, BellRing, BellOff } from "lucide-react";
import { confirm as confirmDialog } from "@/lib/confirm";
import { validateVariantWeight, validateVariantLabel } from "@/lib/variant-validation";
import { SiapkanSendiriSection } from "@/components/SiapkanSendiriSection";
import { StaffContactsPanel } from "@/components/StaffContactsPanel";
import { SharePinDialog } from "@/components/tugas/SharePinDialog";
import { TaskQrCode } from "@/components/TaskQrCode";
import { deriveTaskShortStatus, type TaskShortStatus } from "@/lib/prep-status";
import { fetchAddressBook, normalizePhone, type AddressBookRow } from "@/lib/address-book";
import { rememberPin, recallPin, forgetPin } from "@/lib/prep-pin-memo";
import { debounce } from "@/lib/realtime-debounce";
import { NumericTextField } from "@/components/NumericDraftInput";

/**
 * Badge kecil di kartu tugas yang menampilkan PIN dari pengingat lokal
 * (localStorage) di HP pemilik. Default tersembunyi ("PIN ••••") — tap
 * untuk memperlihatkan angka aslinya. Tombol salin muncul saat PIN dibuka
 * agar pemilik bisa mengirim ulang lewat chat tanpa membuka dialog share.
 *
 * Kalau PIN tidak ada di device ini (mis. tugas dibuat dari HP lain),
 * badge memberi tahu supaya pemilik tahu perlu reset PIN dari tombol
 * bagikan (💬) untuk mengaktifkan PIN baru.
 */
function TaskPinMemo({ shareToken }: { shareToken: string }) {
  const [reveal, setReveal] = useState(false);
  const pin = useMemo(() => recallPin(shareToken), [shareToken, reveal]);
  if (!pin) {
    return (
      <div className="mt-1.5 inline-flex items-center gap-ms-1 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-ms-2 py-0.5 text-ms-2xs text-muted-foreground">
        <ShieldAlert className="h-3 w-3" />
        PIN tidak tercatat di HP ini
      </div>
    );
  }
  return (
    <div className="mt-1.5 inline-flex items-center gap-ms-1 rounded-md border border-primary/30 bg-primary/5 px-ms-2 py-0.5 text-ms-2xs font-medium text-primary">
      <ShieldCheck className="h-3 w-3" />
      <span className="text-muted-foreground">PIN</span>
      <button
        type="button"
        onClick={() => setReveal((v) => !v)}
        className="tabular-nums font-semibold tracking-wide"
        aria-label={reveal ? "Sembunyikan PIN" : "Tampilkan PIN"}
        title={reveal ? "Klik untuk sembunyikan" : "Klik untuk tampilkan"}
      >
        {reveal ? pin : "•".repeat(pin.length)}
      </button>
      {reveal && (
        <button
          type="button"
          onClick={() => { void copyText(pin); toast.success("PIN disalin"); }}
          className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-primary/10"
          aria-label="Salin PIN"
          title="Salin PIN"
        >
          <Copy className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/tugas")({
  head: () => ({
    meta: [
      { title: "Penyiapan Produk · MCM Storage" },
      { name: "description", content: "Siapkan produk sendiri atau lewat pegawai dengan link & PIN." },
    ],
  }),
  component: TugasPage,
});

type WItem = {
  id: string; name: string; category: string | null; image_path: string | null; stock_base: number;
  base_unit?: "g" | "pcs" | null; package_type?: string | null; package_size?: number | null;
};
type Variant = { id: string; warehouse_item_id: string; label: string; weight_per_unit: number; unit_label: string | null; position: number };
type CatVariant = { id: string; category: string; label: string; weight_per_unit: number; unit_label: string | null; position: number };
type Task = { id: string; title: string; note: string | null; share_token: string; status: string; expires_at: string; created_at: string; pin_updated_at?: string | null; completed_at?: string | null; completion_note?: string | null };
type TaskItem = { id: string; task_id: string; name_snapshot: string; category_snapshot: string | null; qty_requested: number; qty_prepared: number; unit_label: string | null; ref_photo_path: string | null; warehouse_item_id: string | null };
type Submission = { id: string; task_id: string; task_item_id: string; photo_path: string | null; location_url: string | null; note: string | null; submitted_at: string };
type PinAlert = { id: string; task_id: string; share_token: string; failure_count: number; window_start: string; window_end: string; created_at: string };

// H5: gunakan SSOT `deriveTaskShortStatus` dari `@/lib/prep-status` yang
// juga memperhitungkan `verification_status` supaya kartu tugas tidak
// tampil "Selesai" saat submisi masih pending review admin.
function deriveTaskStatus(
  rawStatus: string,
  p: { items: number; submitted: number; approved: number },
): TaskShortStatus {
  return deriveTaskShortStatus(rawStatus, p);
}

type TugasChipTone = "primary" | "info" | "success" | "warning" | "danger";

function TugasSummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: TugasChipTone;
}) {
  const map: Record<TugasChipTone, string> = {
    primary: "text-primary bg-primary/10 ring-primary/20",
    info: "text-sky-600 bg-sky-500/10 ring-sky-500/20 dark:text-sky-400",
    success: "text-success bg-success/10 ring-success/20 dark:text-success",
    warning: "text-warning bg-warning/10 ring-warning/20 dark:text-warning",
    danger: "text-destructive bg-destructive/10 ring-destructive/20",
  };
  return (
    <div className="group relative overflow-hidden rounded-xl border bg-card/70 p-ms-3 shadow-sm backdrop-blur transition-all hover:shadow-md md:p-ms-4">
      <div className="flex items-start justify-between gap-ms-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground md:text-ms-2xs">
            {label}
          </p>
          <p className="mt-1 text-ms-xl font-bold tabular-nums tracking-tight md:text-ms-2xl">
            {value.toLocaleString("id-ID")}
          </p>
        </div>
        <span
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${map[tone]} md:h-9 md:w-9`}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

// Kunci sessionStorage untuk membuat draf dialog "Buat tugas baru" tahan
// reload (chunk-load recovery, auto-lock, rebuild preview, dst).
const CREATE_OPEN_KEY = "mcm:tugas-baru:open";
const CREATE_DRAFT_KEY = "mcm:tugas-baru:draft";
type CreateDraft = {
  title: string;
  note: string;
  pin: string;
  phone: string;
  picked: Record<string, PickedEntry>;
};
function readCreateDraft(): Partial<CreateDraft> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CREATE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}
function writeCreateDraft(d: CreateDraft) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify(d)); }
  catch { /* ignore quota */ }
}
function clearCreateDraft() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CREATE_DRAFT_KEY);
    window.sessionStorage.removeItem(CREATE_OPEN_KEY);
  } catch { /* ignore */ }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function TokenStatusPanel({ tasks, loaded }: { tasks: Task[]; loaded: boolean }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "valid" | "expired" | "revoked">("all");
  const now = Date.now();

  type Row = {
    task: Task;
    expiresMs: number;
    isExpired: boolean;
    isRevoked: boolean;
    isValid: boolean;
    pinChanged: boolean;
  };

  const rows: Row[] = useMemo(() => {
    return tasks.map((t) => {
      const expiresMs = t.expires_at ? new Date(t.expires_at).getTime() : 0;
      const isExpired = expiresMs > 0 && expiresMs < now;
      // Enum status di DB (constraint prep_tasks_status_check):
      // 'active' | 'done' | 'cancelled' | 'expired'. Jangan pakai label lama
      // 'revoked' / 'canceled' / 'completed' — tidak akan pernah cocok.
      const isRevoked = t.status === "cancelled" || t.status === "done";
      const isValid = !isExpired && t.status === "active";
      const createdMs = new Date(t.created_at).getTime();
      const pinMs = t.pin_updated_at ? new Date(t.pin_updated_at).getTime() : createdMs;
      const pinChanged = pinMs - createdMs > 2000; // >2s dianggap perubahan nyata
      return { task: t, expiresMs, isExpired, isRevoked, isValid, pinChanged };
    });
  }, [tasks, now]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "valid" && !r.isValid) return false;
      if (filter === "expired" && !r.isExpired) return false;
      if (filter === "revoked" && !r.isRevoked) return false;
      if (!ql) return true;
      return (
        r.task.title.toLowerCase().includes(ql) ||
        r.task.share_token.toLowerCase().includes(ql)
      );
    }).sort((a, b) => new Date(b.task.created_at).getTime() - new Date(a.task.created_at).getTime());
  }, [rows, q, filter]);

  const counts = useMemo(() => {
    let valid = 0, expired = 0, revoked = 0;
    for (const r of rows) {
      if (r.isRevoked) revoked++;
      else if (r.isExpired) expired++;
      else if (r.isValid) valid++;
    }
    return { valid, expired, revoked, total: rows.length };
  }, [rows]);

  function fmtRelative(iso: string | null | undefined): string {
    if (!iso) return "—";
    const ms = new Date(iso).getTime();
    const diff = ms - Date.now();
    const abs = Math.abs(diff);
    const min = Math.round(abs / 60000);
    const hr = Math.round(abs / 3600000);
    const day = Math.round(abs / 86400000);
    const label = day >= 1 ? `${day} hari` : hr >= 1 ? `${hr} jam` : `${min} menit`;
    return diff >= 0 ? `dalam ${label}` : `${label} lalu`;
  }

  return (
    <section aria-labelledby="token-status-heading" className="mt-4 rounded-2xl border bg-card p-ms-4 shadow-sm sm:p-ms-5">
      <div className="flex flex-wrap items-start justify-between gap-ms-2">
        <div className="min-w-0">
          <div className="mb-1 inline-flex items-center gap-ms-1.5 rounded-full border bg-background/70 px-ms-2.5 py-0.5 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-primary" /> Admin
          </div>
          <h2 id="token-status-heading" className="flex items-center gap-ms-2 text-ms-base font-bold tracking-tight sm:text-ms-lg">
            <ShieldAlert className="h-5 w-5 text-primary" /> Status Token & PIN Pegawai
          </h2>
          <p className="mt-0.5 max-w-xl text-ms-2xs leading-snug text-muted-foreground">
            Cek keabsahan link share pegawai + kapan PIN terakhir diubah. Token dianggap valid selama belum kedaluwarsa dan status tugas belum dicabut/selesai.
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-ms-2 sm:grid-cols-4">
        <div className="rounded-lg border bg-background p-ms-2 text-center">
          <div className="text-ms-2xs uppercase tracking-wide text-muted-foreground">Total</div>
          <div className="text-ms-lg font-bold tabular-nums">{counts.total}</div>
        </div>
        <div className="rounded-lg border border-success/40 bg-success/5 p-ms-2 text-center">
          <div className="text-ms-2xs uppercase tracking-wide text-success dark:text-success">Valid</div>
          <div className="text-ms-lg font-bold tabular-nums text-success dark:text-success">{counts.valid}</div>
        </div>
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-ms-2 text-center">
          <div className="text-ms-2xs uppercase tracking-wide text-warning dark:text-warning">Kedaluwarsa</div>
          <div className="text-ms-lg font-bold tabular-nums text-warning dark:text-warning">{counts.expired}</div>
        </div>
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-ms-2 text-center">
          <div className="text-ms-2xs uppercase tracking-wide text-destructive">Dicabut/Selesai</div>
          <div className="text-ms-lg font-bold tabular-nums text-destructive">{counts.revoked}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-ms-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari judul tugas atau token…"
            className="h-9 w-full rounded-md border bg-background pl-7 pr-2 text-ms-xs shadow-sm outline-none focus:border-primary"
            aria-label="Cari status token"
          />
        </div>
        <div role="tablist" aria-label="Filter status" className="inline-flex rounded-md border bg-background p-ms-1 text-ms-2xs shadow-sm">
          {([
            { k: "all", label: "Semua" },
            { k: "valid", label: "Valid" },
            { k: "expired", label: "Kedaluwarsa" },
            { k: "revoked", label: "Dicabut" },
          ] as const).map((o) => (
            <button
              key={o.k}
              role="tab"
              aria-selected={filter === o.k}
              onClick={() => setFilter(o.k)}
              className={`rounded px-ms-2 py-1 font-semibold transition ${filter === o.k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
            >{o.label}</button>
          ))}
        </div>
      </div>

      {!loaded ? (
        <div className="mt-4 rounded-md border border-dashed p-ms-6 text-center text-ms-xs text-muted-foreground">Memuat…</div>
      ) : filtered.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed p-ms-6 text-center text-ms-xs text-muted-foreground">
          {rows.length === 0 ? "Belum ada tugas pegawai." : "Tidak ada tugas yang cocok dengan filter."}
        </div>
      ) : (
        <ul className="mt-3 space-ms-2">
          {filtered.map((r) => {
            const t = r.task;
            const statusLabel = r.isRevoked
              ? (t.status === "done" ? "Selesai" : "Dicabut")
              : r.isExpired ? "Kedaluwarsa" : "Valid";
            const statusClass = r.isValid
              ? "border-success/40 bg-success/10 text-success dark:text-success"
              : r.isExpired
                ? "border-warning/40 bg-warning/10 text-warning dark:text-warning"
                : "border-destructive/40 bg-destructive/10 text-destructive";
            return (
              <li key={t.id} className="rounded-lg border bg-background p-ms-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-ms-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-ms-1.5">
                      <div className="truncate text-ms-sm font-semibold" title={t.title}>{t.title}</div>
                      <span className={`inline-flex shrink-0 items-center gap-ms-1 rounded-full border px-1.5 py-0.5 text-ms-2xs font-semibold ${statusClass}`}>
                        {r.isValid ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {statusLabel}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-ms-2xs text-muted-foreground break-all">
                      token: {t.share_token}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void copyText(t.share_token); toast.success("Token disalin"); }}
                    className="inline-flex h-7 shrink-0 items-center gap-ms-1 rounded-md border bg-background px-ms-2 text-ms-2xs font-semibold hover:bg-accent"
                    aria-label="Salin token"
                  >
                    <Copy className="h-3 w-3" /> Salin
                  </button>
                </div>

                <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1.5 text-ms-2xs sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Dibuat</dt>
                    <dd className="font-medium tabular-nums">{fmtDateTime(t.created_at)}</dd>
                    <dd className="text-ms-2xs text-muted-foreground">{fmtRelative(t.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Kedaluwarsa</dt>
                    <dd className={`font-medium tabular-nums ${r.isExpired ? "text-warning dark:text-warning" : ""}`}>{fmtDateTime(t.expires_at)}</dd>
                    <dd className="text-ms-2xs text-muted-foreground">{fmtRelative(t.expires_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">PIN diubah</dt>
                    <dd className="font-medium tabular-nums">{fmtDateTime(t.pin_updated_at ?? t.created_at)}</dd>
                    <dd className="text-ms-2xs text-muted-foreground">
                      {r.pinChanged ? `${fmtRelative(t.pin_updated_at)} (setelah dibuat)` : "Belum pernah diubah"}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TugasPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [mode, setMode] = useState<"self" | "staff" | "tokens">("self");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [warehouse, setWarehouse] = useState<WItem[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [catVariants, setCatVariants] = useState<CatVariant[]>([]);
  // Slice 2: master kategori dari `warehouse_categories` (SSOT dengan Beranda).
  const [masterCategories, setMasterCategories] = useState<string[]>([]);
  const [openCreate, setOpenCreate] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(CREATE_OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  // Persist openCreate agar reload tak sengaja (chunk error, auto-lock,
  // rebuild preview) tidak menutup dialog di tengah kerja.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (openCreate) window.sessionStorage.setItem(CREATE_OPEN_KEY, "1");
      else window.sessionStorage.removeItem(CREATE_OPEN_KEY);
    } catch { /* ignore */ }
  }, [openCreate]);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [createdInfo, setCreatedInfo] = useState<{ token: string; pin: string; title: string } | null>(null);
  const [openVariantsHub, setOpenVariantsHub] = useState(false);
  const [manageCategoryFor, setManageCategoryFor] = useState<string | null>(null);
  const [openAudit, setOpenAudit] = useState(false);
  const [pinAlerts, setPinAlerts] = useState<PinAlert[]>([]);
  const [sharePinFor, setSharePinFor] = useState<Task | null>(null);
  const [qrFor, setQrFor] = useState<Task | null>(null);
  const [progress, setProgress] = useState<Record<string, { items: number; submitted: number; approved: number }>>({});
  // Ringkasan notifikasi WA per tugas: berapa kali sukses/gagal terkirim
  // dan kapan upaya terakhir. Diambil dari `prep_task_wa_hook_log` (RLS:
  // owner_user_id = auth.uid()) supaya owner bisa lihat langsung di kartu
  // tugas tanpa buka halaman pengaturan.
  const [notifStats, setNotifStats] = useState<
    Record<string, { sent: number; failed: number; lastAt: string | null; lastStatus: "sent" | "failed" | null }>
  >({});
  const [statusFilter, setStatusFilter] = useState<"all" | "waiting" | "progress" | "done">("all");
  const [taskSearch, setTaskSearch] = useState("");
  const [tasksLoaded, setTasksLoaded] = useState(false);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null)); }, []);

  async function load() {
    if (!uid) return;
    const [{ data: t }, { data: w }, { data: v }, { data: cv }, { data: ti }, { data: sb }, { data: mc }] = await Promise.all([
      supabase.from("prep_tasks").select("*").order("created_at", { ascending: false }),
      supabase.from("warehouse_items").select("id,name,category,image_path,stock_base,base_unit,package_type,package_size").order("name"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)("warehouse_item_variants").select("*").order("position"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)("warehouse_category_variants").select("*").order("position"),
      supabase.from("prep_task_items").select("id,task_id"),
      supabase.from("prep_submissions").select("task_id,task_item_id,verification_status"),
      supabase
        .from("warehouse_categories")
        .select("name, position")
        .order("position", { ascending: true })
        .order("name", { ascending: true }),
    ]);
    setTasks((t ?? []) as Task[]);
    setWarehouse((w ?? []) as WItem[]);
    setVariants((v ?? []) as Variant[]);
    setCatVariants((cv ?? []) as CatVariant[]);
    setMasterCategories(((mc ?? []) as { name: string }[]).map((r) => r.name));
    const itemsByTask: Record<string, number> = {};
    for (const row of (ti ?? []) as { task_id: string }[]) {
      itemsByTask[row.task_id] = (itemsByTask[row.task_id] ?? 0) + 1;
    }
    const submittedByTask: Record<string, Set<string>> = {};
    const approvedByTask: Record<string, Set<string>> = {};
    for (const row of (sb ?? []) as { task_id: string; task_item_id: string; verification_status: string | null }[]) {
      const set = submittedByTask[row.task_id] ?? new Set<string>();
      set.add(row.task_item_id);
      submittedByTask[row.task_id] = set;
      if (row.verification_status === 'approved') {
        const a = approvedByTask[row.task_id] ?? new Set<string>();
        a.add(row.task_item_id);
        approvedByTask[row.task_id] = a;
      }
    }
    const prog: Record<string, { items: number; submitted: number; approved: number }> = {};
    for (const id of new Set([...Object.keys(itemsByTask), ...Object.keys(submittedByTask)])) {
      prog[id] = {
        items: itemsByTask[id] ?? 0,
        submitted: submittedByTask[id]?.size ?? 0,
        approved: approvedByTask[id]?.size ?? 0,
      };
    }
    setProgress(prog);
    setTasksLoaded(true);

    // Aggregasi log notifikasi WA per tugas. Ambil 500 baris terbaru —
    // cukup untuk beberapa minggu terakhir, dan client-side aggregation
    // tetap ringan.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: nl } = await (supabase.from as any)("prep_task_wa_hook_log")
      .select("task_id,send_status,created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    const ns: Record<string, { sent: number; failed: number; lastAt: string | null; lastStatus: "sent" | "failed" | null }> = {};
    for (const row of ((nl ?? []) as Array<{ task_id: string; send_status: string | null; created_at: string }>)) {
      const bucket = ns[row.task_id] ?? { sent: 0, failed: 0, lastAt: null as string | null, lastStatus: null as "sent" | "failed" | null };
      const st = row.send_status === "sent" ? "sent" : "failed";
      if (st === "sent") bucket.sent += 1; else bucket.failed += 1;
      if (!bucket.lastAt || new Date(row.created_at) > new Date(bucket.lastAt)) {
        bucket.lastAt = row.created_at;
        bucket.lastStatus = st;
      }
      ns[row.task_id] = bucket;
    }
    setNotifStats(ns);
  }
  useEffect(() => { void load(); }, [uid]);

  // Realtime: sinkronkan perubahan tugas (token diperpanjang, expires_at
  // diperbarui, status berubah, atau tugas dihapus) dari halaman lain
  // (mis. Link Pegawai) tanpa perlu refresh manual.
  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel("prep_tasks-tugas")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prep_tasks" },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            const next = payload.new as Task;
            setTasks((prev) => {
              const before = prev.find((t) => t.id === next.id);
              if (before && before.status !== next.status) {
                try {
                  const raw = localStorage.getItem("mcm.notif.prefs.v1");
                  const prefs = raw ? JSON.parse(raw) : null;
                  const kindOn = prefs?.enabledKinds?.tugas !== false;
                  const toastOn = prefs?.channels?.tugas?.toast !== false;
                  if (kindOn && toastOn) {
                    const title = next.title || "Tugas";
                    if (next.status === "done") {
                      toast.success(`Tugas selesai: ${title}`, {
                        description: next.completion_note || "Status berubah menjadi Selesai.",
                      });
                    } else if (next.status === "cancelled") {
                      toast.error(`Tugas dibatalkan/gagal: ${title}`, {
                        description: next.completion_note || "Status berubah menjadi Dicabut.",
                      });
                    } else if (before.status !== "active" && next.status === "active") {
                      toast.info(`Tugas aktif kembali: ${title}`);
                    }
                  }
                } catch { /* ignore */ }
              }
              return prev.map((t) => (t.id === next.id ? { ...t, ...next } : t));
            });
          } else if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id?: string })?.id;
            if (!oldId) return;
            setTasks((prev) => prev.filter((t) => t.id !== oldId));
          } else if (payload.eventType === "INSERT") {
            const next = payload.new as Task;
            setTasks((prev) => (prev.some((t) => t.id === next.id) ? prev : [next, ...prev]));
          }
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [uid]);

  // Realtime: refresh progres saat pegawai mengirim/menghapus submission
  // atau ketika daftar item tugas berubah.
  useEffect(() => {
    if (!uid) return;
    // Debounce 400ms untuk daftar prep — burst insert dari worker jangan
    // memicu re-load per event.
    const reload = debounce(() => { void load(); }, 400);
    const ch = supabase
      .channel("prep_progress-tugas")
      .on("postgres_changes", { event: "*", schema: "public", table: "prep_submissions" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "prep_task_items" }, reload)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "prep_task_wa_hook_log" }, reload)
      .subscribe();
    return () => { reload.cancel(); void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  async function loadPinAlerts() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from as any)("prep_pin_alerts")
      .select("id,task_id,share_token,failure_count,window_start,window_end,created_at")
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false });
    setPinAlerts((data ?? []) as PinAlert[]);
  }
  // L2: ganti polling 30 detik dengan realtime subscription pada
  // `prep_pin_alerts` (tabel sudah masuk publication `supabase_realtime`).
  // Fallback: refresh sekali saat tab kembali visible agar tetap
  // konsisten walau koneksi realtime sempat terputus.
  useEffect(() => {
    if (!uid) return;
    void loadPinAlerts();
    const ch = supabase
      .channel("prep_pin_alerts-tugas")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prep_pin_alerts", filter: `owner_user_id=eq.${uid}` },
        () => { void loadPinAlerts(); },
      )
      .subscribe();
    const onVis = () => {
      if (document.visibilityState === "visible") void loadPinAlerts();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  async function ackPinAlert(alertId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("prep_pin_alerts")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", alertId);
    if (error) return toast.error(error.message);
    setPinAlerts((prev) => prev.filter((a) => a.id !== alertId));
    toast.success("Peringatan ditandai sudah ditangani");
  }

  async function resetPinAttempts(token: string, title: string) {
    const ok = await confirmDialog({
      title: "Reset percobaan PIN?",
      description: `Hitungan percobaan PIN salah untuk tugas “${title}” akan dihapus dan pegawai bisa langsung mencoba PIN lagi.`,
      confirmText: "Reset percobaan",
    });
    if (!ok) return;
    const loadingId = toast.loading(`Mereset percobaan PIN untuk “${title}”…`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("prep_pin_reset", { _token: token });
    if (error) {
      toast.error("Gagal me-reset percobaan PIN", {
        id: loadingId,
        description: `Alasan: ${error.message}`,
      });
      return;
    }
    const res = data as { ok: boolean; error?: string; deleted_failures?: number; acknowledged_alerts?: number };
    if (!res?.ok) {
      const reasonMap: Record<string, string> = {
        forbidden: "Hanya pemilik tugas atau admin yang boleh me-reset percobaan PIN.",
        not_found: "Tugas tidak ditemukan atau sudah dihapus.",
        unauthenticated: "Sesi Anda berakhir. Silakan login ulang.",
      };
      const reason = reasonMap[res?.error ?? ""] ?? `Server menolak permintaan (${res?.error ?? "unknown"}).`;
      toast.error(`Gagal me-reset percobaan PIN untuk “${title}”`, {
        id: loadingId,
        description: `Alasan: ${reason}`,
      });
      return;
    }
    setPinAlerts((prev) => prev.filter((a) => a.share_token !== token));
    const dF = res.deleted_failures ?? 0;
    const aA = res.acknowledged_alerts ?? 0;
    const parts: string[] = [];
    parts.push(dF > 0 ? `${dF} catatan kegagalan dihapus` : "Tidak ada catatan kegagalan tersisa");
    if (aA > 0) parts.push(`${aA} peringatan ditandai sudah ditangani`);
    parts.push("Pegawai bisa langsung mencoba PIN lagi.");
    toast.success(`Reset percobaan PIN berhasil — “${title}”`, {
      id: loadingId,
      description: parts.join(" · "),
    });
  }

  async function removeTask(id: string) {
    if (!confirm("Hapus tugas ini? Semua foto kiriman juga ikut terhapus.")) return;
    const target = tasks.find((x) => x.id === id);
    const { error } = await supabase.from("prep_tasks").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (target?.share_token) forgetPin(target.share_token);
    toast.success("Tugas dihapus"); void load();
  }

  // Gabungkan varian per-produk + preset per-kategori → entri varian per item.
  const effectiveVariants = useMemo<Variant[]>(() => {
    const itemLevel = variants;
    const synthesized: Variant[] = [];
    const byCat = new Map<string, CatVariant[]>();
    for (const cv of catVariants) {
      const arr = byCat.get(cv.category) ?? [];
      arr.push(cv); byCat.set(cv.category, arr);
    }
    for (const it of warehouse) {
      const cat = (it.category ?? "").trim();
      if (!cat) continue;
      const presets = byCat.get(cat); if (!presets) continue;
      // skip presets yg labelnya sudah dioverride di item-level
      const overridden = new Set(itemLevel.filter((v) => v.warehouse_item_id === it.id).map((v) => v.label.toLowerCase()));
      for (const cv of presets) {
        if (overridden.has(cv.label.toLowerCase())) continue;
        synthesized.push({
          id: `cat:${cv.id}:${it.id}`,
          warehouse_item_id: it.id,
          label: cv.label,
          weight_per_unit: Number(cv.weight_per_unit),
          unit_label: cv.unit_label,
          position: 1000 + cv.position,
        });
      }
    }
    return [...itemLevel, ...synthesized].sort((a, b) => a.position - b.position);
  }, [variants, catVariants, warehouse]);

  return (
    <div className="mx-auto max-w-4xl px-ms-3 py-ms-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-ms-2">
        <div className="min-w-0">
          <h1 className="flex items-center gap-ms-2 text-ms-lg font-bold tracking-tight sm:text-ms-xl">
            <ListTodo className="h-5 w-5 text-primary" /> Penyiapan Produk
          </h1>
          <p className="text-ms-2xs text-muted-foreground">Pilih cara menyiapkan: kerjakan sendiri, atau kirim tugas ke pegawai.</p>
        </div>
      </div>
      <div role="tablist" aria-label="Mode penyiapan" className="mb-3 inline-flex rounded-lg border bg-card p-ms-1 text-ms-xs shadow-sm">
        <button
          role="tab"
          aria-selected={mode === "self"}
          onClick={() => setMode("self")}
          className={`rounded-md px-ms-3 py-1.5 font-semibold transition ${mode === "self" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
        >Siapkan Sendiri</button>
        <button
          role="tab"
          aria-selected={mode === "staff"}
          onClick={() => setMode("staff")}
          className={`rounded-md px-ms-3 py-1.5 font-semibold transition ${mode === "staff" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
        >Via Pegawai</button>
        <button
          role="tab"
          aria-selected={mode === "tokens"}
          onClick={() => setMode("tokens")}
          className={`rounded-md px-ms-3 py-1.5 font-semibold transition ${mode === "tokens" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
        >Status Token & PIN</button>
      </div>

      {mode === "self" ? (
        <SiapkanSendiriSection uid={uid} />
      ) : mode === "tokens" ? (
        <TokenStatusPanel tasks={tasks} loaded={tasksLoaded} />
      ) : (
        ViaPegawaiBlock()
      )}
    </div>
  );

  function ViaPegawaiBlock() {
    const now = Date.now();
    const counts = { all: tasks.length, waiting: 0, progress: 0, done: 0, overdue: 0 };
    for (const t of tasks) {
      const p = progress[t.id] ?? { items: 0, submitted: 0, approved: 0 };
      const s = deriveTaskStatus(t.status, p);
      if (s === "Selesai") counts.done++;
      else if (s === "Dikerjakan") counts.progress++;
      else counts.waiting++;
      if (s !== "Selesai" && t.expires_at && new Date(t.expires_at).getTime() < now) counts.overdue++;
    }
    const q = taskSearch.trim().toLowerCase();
    return (
      <>
      <StaffContactsPanel uid={uid} />

      <section aria-labelledby="tugas-pegawai-heading" className="mt-4 rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-ms-4 shadow-sm sm:p-ms-5">
        <div className="flex flex-wrap items-start justify-between gap-ms-2">
          <div className="min-w-0">
            <div className="mb-1 inline-flex items-center gap-ms-1.5 rounded-full border bg-background/70 px-ms-2.5 py-0.5 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
              <Users className="h-3 w-3 text-primary" /> Tugas Pegawai
            </div>
            <h2 id="tugas-pegawai-heading" className="flex items-center gap-ms-2 text-ms-base font-bold tracking-tight sm:text-ms-lg">
              <ListTodo className="h-5 w-5 text-primary" /> Tugas untuk Pegawai
            </h2>
            <p className="mt-0.5 max-w-xl text-ms-2xs leading-snug text-muted-foreground">
              Pilih barang yang perlu disiapkan pegawai, kirim link + PIN via MCM. Foto & lokasi otomatis muncul di sini.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-ms-2">
            <button onClick={() => setOpenVariantsHub(true)} className="inline-flex h-9 items-center gap-ms-1 rounded-md border bg-background/70 px-ms-3 text-ms-xs font-semibold backdrop-blur hover:bg-accent" aria-label="Kelola varian">
              <Settings2 className="h-4 w-4" /> <span className="hidden sm:inline">Kelola Varian</span>
            </button>
            <button onClick={() => setOpenAudit(true)} className="inline-flex h-9 items-center gap-ms-1 rounded-md border bg-background/70 px-ms-3 text-ms-xs font-semibold backdrop-blur hover:bg-accent" aria-label="Revalidasi tugas">
              <ShieldCheck className="h-4 w-4" /> <span className="hidden sm:inline">Revalidasi</span>
            </button>
            <button onClick={() => setOpenCreate(true)} className="inline-flex h-9 items-center gap-ms-1 rounded-md bg-primary px-ms-3 text-ms-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90">
              <Plus className="h-4 w-4" /> Buat tugas
            </button>
          </div>
        </div>
      </section>

      {/* Summary cards */}
      <section aria-label="Ringkasan tugas" className="mt-3 grid grid-cols-2 gap-ms-2.5 sm:grid-cols-3 md:grid-cols-5">
        <TugasSummaryCard icon={ListTodo} label="Total" value={counts.all} tone="primary" />
        <TugasSummaryCard icon={Clock} label="Menunggu" value={counts.waiting} tone="warning" />
        <TugasSummaryCard icon={PlayCircle} label="Dikerjakan" value={counts.progress} tone="info" />
        <TugasSummaryCard icon={CheckCircle2} label="Selesai" value={counts.done} tone="success" />
        <TugasSummaryCard icon={AlertTriangle} label="Terlambat" value={counts.overdue} tone="danger" />
      </section>

      {/* Search + filter chips */}
      <div className="mt-3 flex flex-wrap items-center gap-ms-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Cari tugas</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={taskSearch}
            onChange={(e) => setTaskSearch(e.target.value)}
            placeholder="Cari judul tugas / catatan…"
            className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-ms-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>

      {pinAlerts.length > 0 && (
        <div className="mt-3 space-ms-2">
          {pinAlerts.map((a) => {
            const task = tasks.find((t) => t.id === a.task_id);
            const minutes = Math.max(
              1,
              Math.round((new Date(a.window_end).getTime() - new Date(a.window_start).getTime()) / 60000),
            );
            return (
              <div key={a.id} className="flex items-start gap-ms-2 rounded-lg border border-destructive/40 bg-destructive/5 p-ms-3 text-ms-xs">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-destructive">Lonjakan PIN gagal terdeteksi</div>
                  <div className="mt-0.5 text-foreground">
                    <b>{a.failure_count}× percobaan salah</b> dalam ~{minutes} menit pada tugas <b>“{task?.title ?? a.share_token}”</b>.
                  </div>
                  <div className="mt-0.5 text-ms-2xs text-muted-foreground">Terakhir: {new Date(a.window_end).toLocaleString("id-ID")}</div>
                  <div className="mt-2 flex flex-wrap gap-ms-2">
                    {task && (
                      <button onClick={() => setOpenTask(task)} className="inline-flex h-7 items-center gap-ms-1 rounded-md border bg-background px-ms-2 text-ms-2xs font-medium">Buka tugas</button>
                    )}
                    <button onClick={() => ackPinAlert(a.id)} className="inline-flex h-7 items-center gap-ms-1 rounded-md bg-destructive px-ms-2 text-ms-2xs font-medium text-destructive-foreground">Sudah ditangani</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 mb-4 rounded-md border border-warning/40 bg-warning/5 p-ms-2 text-ms-2xs text-warning dark:text-warning">
        ⚖️ <b>Anda</b> yang menentukan <b>berat / jumlah</b> yang harus disiapkan per item (boleh desimal, mis. <b>0.90</b> gram untuk eceran kristal). Pegawai cukup mengirim <b>foto + lokasi</b>. Stok gudang induk otomatis berkurang sesuai angka yang Anda isi (mis. 100 − 0.90 = 99.10).
      </div>

      {(() => {
        const chip = (key: typeof statusFilter, label: string, n: number) => {
          const isActive = statusFilter === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setStatusFilter(key)}
              className={
                "relative shrink-0 whitespace-nowrap text-ms-xs transition-colors " +
                (isActive
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {label} <span className="opacity-60 tabular-nums">({n})</span>
              {isActive ? (
                <span
                  aria-hidden
                  className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-primary"
                />
              ) : null}
            </button>
          );
        };
        return (
          <div
            className="-mx-1 mb-3 flex items-center gap-ms-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="Filter status tugas"
          >
            {chip("all", "Semua", counts.all)}
            {chip("waiting", "Menunggu", counts.waiting)}
            {chip("progress", "Dikerjakan", counts.progress)}
            {chip("done", "Selesai", counts.done)}
          </div>
        );
      })()}

      <div className="space-ms-2">
        {!tasksLoaded && tasks.length === 0 && (
          <div className="space-ms-2" aria-hidden>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 w-full animate-pulse rounded-xl bg-muted/40" />
            ))}
          </div>
        )}
        {tasks
          .filter((t) => {
            if (statusFilter === "all") return true;
            const s = deriveTaskStatus(t.status, progress[t.id] ?? { items: 0, submitted: 0, approved: 0 });
            return (
              (statusFilter === "waiting" && s === "Menunggu") ||
              (statusFilter === "progress" && s === "Dikerjakan") ||
              (statusFilter === "done" && s === "Selesai")
            );
          })
          .filter((t) => {
            if (!q) return true;
            return (
              (t.title || "").toLowerCase().includes(q) ||
              (t.note || "").toLowerCase().includes(q)
            );
          })
          .map((t) => {
          const p = progress[t.id] ?? { items: 0, submitted: 0, approved: 0 };
          const s = deriveTaskStatus(t.status, p);
          const pct = p.items > 0 ? Math.min(100, Math.round((p.submitted / p.items) * 100)) : 0;
          const badgeCls =
            s === "Selesai" ? "bg-success/15 text-success border-success/40 dark:text-success"
            : s === "Dikerjakan" ? "bg-warning/15 text-warning border-warning/40 dark:text-warning"
            : "bg-muted text-muted-foreground border-border";
          const expMs = t.expires_at ? new Date(t.expires_at).getTime() : 0;
          const remainingMs = expMs ? expMs - now : 0;
          const overdue = s !== "Selesai" && expMs > 0 && remainingMs < 0;
          // Urgensi (visual only — didasarkan sisa waktu vs status):
          //  Mendesak: overdue atau < 2 jam
          //  Tinggi  : < 12 jam
          //  Sedang  : < 48 jam
          //  Rendah  : sisanya
          const H = 3_600_000;
          const urg: "urgent" | "high" | "medium" | "low" =
            s === "Selesai" ? "low"
              : overdue || remainingMs < 2 * H ? "urgent"
              : remainingMs < 12 * H ? "high"
              : remainingMs < 48 * H ? "medium"
              : "low";
          const urgLabel = { urgent: "Mendesak", high: "Tinggi", medium: "Sedang", low: "Rendah" }[urg];
          const urgCls = {
            urgent: "bg-destructive/15 text-destructive border-destructive/40",
            high: "bg-warning/15 text-warning border-warning/40 dark:text-warning",
            medium: "bg-sky-500/15 text-sky-700 border-sky-500/40 dark:text-sky-400",
            low: "bg-muted text-muted-foreground border-border",
          }[urg];
          return (
          <div key={t.id} className="group relative overflow-hidden rounded-xl border bg-card p-ms-3 shadow-sm transition-all hover:border-primary/40 hover:shadow-md">
            <div className="flex flex-wrap items-start gap-ms-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-ms-1.5">
                  <span className={`inline-flex h-5 shrink-0 items-center rounded-full border px-ms-2 text-ms-2xs font-semibold uppercase tracking-wide ${badgeCls}`}>{s}</span>
                  <span className={`inline-flex h-5 shrink-0 items-center gap-ms-1 rounded-full border px-ms-2 text-ms-2xs font-semibold uppercase tracking-wide ${urgCls}`}>
                    {urg === "urgent" ? <Flame className="h-3 w-3" /> : <Timer className="h-3 w-3" />} {urgLabel}
                  </span>
                  {overdue && (
                    <span className="inline-flex h-5 shrink-0 items-center gap-ms-1 rounded-full border border-destructive/40 bg-destructive/15 px-ms-2 text-ms-2xs font-semibold uppercase tracking-wide text-destructive">
                      <AlertTriangle className="h-3 w-3" /> Terlambat
                    </span>
                  )}
                </div>
                <div className="mt-1 truncate text-ms-sm font-semibold [overflow-wrap:anywhere]">{t.title}</div>
                {t.note && (
                  <div className="mt-0.5 line-clamp-1 text-ms-2xs text-muted-foreground">{t.note}</div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-ms-2 text-ms-2xs text-muted-foreground">
                  <span className="inline-flex items-center gap-ms-1">
                    <CalendarClock className="h-3 w-3" />
                    {new Date(t.created_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}
                  </span>
                  {expMs > 0 && (
                    <span className={`inline-flex items-center gap-ms-1 tabular-nums ${overdue ? "text-destructive font-semibold" : ""}`}>
                      <Clock className="h-3 w-3" />
                      {overdue ? "lewat " : "berakhir "}
                      {new Date(t.expires_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-ms-1 tabular-nums">
                    <CheckCircle2 className="h-3 w-3" /> {p.submitted}/{p.items} item
                  </span>
                  {(() => {
                    const n = notifStats[t.id];
                    if (!n || (n.sent === 0 && n.failed === 0)) return null;
                    const lastLabel = n.lastAt
                      ? new Date(n.lastAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                      : "";
                    const cls = n.failed > 0
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-success/40 bg-success/10 text-success";
                    const Icon = n.lastStatus === "failed" ? BellOff : BellRing;
                    const title = `Notifikasi WA · ${n.sent} terkirim · ${n.failed} gagal${lastLabel ? ` · terakhir ${lastLabel}` : ""}`;
                    return (
                      <Link
                        to="/pengaturan-notifikasi-wa"
                        className={`inline-flex items-center gap-ms-1 rounded-full border px-1.5 py-0.5 tabular-nums font-semibold ${cls}`}
                        title={title}
                        aria-label={title}
                      >
                        <Icon className="h-3 w-3" />
                        <span>{n.sent}✓{n.failed > 0 ? ` · ${n.failed}✕` : ""}</span>
                        {lastLabel && <span className="hidden sm:inline text-muted-foreground font-normal">· {lastLabel}</span>}
                      </Link>
                    );
                  })()}
                </div>
                <TaskPinMemo shareToken={t.share_token} />
              </div>
              <div className="flex shrink-0 items-center gap-ms-1">
                <button onClick={() => setOpenTask(t)} className="inline-flex h-8 items-center gap-ms-1 rounded-md border px-ms-2 text-ms-xs font-medium hover:bg-accent" aria-label={`Buka tugas ${t.title}`}>Buka</button>
                <button
                  onClick={() => setSharePinFor(t)}
                  title="Bagikan link + PIN via MCM"
                  aria-label="Bagikan link dan PIN"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-wa/40 bg-wa/10 text-wa-strong hover:bg-wa/20"
                >
                  <MessageCircle className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setQrFor(t)}
                  title="Tampilkan QR code link pegawai"
                  aria-label="Tampilkan QR code link pegawai"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                >
                  <QrCode className="h-4 w-4" />
                </button>
                <button
                  onClick={() => resetPinAttempts(t.share_token, t.title)}
                  title="Reset percobaan PIN (pemilik / admin)"
                  aria-label="Reset percobaan PIN"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-warning/40 bg-warning/10 text-warning hover:bg-warning/20 dark:text-warning"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button onClick={() => removeTask(t.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-destructive hover:bg-destructive/10" title="Hapus tugas" aria-label="Hapus tugas"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
            {p.items > 0 && (
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${s === "Selesai" ? "bg-success" : s === "Dikerjakan" ? "bg-warning" : "bg-muted-foreground/40"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
          );
        })}
        {tasksLoaded && tasks.length === 0 && (
          <div className="flex flex-col items-center gap-ms-2 rounded-xl border border-dashed bg-card/50 p-8 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ListTodo className="h-6 w-6" />
            </span>
            <div className="text-ms-sm font-medium">Belum ada tugas</div>
            <div className="max-w-sm text-ms-2xs text-muted-foreground">Buat tugas pertama untuk mulai mengirim daftar penyiapan ke pegawai via link + PIN.</div>
            <button onClick={() => setOpenCreate(true)} className="mt-1 inline-flex h-8 items-center gap-ms-1 rounded-md bg-primary px-ms-3 text-ms-xs font-semibold text-primary-foreground">
              <Plus className="h-3.5 w-3.5" /> Buat tugas
            </button>
          </div>
        )}
        {tasks.length > 0 && tasks.filter((t) => {
          if (statusFilter === "all") return true;
          const s = deriveTaskStatus(t.status, progress[t.id] ?? { items: 0, submitted: 0, approved: 0 });
          return (
            (statusFilter === "waiting" && s === "Menunggu") ||
            (statusFilter === "progress" && s === "Dikerjakan") ||
            (statusFilter === "done" && s === "Selesai")
          );
        }).filter((t) => {
          if (!q) return true;
          return (
            (t.title || "").toLowerCase().includes(q) ||
            (t.note || "").toLowerCase().includes(q)
          );
        }).length === 0 && (
          <div className="rounded-xl border border-dashed bg-card/50 p-ms-6 text-center text-ms-xs text-muted-foreground">
            Tidak ada tugas yang cocok dengan filter / pencarian.
          </div>
        )}
      </div>

      {openCreate && (
        <CreateDialog
          warehouse={warehouse}
          variants={effectiveVariants}
          onVariantsChanged={load}
          onClose={() => setOpenCreate(false)}
          onCreated={(info) => { clearCreateDraft(); setOpenCreate(false); setCreatedInfo(info); void load(); }}
        />
      )}
      {createdInfo && <ShareDialog info={createdInfo} onClose={() => setCreatedInfo(null)} />}
      {openTask && <TaskDetail task={openTask} onClose={() => { setOpenTask(null); void load(); }} />}
      {sharePinFor && (
        <SharePinDialog
          title={sharePinFor.title}
          url={publicTaskUrl(sharePinFor.share_token)}
          taskId={sharePinFor.id}
          shareToken={sharePinFor.share_token}
          onClose={() => setSharePinFor(null)}
        />
      )}
      {qrFor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`QR code untuk ${qrFor.title}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-ms-4"
          onClick={() => setQrFor(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border bg-card p-ms-4 shadow-xl"
          >
            <div className="mb-2 flex items-start justify-between gap-ms-2">
              <div className="min-w-0">
                <div className="text-ms-sm font-semibold [overflow-wrap:anywhere]">{qrFor.title}</div>
                <div className="mt-0.5 text-ms-2xs text-muted-foreground">
                  Pindai QR ini di perangkat lain untuk membuka halaman pegawai. PIN diketik manual saat halaman terbuka.
                </div>
              </div>
              <button
                onClick={() => setQrFor(null)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border hover:bg-accent"
                aria-label="Tutup"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <TaskQrCode url={publicTaskUrl(qrFor.share_token)} title={qrFor.title} />
            <div className="mt-2 break-all rounded-md border bg-muted/40 p-ms-2 text-ms-2xs text-muted-foreground">
              {publicTaskUrl(qrFor.share_token)}
            </div>
          </div>
        </div>
      )}
      {openVariantsHub && (
        <VariantsHub
          warehouse={warehouse}
          catVariants={catVariants}
          masterCategories={masterCategories}
          uid={uid}
          onCategoriesChanged={load}
          onPickCategory={(cat) => setManageCategoryFor(cat)}
          onClose={() => setOpenVariantsHub(false)}
        />
      )}
      {manageCategoryFor && (
        <CategoryVariantManager
          category={manageCategoryFor}
          variants={catVariants.filter((v) => v.category === manageCategoryFor)}
          onClose={() => setManageCategoryFor(null)}
          onChanged={load}
        />
      )}
      {openAudit && (
        <AuditDialog
          tasks={tasks}
          onClose={() => setOpenAudit(false)}
          onOpenTask={(t) => { setOpenAudit(false); setOpenTask(t); }}
        />
      )}
      </>
  );
  }
}

// ---------- Create dialog ----------
type Line = { key: string; variantId: string | null; count: number; weightOverride: number | null; split: boolean };
type PickedEntry = { item: WItem; lines: Line[] };

function newLine(variantId: string | null = null): Line {
  return { key: Math.random().toString(36).slice(2), variantId, count: 1, weightOverride: null, split: false };
}
function lineWeight(line: Line, variants: Variant[]): number {
  // Saat varian dipilih, berat selalu mengikuti preset varian — meski
  // `weightOverride` lama tersisa di state. `weightOverride` hanya berlaku
  // di mode manual (variantId == null).
  if (line.variantId) {
    const v = variants.find((x) => x.id === line.variantId);
    if (v) return Number(v.weight_per_unit) || 0;
  }
  if (line.weightOverride != null) return Number(line.weightOverride) || 0;
  return 0;
}

// Satu-satunya sumber kebenaran untuk status sebuah baris. Dipakai
// baik oleh ringkasan maupun badge per-baris, sehingga keduanya
// tidak pernah berbeda. Murni dihitung dari state baris (tanpa
// `lineStatus` yang diperbarui asinkron oleh NumberInput).
// Batas atas wajar per baris. Cegah salah ketik (mis. tambah 1 nol) tanpa
// mengekang skenario nyata: 100.000 pcs / 100.000 g per baris sudah jauh di
// atas kebutuhan operasional harian.
const MAX_COUNT_UNITS = 100_000;
const MAX_PER_UNIT_PCS = 100_000;
const MAX_PER_UNIT_G = 100_000; // gram

function evaluateLine(line: Line, variants: Variant[], opts?: { isPcs?: boolean }): {
  status: "valid" | "partial" | "invalid";
  weight: number;
  count: number;
  total: number;
  reason?: string;
} {
  const isPcs = !!opts?.isPcs;
  const weight = lineWeight(line, variants);
  const count = Number(line.count);
  const cOk = Number.isFinite(count) && count > 0;
  const wOk = Number.isFinite(weight) && weight > 0;
  let status: "valid" | "partial" | "invalid" = "valid";
  let reason: string | undefined;
  if (!cOk || !wOk) {
    status = "invalid";
  } else if (!Number.isInteger(count)) {
    // Jumlah unit selalu bilangan bulat (tidak ada "1,5 karton").
    status = "invalid";
    reason = "Jumlah unit harus bilangan bulat";
  } else if (count > MAX_COUNT_UNITS) {
    status = "invalid";
    reason = `Jumlah unit melebihi batas (${MAX_COUNT_UNITS})`;
  } else if (isPcs && !Number.isInteger(weight)) {
    // Item pcs: isi per unit juga bilangan bulat (mis. 12 botol/karton).
    status = "invalid";
    reason = "Jumlah / isi (pcs) harus bilangan bulat";
  } else if (isPcs && weight > MAX_PER_UNIT_PCS) {
    status = "invalid";
    reason = `Jumlah / isi (pcs) melebihi batas (${MAX_PER_UNIT_PCS})`;
  } else if (!isPcs && weight > MAX_PER_UNIT_G) {
    status = "invalid";
    reason = `Berat / unit (g) melebihi batas (${MAX_PER_UNIT_G} g)`;
  }
  const total = status === "valid" ? weight * count : 0;
  return { status, weight: wOk ? weight : 0, count: cOk ? count : 0, total, reason };
}
// Parser angka yang menerima koma desimal (format Indonesia) maupun titik.
function parseNum(input: string): number | null {
  // Terima input parsial saat user masih mengetik (mis. "0.", ".", "-", "1,"),
  // supaya state tidak ter-reset ke null dan menghapus nilai sebelumnya.
  let s = (input ?? "").toString().trim().replace(",", ".");
  if (s === "") return null;
  // Hanya tanda minus / plus → anggap 0 sementara.
  if (s === "-" || s === "+") return 0;
  // Diakhiri titik desimal (mis. "0.", "12.") → buang titiknya.
  if (s.endsWith(".")) s = s.slice(0, -1);
  // Diawali titik (mis. ".5") → tambahkan 0 di depan.
  if (s.startsWith(".")) s = "0" + s;
  if (s === "-" || s === "+" || s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Pembulatan setengah-menjauh-dari-nol agar hasil hitung konsisten
// (Number.prototype.toFixed kadang membulatkan ke bawah karena floating point,
// mis. (1.005).toFixed(2) === "1.00").
function roundTo(n: number, maxFrac = 2): number {
  if (!Number.isFinite(n)) return 0;
  const p = Math.pow(10, maxFrac);
  return Math.sign(n) * Math.round(Math.abs(n) * p + 1e-9) / p;
}

// Formatter angka konsisten untuk UI: gaya Indonesia (koma desimal, titik ribuan),
// dibulatkan ke `maxFrac` digit dan trailing zero dihilangkan supaya bilangan
// bulat tampil rapi (mis. 1, bukan 1,00). Cocok dipakai bersama parseNum.
function fmtNum(n: number | null | undefined, maxFrac = 2): string {
  if (n == null || !Number.isFinite(Number(n))) return "0";
  const rounded = roundTo(Number(n), maxFrac);
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  }).format(rounded);
}

// Input angka terkontrol yang menyimpan teks mentah saat user mengetik
// (mis. "0,", "1.") tetapi selalu meneruskan hasil parse numerik ke parent
// lewat onChange supaya total per baris & ringkasan selalu konsisten dengan
// nilai internal. Saat blur / nilai eksternal berubah, teks dinormalisasi
// memakai fmtNum agar tampilan konsisten dengan hasil hitung.
function NumberInput({
  value,
  onChange,
  maxFrac = 3,
  disabled,
  className,
  emptyAs = 0,
  onStatusChange,
  placeholder,
  min,
  max,
  integerOnly,
}: {
  value: number;
  onChange: (n: number) => void;
  maxFrac?: number;
  disabled?: boolean;
  className?: string;
  // Nilai yang dipakai saat input dikosongkan. null = jangan ubah state.
  emptyAs?: number | null;
  // Dipanggil tiap kali status validasi input berubah.
  onStatusChange?: (status: "valid" | "partial" | "invalid") => void;
  placeholder?: string;
  // Batas nilai. Nilai di luar range → status invalid (cincin merah).
  min?: number;
  max?: number;
  // Wajib bilangan bulat (dipakai untuk item pcs).
  integerOnly?: boolean;
}) {
  const [text, setText] = useState(() => fmtNum(value, maxFrac));
  const focused = useRef(false);
  // Hitung status validasi dari teks mentah supaya konsisten dengan parseNum.
  const status: "valid" | "partial" | "invalid" = (() => {
    const raw = text.trim();
    if (raw === "") return emptyAs == null ? "invalid" : "valid";
    // Karakter yang diizinkan: digit, separator desimal, dan tanda.
    if (!/^[-+]?[\d.,]*$/.test(raw)) return "invalid";
    // Pola parsial: hanya tanda, hanya separator, atau diakhiri separator.
    if (/^[-+]?$/.test(raw)) return "partial";
    if (/^[-+]?[.,]$/.test(raw)) return "partial";
    if (/[.,]$/.test(raw)) return "partial";
    const n = parseNum(raw);
    if (n == null || !Number.isFinite(n)) return "invalid";
    if (integerOnly && !Number.isInteger(n)) return "invalid";
    if (min != null && n < min) return "invalid";
    if (max != null && n > max) return "invalid";
    return "valid";
  })();
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current !== status) {
      lastStatus.current = status;
      onStatusChange?.(status);
    }
  }, [status, onStatusChange]);
  // Sinkronisasi saat nilai numerik berubah dari luar dan input tidak sedang difokuskan.
  useEffect(() => {
    if (focused.current) return;
    const next = fmtNum(value, maxFrac);
    setText((t) => (t === next ? t : next));
  }, [value, maxFrac]);
  const statusRing =
    disabled ? "" :
    status === "invalid" ? "ring-1 ring-destructive border-destructive" :
    status === "partial" ? "ring-1 ring-warning border-warning" :
    "";
  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      value={text}
      placeholder={placeholder}
      aria-invalid={status === "invalid"}
      onFocus={() => { focused.current = true; }}
      onBlur={() => {
        focused.current = false;
        setText(fmtNum(value, maxFrac));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === "") {
          if (emptyAs != null) onChange(emptyAs);
          return;
        }
        const n = parseNum(raw);
        if (n == null) return;
        onChange(roundTo(n, maxFrac));
      }}
      className={`${className ?? ""} ${statusRing}`.trim()}
    />
  );
}

function CreateDialog({ warehouse, variants, onVariantsChanged, onClose, onCreated }: { warehouse: WItem[]; variants: Variant[]; onVariantsChanged: () => void | Promise<void>; onClose: () => void; onCreated: (info: { token: string; pin: string; title: string }) => void }) {
  // Restore draf terakhir supaya reload tak sengaja (chunk error, auto-lock,
  // rebuild preview) tidak menghapus pekerjaan yang belum dikirim.
  const draft = useMemo(() => readCreateDraft(), []);
  const [title, setTitle] = useState<string>(draft?.title ?? "Tugas siapkan barang");
  const [note, setNote] = useState<string>(draft?.note ?? "");
  const [pin, setPin] = useState<string>(draft?.pin && /^\d{4,8}$/.test(draft.pin) ? draft.pin : genPin());
  const [phone, setPhone] = useState<string>(() => {
    if (draft?.phone) return draft.phone;
    if (typeof window === "undefined") return "";
    return localStorage.getItem("prep:last_phone") ?? "";
  });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, PickedEntry>>(() => {
    const d = draft?.picked;
    return d && typeof d === "object" ? (d as Record<string, PickedEntry>) : {};
  });
  const [manageVariantsFor, setManageVariantsFor] = useState<WItem | null>(null);
  const [busy, setBusy] = useState(false);

  // Saran otomatis nomor pegawai dari buku alamat (address_book).
  // Ditarik sekali saat dialog dibuka; native <datalist> memberi pengalaman
  // autocomplete yang mulus di keyboard Android/iOS tanpa perlu library.
  const [phoneSuggestions, setPhoneSuggestions] = useState<
    Array<{ value: string; label: string; name: string; linkedUserId: string | null }>
  >([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [phoneHighlight, setPhoneHighlight] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchAddressBook();
        if (cancelled) return;
        const seen = new Set<string>();
        const list: Array<{ value: string; label: string; name: string; linkedUserId: string | null }> = [];
        for (const r of rows as AddressBookRow[]) {
          const norm = r.phone_norm ?? normalizePhone(r.phone);
          if (!norm) continue;
          // Format 628xxx (bukan +62 / 08) supaya konsisten dgn input.
          const value = norm.startsWith("+") ? norm.slice(1) : norm;
          if (!value || seen.has(value)) continue;
          seen.add(value);
          const name = r.name || value;
          list.push({ value, label: name, name, linkedUserId: r.linked_user_id ?? null });
        }
        list.sort((a, b) => a.label.localeCompare(b.label));
        setPhoneSuggestions(list);
      } catch {
        // Diam-diam gagal — autocomplete hanyalah bantuan opsional.
      } finally {
        if (!cancelled) setContactsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-persist draf tiap kali field berubah. sessionStorage-scoped: hilang
  // saat tab ditutup, tapi tahan reload di tab yang sama.
  useEffect(() => {
    writeCreateDraft({ title, note, pin, phone, picked });
  }, [title, note, pin, phone, picked]);

  // Apakah draf punya isi bermakna → dipakai untuk konfirmasi tutup.
  const hasContent =
    Object.keys(picked).length > 0 ||
    note.trim() !== "" ||
    title.trim() !== "Tugas siapkan barang";

  // Validasi nomor pegawai: opsional, tapi jika diisi harus (a) format 628xxx
  // yang valid dan (b) cocok dengan kontak tersimpan supaya nama & ID pegawai
  // benar-benar terverifikasi sebelum tugas dibuat.
  const phoneValidation = useMemo(() => {
    const cleaned = phone.replace(/\D/g, "");
    if (!cleaned) return { ok: true as const, error: null as string | null };
    if (!/^628\d{7,13}$/.test(cleaned)) {
      return {
        ok: false as const,
        error:
          "Gagal menyimpan: format nomor belum benar. Nomor harus diawali 628 (bukan +62 atau 08), diikuti 7–13 digit. Contoh format yang benar: 6281234567890. Cara memperbaiki: ubah menjadi diawali 628, lalu pilih dari daftar kontak yang muncul.",
      };
    }
    if (contactsLoaded && !phoneSuggestions.some((s) => s.value === cleaned)) {
      return {
        ok: false as const,
        error:
          "Gagal menyimpan: nomor belum tersimpan di buku alamat. Format sudah benar, tapi kontak ini belum pernah ditambahkan. Cara memperbaiki: simpan dulu nomor pegawai di menu Kontak, lalu kembali ke sini dan pilih dari daftar kontak.",
      };
    }
    return { ok: true as const, error: null as string | null };
  }, [phone, phoneSuggestions, contactsLoaded]);

  // Kandidat kontak yang cocok dengan yang diketik. Cocok jika substring
  // digit ada di nomor ATAU substring (case-insensitive) ada di nama.
  // Dropdown hanya muncul kalau ada input & ada hasil & belum exact match.
  const phoneMatches = useMemo(() => {
    const raw = phone.trim();
    const digits = raw.replace(/\D/g, "");
    if (!raw) return [] as typeof phoneSuggestions;
    const q = raw.toLowerCase();
    const list = phoneSuggestions.filter((s) => {
      if (digits && s.value.includes(digits)) return true;
      if (s.name.toLowerCase().includes(q)) return true;
      return false;
    });
    return list.slice(0, 8);
  }, [phone, phoneSuggestions]);
  const phoneExactMatch = useMemo(() => {
    const cleaned = phone.replace(/\D/g, "");
    if (!cleaned) return false;
    return phoneSuggestions.some((s) => s.value === cleaned);
  }, [phone, phoneSuggestions]);
  const showPhoneDropdown =
    phoneFocused && phoneMatches.length > 0 && !phoneExactMatch;
  useEffect(() => {
    setPhoneHighlight(0);
  }, [phone]);

  function requestClose() {
    if (hasContent) {
      const ok = window.confirm(
        "Tutup dialog Buat tugas baru? Isian akan dipertahankan sebagai draf, dan dialog akan otomatis terbuka kembali saat halaman dimuat ulang.",
      );
      if (!ok) return;
    } else {
      clearCreateDraft();
    }
    onClose();
  }

  // Peringatan sebelum menutup tab / hard-refresh saat draf punya isi.
  useEffect(() => {
    if (!hasContent) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasContent]);

  // Status validasi per baris (count / weight) — dipakai untuk badge indikator.
  type LineStatus = "valid" | "partial" | "invalid";
  const [lineStatus, setLineStatus] = useState<Record<string, { count: LineStatus; weight: LineStatus }>>({});
  function setFieldStatus(key: string, field: "count" | "weight", s: LineStatus) {
    setLineStatus((m) => {
      const cur = m[key] ?? { count: "valid", weight: "valid" };
      if (cur[field] === s) return m;
      return { ...m, [key]: { ...cur, [field]: s } };
    });
  }
  function rowStatus(key: string): LineStatus {
    const s = lineStatus[key]; if (!s) return "valid";
    if (s.count === "invalid" || s.weight === "invalid") return "invalid";
    if (s.count === "partial" || s.weight === "partial") return "partial";
    return "valid";
  }

  // Ringkasan: jumlah baris valid / partial / invalid + total berat siap kirim.
  const summary = useMemo(() => {
    let totalLines = 0, validLines = 0, partialLines = 0, invalidLines = 0;
    let totalWeight = 0;
    let readyLines = 0, readyWeight = 0;
    // Pisah total berdasarkan base_unit — item `g` diakumulasi sebagai berat,
    // item `pcs` sebagai jumlah. Ringkasan menampilkan keduanya bila hadir.
    let totalWeightG = 0, readyWeightG = 0;
    let totalCountPcs = 0, readyCountPcs = 0;
    let linesWithoutPhoto = 0;
    const itemsWithoutPhoto: string[] = [];
    for (const entry of Object.values(picked)) {
      const hasPhoto = !!entry.item.image_path;
      if (!hasPhoto) itemsWithoutPhoto.push(entry.item.name);
      const isPcs = (entry.item.base_unit ?? "pcs") === "pcs";
      for (const l of entry.lines) {
        totalLines++;
        if (!hasPhoto) linesWithoutPhoto++;
        // Satu selector tunggal — ringkasan & badge per-baris memakai
        // hasil yang sama, tidak ada lagi ketergantungan ke lineStatus.
        const ev = evaluateLine(l, variants, { isPcs });
        if (ev.status === "valid") {
          validLines++;
          totalWeight += ev.total;
          if (isPcs) totalCountPcs += ev.total;
          else totalWeightG += ev.total;
          // Foto referensi opsional → baris valid selalu dihitung siap kirim.
          readyLines++;
          readyWeight += ev.total;
          if (isPcs) readyCountPcs += ev.total;
          else readyWeightG += ev.total;
        } else if (ev.status === "partial") partialLines++;
        else invalidLines++;
      }
    }
    return {
      items: Object.keys(picked).length,
      totalLines, validLines, partialLines, invalidLines,
      totalWeight: roundTo(totalWeight, 2),
      readyLines,
      readyWeight: roundTo(readyWeight, 2),
      totalWeightG: roundTo(totalWeightG, 2),
      totalCountPcs: roundTo(totalCountPcs, 0),
      readyWeightG: roundTo(readyWeightG, 2),
      readyCountPcs: roundTo(readyCountPcs, 0),
      linesWithoutPhoto,
      itemsWithoutPhoto,
    };
  }, [picked, variants]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return warehouse.filter((w) => !q || w.name.toLowerCase().includes(q) || (w.category ?? "").toLowerCase().includes(q));
  }, [warehouse, query]);

  function toggle(it: WItem) {
    setPicked((p) => {
      const n = { ...p };
      if (n[it.id]) {
        delete n[it.id];
      } else {
        const itemVariants = variants.filter((v) => v.warehouse_item_id === it.id);
        n[it.id] = { item: it, lines: [newLine(itemVariants[0]?.id ?? null)] };
      }
      return n;
    });
  }

  function updateLine(itemId: string, key: string, patch: Partial<Line>) {
    setPicked((s) => {
      const e = s[itemId]; if (!e) return s;
      return { ...s, [itemId]: { ...e, lines: e.lines.map((l) => l.key === key ? { ...l, ...patch } : l) } };
    });
  }
  function addLine(itemId: string) {
    setPicked((s) => {
      const e = s[itemId]; if (!e) return s;
      const itemVariants = variants.filter((v) => v.warehouse_item_id === itemId);
      return { ...s, [itemId]: { ...e, lines: [...e.lines, newLine(itemVariants[0]?.id ?? null)] } };
    });
  }
  function removeLine(itemId: string, key: string) {
    setPicked((s) => {
      const e = s[itemId]; if (!e) return s;
      const lines = e.lines.filter((l) => l.key !== key);
      if (lines.length === 0) { const n = { ...s }; delete n[itemId]; return n; }
      return { ...s, [itemId]: { ...e, lines } };
    });
  }

  async function create() {
    const entries = Object.values(picked);
    if (entries.length === 0) { toast.error("Pilih minimal 1 barang"); return; }
    if (pin.length < 4) { toast.error("PIN minimal 4 digit"); return; }
    if (!phoneValidation.ok) { toast.error(phoneValidation.error ?? "Nomor pegawai tidak valid"); return; }
    // Foto referensi bersifat opsional — barang tanpa foto tetap dibuatkan tugas,
    // hanya saja tidak ada lampiran foto referensi ke WhatsApp.
    const missingPhoto = entries.filter((e) => !e.item.image_path).map((e) => e.item.name);
    if (missingPhoto.length > 0) {
      const list = missingPhoto.slice(0, 3).join(", ") + (missingPhoto.length > 3 ? `, +${missingPhoto.length - 3} lainnya` : "");
      toast.warning(`${missingPhoto.length} barang tanpa foto referensi: ${list}. Pegawai tetap menerima link & PIN.`, { duration: 5000 });
    }
    const cleanedPhone = phone.replace(/\D/g, "");
    setBusy(true);
    const token = genShareToken();
    // Setiap baris (varian + jumlah) → 1 item tugas. Berat per baris = weight × count.
    // Stok dipotong dari produk induk (warehouse_item_id), bukan dari varian.
    const expanded = entries.flatMap(({ item, lines }) =>
      lines.flatMap((l) => {
        const w = lineWeight(l, variants);
        const v = variants.find((x) => x.id === l.variantId);
        const baseName = v ? `${item.name} — ${v.label}` : item.name;
        const total = w * (l.count || 0);
        if (l.split && (l.count || 0) > 1) {
          const n = Math.floor(l.count);
          return Array.from({ length: n }, (_, i) => ({
            warehouse_item_id: item.id,
            name: `${baseName} (${i + 1}/${n})`,
            category: item.category,
            qty_requested: w,
            unit_label: v?.unit_label ?? null,
            ref_photo_path: item.image_path,
          }));
        }
        return [{
          warehouse_item_id: item.id, name: baseName, category: item.category,
          qty_requested: total, unit_label: v?.unit_label ?? null,
          ref_photo_path: item.image_path,
        }];
      })
    );
    const args = {
      _title: title, _note: note || null, _pin: pin, _share_token: token,
      _items: expanded,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("prep_create_task", args);
    if (error) {
      setBusy(false);
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("storage_account_required")) {
        return toast.error(
          "Akun ini masih MCM Chat. Upgrade ke MCM Storage dulu untuk membuat tugas penyiapan.",
          { duration: 6000 },
        );
      }
      if (msg.includes("forbidden")) {
        return toast.error(
          "Akun ini belum berwenang membuat tugas penyiapan. Pastikan akun sudah MCM Storage lalu coba lagi.",
          { duration: 6000 },
        );
      }
      if (msg.includes("unauthenticated")) {
        return toast.error("Sesi berakhir. Silakan login ulang.");
      }
      if (msg.includes("pin_too_short")) {
        return toast.error("PIN minimal 4 digit.");
      }
      if (msg.includes("invalid_share_token")) {
        return toast.error("Token share tidak valid. Coba ulangi.");
      }
      return toast.error(error.message);
    }
    // Simpan PIN sebagai pengingat lokal di HP pemilik saja (localStorage).
    // Tidak dikirim ke mana pun; verifikasi tetap via hash server-side.
    rememberPin(token, pin);
    // Kumpulkan foto referensi tiap barang yang dipilih untuk dilampirkan ke WA.
    const photoFiles: File[] = [];
    const seen = new Set<string>();
    for (const { item } of entries) {
      if (!item.image_path || seen.has(item.image_path)) continue;
      seen.add(item.image_path);
      try {
        const url = await signedUrl(item.image_path);
        if (!url) continue;
        const safeName = item.name.replace(/[^\w.-]+/g, "_").slice(0, 40) || "foto";
        const ext = (item.image_path.match(/\.(\w{3,4})($|\?)/)?.[1] ?? "jpg").toLowerCase();
        const f = await urlToFile(url, `${safeName}.${ext}`);
        if (f) photoFiles.push(f);
      } catch { /* abaikan foto yang gagal diambil */ }
    }
    setBusy(false);
    if (cleanedPhone || photoFiles.length > 0) {
      if (cleanedPhone) localStorage.setItem("prep:last_phone", cleanedPhone);
      const url = publicTaskUrl(token);
      const text = `Tolong siapkan barang berikut. Buka link, masukkan PIN, foto barangnya & kirim:\n\n${title}\nPIN: ${pin}`;
      const result = await shareToWhatsApp({
        title,
        text,
        url,
        files: photoFiles,
        phone: cleanedPhone || undefined,
      });
      toast.success("Tugas dibuat");
      notifyShareResult(result);
    } else {
      toast.success("Tugas dibuat");
    }
    onCreated({ token, pin, title });
  }

  return (
    <Modal title="Buat tugas baru" onClose={requestClose}>
      {manageVariantsFor && (
        <VariantManager
          item={manageVariantsFor}
          variants={variants.filter((v) => v.warehouse_item_id === manageVariantsFor.id)}
          onClose={() => setManageVariantsFor(null)}
          onChanged={onVariantsChanged}
        />
      )}
      <div className="space-ms-3 text-ms-sm">
        <div className="rounded-md border bg-muted/40 p-ms-2 text-ms-2xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold">Ringkasan</span>
            <span><b>{summary.items}</b> barang · <b>{summary.totalLines}</b> baris</span>
            <span className="inline-flex items-center gap-ms-1 rounded bg-success/10 px-1.5 py-0.5 text-success">
              <CheckCircle2 className="h-3 w-3" /> {summary.validLines} valid
            </span>
            {summary.partialLines > 0 && (
              <span className="inline-flex items-center gap-ms-1 rounded bg-warning/10 px-1.5 py-0.5 text-warning">
                <AlertTriangle className="h-3 w-3" /> {summary.partialLines} belum lengkap
              </span>
            )}
            {summary.invalidLines > 0 && (
              <span className="inline-flex items-center gap-ms-1 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">
                <AlertTriangle className="h-3 w-3" /> {summary.invalidLines} tidak valid
              </span>
            )}
            {summary.linesWithoutPhoto > 0 && (
              <span
                className="inline-flex items-center gap-ms-1 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive"
                title={`Belum ada foto: ${summary.itemsWithoutPhoto.join(", ")}`}
              >
                <ImageIcon className="h-3 w-3" /> {summary.itemsWithoutPhoto.length} barang tanpa foto
              </span>
            )}
            <span
              className="ml-auto tabular-nums"
              title={`Hanya baris valid yang sudah punya foto (${summary.readyLines} dari ${summary.validLines} baris valid).`}
            >
              Siap dikirim:{" "}
              {summary.readyWeightG > 0 && (
                <>
                  <span className="text-muted-foreground">Berat / unit </span>
                  <b>{fmtNum(summary.readyWeightG, 2)}</b>
                  <span className="text-muted-foreground"> g</span>
                </>
              )}
              {summary.readyWeightG > 0 && summary.readyCountPcs > 0 && (
                <span className="text-muted-foreground"> · </span>
              )}
              {summary.readyCountPcs > 0 && (
                <>
                  <span className="text-muted-foreground">Jumlah / isi </span>
                  <b>{fmtNum(summary.readyCountPcs, 0)}</b>
                  <span className="text-muted-foreground"> pcs</span>
                </>
              )}
              {summary.readyWeightG === 0 && summary.readyCountPcs === 0 && (
                <b>0</b>
              )}{" "}
              <span className="text-muted-foreground">({summary.readyLines} baris)</span>
            </span>
          </div>
          {summary.linesWithoutPhoto > 0 && (
            <div className="mt-1 flex items-start gap-ms-1 text-ms-2xs text-warning">
              <ImageIcon className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                <b>{summary.itemsWithoutPhoto.length}</b> barang belum punya foto referensi — tugas tetap bisa dikirim, hanya tanpa lampiran foto:{" "}
                <span className="text-muted-foreground">{summary.itemsWithoutPhoto.join(", ")}</span>
              </span>
            </div>
          )}
        </div>
        <label className="block">
          <div className="mb-1 text-ms-2xs text-muted-foreground">Judul</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-10 w-full rounded-md border bg-background px-ms-3 text-ms-sm" />
        </label>
        <label className="block">
          <div className="mb-1 text-ms-2xs text-muted-foreground">Catatan untuk pegawai (opsional)</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-md border bg-background p-ms-2 text-ms-sm" />
        </label>
        <div className="flex items-center gap-ms-2">
          <label className="flex-1">
            <div className="mb-1 text-ms-2xs text-muted-foreground">PIN (4–8 digit)</div>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} className="h-10 w-full rounded-md border bg-background px-ms-3 text-center text-ms-lg tracking-widest tabular-nums" />
          </label>
          <button onClick={() => setPin(genPin())} className="h-10 rounded-md border px-ms-3 text-ms-xs">Acak</button>
        </div>

        <label className="block relative">
          <div className="mb-1 text-ms-2xs text-muted-foreground">Nomor MCM / HP pegawai (opsional, contoh: 6281234567890 — harus dari kontak tersimpan)</div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, "").slice(0, 16))}
            placeholder="62812xxxxxxx"
            inputMode="tel"
            autoComplete="tel"
            onFocus={() => setPhoneFocused(true)}
            onBlur={() => { setTimeout(() => setPhoneFocused(false), 120); }}
            onKeyDown={(e) => {
              if (!showPhoneDropdown) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setPhoneHighlight((h) => Math.min(h + 1, phoneMatches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setPhoneHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                const m = phoneMatches[phoneHighlight];
                if (m) { e.preventDefault(); setPhone(m.value); setPhoneFocused(false); }
              } else if (e.key === "Escape") {
                setPhoneFocused(false);
              }
            }}
            aria-invalid={!phoneValidation.ok}
            className={`h-10 w-full rounded-md border bg-background px-ms-3 text-ms-sm tabular-nums ${
              !phoneValidation.ok ? "border-destructive ring-1 ring-destructive/40" : ""
            }`}
          />
          {showPhoneDropdown && (
            <div
              role="listbox"
              className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-md border bg-popover shadow-lg"
            >
              {phoneMatches.map((m, i) => (
                <button
                  type="button"
                  key={m.value}
                  role="option"
                  aria-selected={i === phoneHighlight}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setPhone(m.value); setPhoneFocused(false); }}
                  onMouseEnter={() => setPhoneHighlight(i)}
                  className={`flex w-full items-center justify-between gap-ms-2 px-ms-2 py-1.5 text-left text-ms-sm ${
                    i === phoneHighlight ? "bg-accent" : "hover:bg-accent/60"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                  <span className="shrink-0 font-mono text-ms-2xs tabular-nums text-muted-foreground">
                    {m.value}
                  </span>
                </button>
              ))}
            </div>
          )}
          {(() => {
            if (!phoneValidation.ok) {
              return (
                <div className="mt-1 flex items-start gap-1 text-ms-2xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{phoneValidation.error}</span>
                </div>
              );
            }
            const cleaned = phone.replace(/\D/g, "");
            const match = cleaned
              ? phoneSuggestions.find((s) => s.value === cleaned)
              : null;
            if (!match) {
              return (
                <div className="mt-1 text-ms-2xs text-muted-foreground">
                  Jika diisi, MCM akan otomatis terbuka berisi link & PIN setelah tugas dibuat.
                </div>
              );
            }
            return (
              <div className="mt-1 flex flex-wrap items-center gap-ms-1 text-ms-2xs">
                <span className="inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 font-medium text-success">
                  <CheckCircle2 className="h-3 w-3" /> {match.name}
                </span>
                <span className="text-muted-foreground">
                  ID:{" "}
                  <span className="font-mono tabular-nums">
                    {match.linkedUserId ? match.linkedUserId.slice(0, 8) : "—"}
                  </span>
                </span>
                {!match.linkedUserId && (
                  <span className="text-muted-foreground">· belum terhubung akun MCM</span>
                )}
              </div>
            );
          })()}
        </label>

        <div className="border-t pt-3">
          <div className="mb-2 flex items-center gap-ms-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari barang…" className="h-9 flex-1 rounded-md border bg-background px-ms-2 text-ms-sm" />
            <span className="text-ms-2xs text-muted-foreground">{Object.keys(picked).length} dipilih</span>
          </div>
          <div className="max-h-96 space-y-1 overflow-y-auto rounded-md border p-ms-1">
            {filtered.map((it) => {
              const p = picked[it.id];
              const itemVariants = variants.filter((v) => v.warehouse_item_id === it.id);
              const missingPhoto = !it.image_path;
              const warnPhoto = !!p && missingPhoto;
              return (
                <div
                  key={it.id}
                  className={`rounded p-ms-1.5 ${
                    warnPhoto
                      ? "border border-destructive/40 bg-destructive/5"
                      : p
                      ? "bg-primary/5"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-ms-2">
                    <input type="checkbox" checked={!!p} onChange={() => toggle(it)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-ms-1.5">
                        <span className="truncate text-ms-xs font-medium">{it.name}</span>
                        {missingPhoto && (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-destructive/10 px-1 py-0.5 text-[9px] font-medium text-destructive"
                            title="Barang ini belum punya foto — tidak bisa dikirim via MCM"
                          >
                            <ImageIcon className="h-2.5 w-2.5" /> Tanpa foto
                          </span>
                        )}
                      </div>
                      <div className="text-ms-2xs text-muted-foreground">
                        {it.category ?? "—"} · stok {fmtItemQty(it.stock_base, { name: it.name, base_unit: (it.base_unit ?? "pcs") as "g" | "pcs", package_type: it.package_type ?? "", package_size: Number(it.package_size) || 0 })}
                        {itemVariants.length > 0 && <span className="ml-1">· {itemVariants.length} varian</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => setManageVariantsFor(it)}
                      className="inline-flex h-7 items-center gap-ms-1 rounded border px-ms-2 text-ms-2xs text-muted-foreground hover:text-foreground"
                      title="Kelola varian (preset berat)">
                      <Settings2 className="h-3 w-3" /> Varian
                    </button>
                  </div>
                  {p && (
                    <div className="mt-2 space-y-1.5 pl-6">
                      {p.lines.map((l) => {
                        const isPcs = (it.base_unit ?? "pcs") === "pcs";
                        const ev = evaluateLine(l, variants, { isPcs });
                        const w = ev.weight;
                        const total = ev.total;
                        const isManual = !l.variantId;
                        const rs = ev.status;
                        // Item dengan `base_unit === "pcs"` (botol, pcs, sachet, dsb.)
                        // tidak diisi berat — kolom kedua mengukur JUMLAH ISI per
                        // unit (mis. 1 karton berisi 10 botol), bukan berat. Label
                        // & placeholder mengikuti supaya pegawai tidak bingung
                        // (screenshot: GS · stok botol seharusnya bukan "Berat").
                        // Label & bantu-teks kolom kanan konsisten untuk item pcs:
                        // "Jumlah / isi" (isi per unit — mis. 1 karton = 12 botol).
                        const perUnitLabel = isPcs ? "Jumlah / isi" : "Berat / unit";
                        const perUnitPlaceholder = isPcs ? "isi manual (pcs)" : "isi manual";
                        const manualHint = isPcs
                          ? "Manual — isi jumlah/isi di kolom kanan"
                          : "Manual — isi berat di kolom kanan";
                        return (
                          <div key={l.key} className="space-y-1.5 rounded border bg-background/60 p-ms-2">
                            <div className="flex items-start gap-ms-1.5">
                              <label className="flex-1 min-w-[120px]">
                                <div className="mb-0.5 text-ms-2xs text-muted-foreground">Varian / preset</div>
                                <select value={l.variantId ?? ""}
                                  onChange={(e) => updateLine(it.id, l.key, { variantId: e.target.value || null, weightOverride: null })}
                                  className="h-8 w-full rounded border bg-background px-1 text-ms-2xs">
                                  <option value="">{manualHint}</option>
                                   {itemVariants.map((v) => (
                                     <option key={v.id} value={v.id}>{v.label} · {fmtNum(Number(v.weight_per_unit), 3)} {v.unit_label ?? ""}</option>
                                   ))}
                                </select>
                              </label>
                              <button aria-label="Hapus baris" type="button" onClick={() => removeLine(it.id, l.key)}
                                className="mt-4 inline-flex h-7 w-7 items-center justify-center rounded border text-destructive"
                                title="Hapus baris"><X className="h-3 w-3" /></button>
                            </div>
                            <div className="flex flex-wrap items-end gap-ms-1.5">
                              <label className="w-20">
                                <div className="mb-0.5 text-ms-2xs text-muted-foreground">Jumlah unit</div>
                                <NumberInput
                                  value={l.count}
                                  maxFrac={0}
                                  integerOnly
                                  min={1}
                                  max={MAX_COUNT_UNITS}
                                  emptyAs={0}
                                  onChange={(n) => updateLine(it.id, l.key, { count: n })}
                                  onStatusChange={(s) => setFieldStatus(l.key, "count", s)}
                                  className="h-8 w-full rounded border bg-background px-1 text-center text-ms-xs tabular-nums"
                                />
                              </label>
                              <span className="pb-2 text-ms-xs text-muted-foreground">×</span>
                              <label className="w-24">
                                <div className="mb-0.5 text-ms-2xs text-muted-foreground">
                                  {perUnitLabel}{isManual ? "" : " (preset)"}
                                </div>
                                <NumberInput
                                  key={`${l.key}-${l.variantId ?? "m"}`}
                                  value={isManual ? (l.weightOverride ?? 0) : w}
                                  maxFrac={isPcs ? 0 : 3}
                                  integerOnly={isPcs}
                                  min={isManual ? (isPcs ? 1 : 0.001) : undefined}
                                  max={isManual ? (isPcs ? MAX_PER_UNIT_PCS : MAX_PER_UNIT_G) : undefined}
                                  disabled={!isManual}
                                  emptyAs={isManual ? 0 : null}
                                  placeholder={isManual ? perUnitPlaceholder : undefined}
                                  onChange={(n) => updateLine(it.id, l.key, { weightOverride: n })}
                                  onStatusChange={(s) => setFieldStatus(l.key, "weight", s)}
                                  className="h-8 w-full rounded border bg-background px-1 text-center text-ms-xs tabular-nums disabled:opacity-60"
                                />
                              </label>
                              <div className="pb-1 text-ms-2xs font-semibold tabular-nums">
                                 = {fmtNum(roundTo(total, 2), 2)} {(itemVariants.find((v) => v.id === l.variantId)?.unit_label) ?? ""}
                              </div>
                              <span
                                className={
                                  "ml-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-ms-2xs font-medium " +
                                  (rs === "invalid"
                                    ? "bg-destructive/10 text-destructive"
                                    : rs === "partial"
                                    ? "bg-warning/10 text-warning"
                                    : "bg-success/10 text-success")
                                }
                                title={
                                  rs === "invalid"
                                    ? (ev.reason ?? "Input tidak valid")
                                    : rs === "partial"
                                    ? "Input belum lengkap"
                                    : "Input valid"
                                }
                              >
                                {rs === "invalid" ? (
                                  <><AlertTriangle className="h-3 w-3" /> {ev.reason ? "Tidak valid" : "Tidak valid"}</>
                                ) : rs === "partial" ? (
                                  <><AlertTriangle className="h-3 w-3" /> Belum lengkap</>
                                ) : (
                                  <><CheckCircle2 className="h-3 w-3" /> Valid</>
                                )}
                              </span>
                              <label className="ml-auto flex items-center gap-ms-1 pb-2 text-ms-2xs text-muted-foreground">
                                <input type="checkbox" checked={l.split}
                                  onChange={(e) => updateLine(it.id, l.key, { split: e.target.checked })} />
                                Foto/unit
                              </label>
                            </div>
                          </div>
                        );
                      })}
                      <button type="button" onClick={() => addLine(it.id)}
                        className="inline-flex h-7 items-center gap-ms-1 rounded border border-dashed px-ms-2 text-ms-2xs text-muted-foreground">
                        <Plus className="h-3 w-3" /> Tambah varian/baris
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && <div className="p-ms-4 text-center text-ms-xs text-muted-foreground">Tidak ada barang.</div>}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-ms-2">
        <button onClick={requestClose} className="h-9 rounded-md border px-ms-3 text-ms-sm">Batal</button>
        {(() => {
          const canSend =
            summary.validLines > 0 &&
            summary.partialLines === 0 &&
            summary.invalidLines === 0;
          const reason =
            summary.validLines === 0
              ? "Pilih minimal satu barang dengan baris valid"
              : summary.invalidLines > 0
              ? `${summary.invalidLines} baris tidak valid`
              : summary.partialLines > 0
              ? `${summary.partialLines} baris belum lengkap`
              : "";
          return (
            <button
              disabled={busy || !canSend}
              onClick={create}
              title={canSend ? undefined : reason}
              className="inline-flex h-9 items-center gap-ms-1 rounded-md bg-primary px-ms-3 text-ms-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Buat & kirim
            </button>
          );
        })()}
      </div>
    </Modal>
  );
}

// ---------- Share dialog ----------
// ---------- Audit dialog ----------
type AuditRow = {
  task: Task;
  items: number;
  totalRequested: number;
  totalPrepared: number;
  remaining: number;
  issues: string[];
  problemItems: { name: string; qty_requested: number; qty_prepared: number; reason: string }[];
};
function AuditDialog({ tasks, onClose, onOpenTask }: { tasks: Task[]; onClose: () => void; onOpenTask: (t: Task) => void }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filter, setFilter] = useState<"all" | "ok" | "bad" | "fixed">("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "diff_desc" | "diff_asc" | "title">("diff_desc");
  const [waPreview, setWaPreview] = useState<{ text: string; url: string; title: string } | null>(null);
  const RESOLVED_KEY = "tugas.audit.resolved.v1";
  const [resolved, setResolved] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem(RESOLVED_KEY) ?? "{}") ?? {}; }
    catch { return {}; }
  });
  function persistResolved(next: Record<string, string>) {
    setResolved(next);
    try { localStorage.setItem(RESOLVED_KEY, JSON.stringify(next)); } catch {}
  }
  function sigOf(r: AuditRow) {
    return `${r.items}|${r.totalRequested.toFixed(4)}|${r.totalPrepared.toFixed(4)}|${r.problemItems.length}`;
  }
  function markFixed(r: AuditRow) {
    persistResolved({ ...resolved, [r.task.id]: sigOf(r) });
    toast.success("Ditandai sudah dibetulkan");
  }
  function unmarkFixed(id: string) {
    const next = { ...resolved };
    delete next[id];
    persistResolved(next);
  }

  async function run() {
    setLoading(true);
    const ids = tasks.map((t) => t.id);
    if (ids.length === 0) { setRows([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from("prep_task_items")
      .select("id,task_id,name_snapshot,qty_requested,qty_prepared,unit_label")
      .in("task_id", ids);
    if (error) { toast.error(error.message); setLoading(false); return; }
    const byTask = new Map<string, TaskItem[]>();
    for (const it of (data ?? []) as TaskItem[]) {
      const arr = byTask.get(it.task_id) ?? [];
      arr.push(it); byTask.set(it.task_id, arr);
    }
    const result: AuditRow[] = tasks.map((t) => {
      const items = byTask.get(t.id) ?? [];
      let totalRequested = 0, totalPrepared = 0;
      const problemItems: AuditRow["problemItems"] = [];
      const issues: string[] = [];
      const nameCount = new Map<string, number>();
      for (const it of items) {
        const q = Number(it.qty_requested);
        const p = Number(it.qty_prepared ?? 0);
        if (!Number.isFinite(q) || q <= 0) {
          problemItems.push({ name: it.name_snapshot, qty_requested: q, qty_prepared: p, reason: "qty diminta ≤ 0 / invalid" });
        } else if (Number.isFinite(p) && p > q + 1e-9) {
          problemItems.push({ name: it.name_snapshot, qty_requested: q, qty_prepared: p, reason: "qty disiapkan > diminta" });
        }
        if (!it.unit_label || !String(it.unit_label).trim()) {
          problemItems.push({ name: it.name_snapshot, qty_requested: q, qty_prepared: p, reason: "satuan kosong" });
        }
        const key = (it.name_snapshot || "").trim().toLowerCase();
        if (key) nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
        if (Number.isFinite(q)) totalRequested += q;
        if (Number.isFinite(p)) totalPrepared += p;
      }
      // duplicate item names within a single task
      for (const [key, n] of nameCount) {
        if (n > 1) {
          const sample = items.find((it) => (it.name_snapshot || "").trim().toLowerCase() === key);
          problemItems.push({
            name: sample?.name_snapshot ?? key,
            qty_requested: 0,
            qty_prepared: 0,
            reason: `duplikat ${n}× dalam tugas ini`,
          });
        }
      }
      // status-vs-progress anomalies
      const isDone = String(t.status).toLowerCase() === "done" || String(t.status).toLowerCase() === "selesai";
      if (isDone && items.length > 0) {
        if (totalPrepared <= 1e-9) {
          issues.push("status selesai tapi belum ada yang disiapkan");
        } else if (totalPrepared + 1e-9 < totalRequested) {
          const pct = totalRequested > 0 ? Math.round((1 - totalPrepared / totalRequested) * 100) : 0;
          issues.push(`status selesai padahal kurang ${pct}% dari permintaan`);
        }
      }
      // significant shortfall on active tasks (not done) — informational only when very large
      if (!isDone && items.length > 0 && totalRequested > 0) {
        const ratio = totalPrepared / totalRequested;
        if (ratio > 0 && ratio < 0.1) {
          issues.push("progres < 10% — periksa apakah pegawai stuck");
        }
      }
      if (items.length === 0) issues.push("tidak ada item");
      if (problemItems.length > 0) issues.push(`${problemItems.length} item bermasalah`);
      return {
        task: t,
        items: items.length,
        totalRequested,
        totalPrepared,
        remaining: Math.max(0, totalRequested - totalPrepared),
        issues,
        problemItems,
      };
    });
    setRows(result);
    setLoading(false);
  }
  useEffect(() => { void run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const okCount = rows.filter((r) => r.issues.length === 0).length;
  // A row is treated as "bad" only if it still has issues AND has not been
  // marked resolved (with a matching signature — if data changed since being
  // marked, the signature differs and it re-appears).
  function isResolved(r: AuditRow) {
    return resolved[r.task.id] === sigOf(r);
  }
  const badRows = rows.filter((r) => r.issues.length > 0 && !isResolved(r));
  const badCount = badRows.length;
  const resolvedCount = rows.filter((r) => r.issues.length > 0 && isResolved(r)).length;
  const q = query.trim().toLowerCase();
  const visibleRows = rows
    .filter((r) => {
      if (filter === "ok") return r.issues.length === 0;
      if (filter === "bad") return r.issues.length > 0 && !isResolved(r);
      if (filter === "fixed") return r.issues.length > 0 && isResolved(r);
      return true;
    })
    .filter((r) => {
      if (!q) return true;
      if (r.task.title.toLowerCase().includes(q)) return true;
      return r.problemItems.some((p) => p.name.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "newest": return +new Date(b.task.created_at) - +new Date(a.task.created_at);
        case "oldest": return +new Date(a.task.created_at) - +new Date(b.task.created_at);
        case "diff_desc": return b.remaining - a.remaining;
        case "diff_asc": return a.remaining - b.remaining;
        case "title": return a.task.title.localeCompare(b.task.title, "id");
      }
    });

  // Aggregate across ALL audited rows (not just visible) so totals stay stable
  const agg = rows.reduce(
    (acc, r) => {
      acc.items += r.items;
      acc.requested += r.totalRequested;
      acc.prepared += r.totalPrepared;
      acc.remaining += r.remaining;
      return acc;
    },
    { items: 0, requested: 0, prepared: 0, remaining: 0 },
  );
  const progressPct = agg.requested > 0 ? Math.min(100, Math.round((agg.prepared / agg.requested) * 100)) : 0;

  function buildSummaryText() {
    const lines: string[] = [];
    lines.push(`Revalidasi tugas — ${new Date().toLocaleString("id-ID")}`);
    lines.push(`${rows.length} tugas · ${okCount} OK · ${badCount} bermasalah${resolvedCount ? ` · ${resolvedCount} ditandai dibetulkan` : ""}`);
    lines.push(`Total: diminta ${fmtNum(agg.requested, 2)} · disiapkan ${fmtNum(agg.prepared, 2)} · sisa ${fmtNum(agg.remaining, 2)} (${progressPct}%)`);
    lines.push("");
    for (const r of rows) {
      const tag = r.issues.length === 0 ? "OK" : isResolved(r) ? "FIXED" : "BAD";
      lines.push(`[${tag}] ${r.task.title} — ${r.items} item · diminta ${fmtNum(r.totalRequested, 2)} · disiapkan ${fmtNum(r.totalPrepared, 2)} · sisa ${fmtNum(r.remaining, 2)}`);
      if (r.issues.length) lines.push(`  ! ${r.issues.join(" · ")}`);
      for (const p of r.problemItems) {
        lines.push(`  - ${p.name}: diminta ${fmtNum(p.qty_requested, 2)}, disiapkan ${fmtNum(p.qty_prepared, 2)} — ${p.reason}`);
      }
    }
    return lines.join("\n");
  }

  function copySummary() {
    const text = buildSummaryText();
    navigator.clipboard?.writeText(text).then(
      () => toast.success("Ringkasan disalin"),
      () => toast.error("Gagal menyalin"),
    );
  }

  function exportCsv() {
    const header = ["status", "judul", "dibuat", "jumlah_item", "diminta", "disiapkan", "sisa", "issues", "item_bermasalah"];
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      const tag = r.issues.length === 0 ? "ok" : isResolved(r) ? "fixed" : "bad";
      const problems = r.problemItems.map((p) => `${p.name} (${p.reason})`).join(" | ");
      lines.push([
        tag, r.task.title, new Date(r.task.created_at).toISOString(),
        r.items, r.totalRequested, r.totalPrepared, r.remaining,
        r.issues.join(" | "), problems,
      ].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `revalidasi-tugas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function copyRowSummary(r: AuditRow) {
    const tag = r.issues.length === 0 ? "OK" : isResolved(r) ? "FIXED" : "BAD";
    const lines = [
      `[${tag}] ${r.task.title}`,
      `${r.items} item · diminta ${fmtNum(r.totalRequested, 2)} · disiapkan ${fmtNum(r.totalPrepared, 2)} · sisa ${fmtNum(r.remaining, 2)}`,
    ];
    if (r.issues.length) lines.push(`! ${r.issues.join(" · ")}`);
    for (const p of r.problemItems) {
      lines.push(`- ${p.name}: diminta ${fmtNum(p.qty_requested, 2)}, disiapkan ${fmtNum(p.qty_prepared, 2)} — ${p.reason}`);
    }
    lines.push(publicTaskUrl(r.task.share_token));
    navigator.clipboard?.writeText(lines.join("\n")).then(
      () => toast.success("Ringkasan tugas disalin"),
      () => toast.error("Gagal menyalin"),
    );
  }

  function statusLabel(r: AuditRow) {
    if (r.issues.length === 0) return "✅ Aman";
    if (isResolved(r)) return "🟢 Sudah dibetulkan";
    return "⚠️ Perlu dicek";
  }

  function buildTaskWaMessage(r: AuditRow) {
    const url = publicTaskUrl(r.task.share_token);
    const lines: string[] = [];
    lines.push(`${statusLabel(r)} — *${r.task.title}*`);
    lines.push(
      `${r.items} item · diminta *${fmtNum(r.totalRequested, 2)}* · disiapkan *${fmtNum(r.totalPrepared, 2)}* · sisa *${fmtNum(r.remaining, 2)}*`,
    );
    if (r.issues.length > 0) {
      lines.push("");
      lines.push("Catatan:");
      for (const i of r.issues) lines.push(`• ${i}`);
    }
    if (r.problemItems.length > 0) {
      lines.push("");
      lines.push("Item yang perlu dibetulkan:");
      for (const p of r.problemItems) {
        lines.push(
          `• ${p.name} — diminta ${fmtNum(p.qty_requested, 2)}, disiapkan ${fmtNum(p.qty_prepared, 2)} (${p.reason})`,
        );
      }
    }
    lines.push("");
    lines.push(`Buka tugas: ${url}`);
    lines.push(`(PIN dikirim terpisah)`);
    return { text: lines.join("\n"), url };
  }

  async function openWaForRow(r: AuditRow) {
    const { text, url } = buildTaskWaMessage(r);
    const result = await shareToWhatsApp({ text, title: r.task.title, url });
    notifyShareResult(result);
  }

  function buildItemWaMessage(r: AuditRow, item: AuditRow["problemItems"][number]) {
    const url = publicTaskUrl(r.task.share_token);
    const text = [
      `⚠️ Perlu dibetulkan — *${r.task.title}*`,
      "",
      `Item: *${item.name}*`,
      `Diminta: ${fmtNum(item.qty_requested, 2)}`,
      `Disiapkan: ${fmtNum(item.qty_prepared, 2)}`,
      `Masalah: ${item.reason}`,
      "",
      `Buka tugas: ${url}`,
    ].join("\n");
    return { text, url, title: r.task.title };
  }

  function previewWaForItem(r: AuditRow, item: AuditRow["problemItems"][number]) {
    setWaPreview(buildItemWaMessage(r, item));
  }

  return (
    <Modal title="Revalidasi total berat & jumlah" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between text-ms-xs">
        <div className="text-muted-foreground">
          {loading ? "Menghitung…" : `${rows.length} tugas diperiksa — ${okCount} OK, ${badCount} bermasalah${resolvedCount ? `, ${resolvedCount} ditandai dibetulkan` : ""}`}
        </div>
        <div className="flex items-center gap-ms-1">
          <button onClick={copySummary} className="inline-flex h-8 items-center gap-ms-1 rounded-md border px-ms-2 text-ms-xs" title="Salin ringkasan teks">
            <Copy className="h-3.5 w-3.5" /> Salin
          </button>
          <button onClick={exportCsv} className="inline-flex h-8 items-center gap-ms-1 rounded-md border px-ms-2 text-ms-xs" title="Unduh CSV">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <button onClick={() => void run()} className="h-8 rounded-md border px-ms-3 text-ms-xs">Hitung ulang</button>
        </div>
      </div>

      {/* Aggregate summary */}
      {!loading && rows.length > 0 && (
        <div className="mb-3 rounded-md border bg-muted/40 p-ms-2 text-ms-2xs">
          <div className="grid grid-cols-4 gap-ms-2 text-center">
            <div><div className="text-muted-foreground">Item</div><div className="font-semibold tabular-nums">{agg.items}</div></div>
            <div><div className="text-muted-foreground">Diminta</div><div className="font-semibold tabular-nums">{fmtNum(agg.requested, 2)}</div></div>
            <div><div className="text-muted-foreground">Disiapkan</div><div className="font-semibold tabular-nums">{fmtNum(agg.prepared, 2)}</div></div>
            <div><div className="text-muted-foreground">Sisa</div><div className="font-semibold tabular-nums">{fmtNum(agg.remaining, 2)}</div></div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
            <div className="h-full bg-success transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="mt-1 text-right text-ms-2xs text-muted-foreground">{progressPct}% selesai</div>
        </div>
      )}

      {/* Filter + search + sort */}
      <div className="mb-2 flex flex-wrap items-center gap-ms-1 text-ms-xs">
        {([
          ["all", `Semua (${rows.length})`],
          ["bad", `Bermasalah (${badCount})`],
          ["ok", `Aman (${okCount})`],
          ["fixed", `Dibetulkan (${resolvedCount})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`h-7 rounded-md border px-ms-2 ${filter === key ? "bg-accent font-semibold" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-ms-2 text-ms-xs">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari judul tugas atau item bermasalah…"
            className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-ms-xs"
          />
        </div>
        <label className="inline-flex items-center gap-ms-1">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="h-8 rounded-md border bg-background px-1 text-ms-xs"
          >
            <option value="diff_desc">Sisa terbesar</option>
            <option value="diff_asc">Sisa terkecil</option>
            <option value="newest">Terbaru</option>
            <option value="oldest">Terlama</option>
            <option value="title">Judul A→Z</option>
          </select>
        </label>
      </div>
      <div className="max-h-[60vh] space-ms-2 overflow-y-auto">
        {visibleRows.map((r) => {
          const hasIssues = r.issues.length > 0;
          const isFixed = hasIssues && isResolved(r);
          const ok = !hasIssues;
          return (
            <div key={r.task.id} className={`rounded-md border p-ms-2 text-ms-xs ${ok ? "" : isFixed ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5"}`}>
              <div className="flex items-start gap-ms-2">
                {ok || isFixed
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                  : <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-ms-2">
                    <div className="truncate font-semibold">{r.task.title}</div>
                    {isFixed && (
                      <span className="rounded bg-success/15 px-1.5 py-0.5 text-ms-2xs font-medium text-success">Ditandai dibetulkan</span>
                    )}
                  </div>
                  <div className="text-ms-2xs text-muted-foreground">
                     {r.items} item · diminta <b>{fmtNum(r.totalRequested, 2)}</b> · disiapkan <b>{fmtNum(r.totalPrepared, 2)}</b> · sisa <b>{fmtNum(r.remaining, 2)}</b>
                  </div>
                  {r.issues.length > 0 && (
                    <div className="mt-1 text-ms-2xs text-destructive">{r.issues.join(" · ")}</div>
                  )}
                  {r.problemItems.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-ms-2xs">
                      {r.problemItems.map((p, i) => (
                        <li key={i} className="flex items-start justify-between gap-ms-2 text-destructive">
                          <span className="min-w-0 flex-1">
                            • {p.name}: diminta {fmtNum(p.qty_requested, 2)}, disiapkan {fmtNum(p.qty_prepared, 2)} — {p.reason}
                          </span>
                          <button
                            onClick={() => previewWaForItem(r, p)}
                            title={`Kirim detail item "${p.name}" via MCM`}
                            className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded border border-wa/40 bg-wa/10 px-1.5 text-ms-2xs font-medium text-wa-strong hover:bg-wa/20"
                          >
                            <MessageCircle className="h-2.5 w-2.5" /> MCM
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap gap-ms-1.5">
                    <button
                      onClick={() => onOpenTask(r.task)}
                      className="inline-flex h-7 items-center gap-ms-1 rounded-md border px-ms-2 text-ms-2xs"
                    >
                      <ExternalLink className="h-3 w-3" /> Buka detail
                    </button>
                    <button
                      onClick={() => copyRowSummary(r)}
                      className="inline-flex h-7 items-center gap-ms-1 rounded-md border px-ms-2 text-ms-2xs"
                    >
                      <Copy className="h-3 w-3" /> Salin
                    </button>
                    <button
                      onClick={() => void openWaForRow(r)}
                      className="inline-flex h-7 items-center gap-ms-1 rounded-md border border-wa/50 bg-wa/10 px-ms-2 text-ms-2xs font-medium text-wa-strong hover:bg-wa/20"
                      title="Kirim ringkasan lengkap tugas + semua item bermasalah"
                    >
                      <MessageCircle className="h-3 w-3" /> Kirim via MCM
                    </button>
                    {hasIssues && (
                      isFixed ? (
                        <button
                          onClick={() => unmarkFixed(r.task.id)}
                          className="h-7 rounded-md border px-ms-2 text-ms-2xs"
                        >
                          Urungkan tanda
                        </button>
                      ) : (
                        <button
                          onClick={() => markFixed(r)}
                          className="h-7 rounded-md border border-success/40 bg-success/10 px-ms-2 text-ms-2xs font-medium text-success hover:bg-success/20"
                        >
                          Tandai sudah dibetulkan
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {!loading && rows.length === 0 && (
          <div className="rounded-md border p-ms-4 text-center text-ms-xs text-muted-foreground">Belum ada tugas.</div>
        )}
        {!loading && rows.length > 0 && visibleRows.length === 0 && (
          <div className="rounded-md border p-ms-4 text-center text-ms-xs text-muted-foreground">Tidak ada tugas pada filter ini.</div>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <button onClick={onClose} className="h-9 rounded-md border px-ms-3 text-ms-sm">Tutup</button>
      </div>
      {waPreview && (
        <WaPreviewDialog
          initial={waPreview}
          onClose={() => setWaPreview(null)}
        />
      )}
    </Modal>
  );
}

function WaPreviewDialog({
  initial,
  onClose,
}: {
  initial: { text: string; url: string; title: string };
  onClose: () => void;
}) {
  const [text, setText] = useState(initial.text);
  function copy() {
    navigator.clipboard?.writeText(text).then(
      () => toast.success("Pesan disalin"),
      () => toast.error("Gagal menyalin"),
    );
  }
  async function send() {
    const result = await shareToWhatsApp({ text, title: initial.title, url: initial.url });
    notifyShareResult(result);
    onClose();
  }
  return (
    <Modal title="Pratinjau pesan MCM" onClose={onClose}>
      <div className="space-ms-3 text-ms-sm">
        <div className="text-ms-2xs text-muted-foreground">
          Cek isi pesan di bawah. Anda bisa mengedit sebelum mengirim.
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="min-h-[180px] w-full rounded-md border bg-background p-ms-2 text-ms-xs font-mono leading-relaxed"
        />
        <div className="flex flex-wrap justify-end gap-ms-2">
          <button onClick={onClose} className="h-9 rounded-md border px-ms-3 text-ms-xs">Batal</button>
          <button onClick={copy} className="inline-flex h-9 items-center gap-ms-1 rounded-md border px-ms-3 text-ms-xs">
            <Copy className="h-3.5 w-3.5" /> Salin
          </button>
          <button
            onClick={() => void send()}
            className="inline-flex h-9 items-center gap-ms-1 rounded-md bg-wa px-ms-3 text-ms-xs font-semibold text-white hover:opacity-90"
          >
            <MessageCircle className="h-3.5 w-3.5" /> Kirim via MCM
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ShareDialog({ info, onClose }: { info: { token: string; pin: string; title: string }; onClose: () => void }) {
  const url = publicTaskUrl(info.token);
  const message = `Tolong siapkan barang berikut. Buka link, masukkan PIN, foto barangnya & kirim:\n\n${info.title}\n${url}\nPIN: ${info.pin}`;
  async function copy(t: string, label: string) {
    const res = await copyText(t);
    if (res.ok) {
      toast.success(`${label} disalin`);
      return;
    }
    if (res.reason === "denied") {
      toast.error(`Izin clipboard ditolak`, {
        description: `Pilih teks ${label.toLowerCase()} di kotaknya lalu tekan Ctrl/Cmd + C untuk menyalin manual.`,
        duration: 9000,
      });
    } else {
      toast.error(`Browser ini tidak mendukung salin otomatis`, {
        description: `Pilih teks ${label.toLowerCase()} lalu tekan Ctrl/Cmd + C.`,
        duration: 9000,
      });
    }
  }
  const waUrl = buildWhatsAppUrl(message);
  async function onShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const hasWebShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
    if (!hasWebShare) {
      toast.message("Browser ini tak mendukung tombol Bagikan langsung.", {
        description: "Coba 'Buka MCM (WhatsApp Web)' atau Salin pesan lalu tempel di MCM.",
        duration: 7000,
      });
    }
    try {
      const res = await shareToWhatsApp({ text: message, title: info.title, url });
      notifyShareResult(res);
    } catch (err) {
      toast.error(`Gagal membagikan: ${(err as Error)?.message ?? String(err)}`, {
        description: "Salin pesan lalu tempel manual di MCM.",
        duration: 9000,
      });
    }
  }
  function onOpenWa(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const win = window.open(waUrl, "_blank", "noopener,noreferrer");
    if (win) return;
    // Popup diblokir (mis. iframe pratinjau) — coba buka di tab teratas.
    toast.message("Popup diblokir browser.", {
      description: "Membuka MCM di tab ini. Izinkan popup untuk situs ini agar terbuka di tab baru.",
      duration: 8000,
    });
    try { window.top!.location.href = waUrl; }
    catch { window.location.href = waUrl; }
  }
  return (
    <Modal title="Bagikan ke pegawai" onClose={onClose}>
      <div className="space-ms-3 text-ms-sm">
        <div>
          <div className="text-ms-2xs text-muted-foreground">Link</div>
          <div className="flex gap-ms-2">
            <input readOnly value={url} className="h-9 flex-1 rounded-md border bg-background px-ms-2 text-ms-xs" />
            <button aria-label="Salin" onClick={() => void copy(url, "Link")} className="inline-flex h-9 items-center gap-ms-1 rounded-md border px-ms-2 text-ms-xs"><Copy className="h-4 w-4" /></button>
          </div>
        </div>
        <div>
          <div className="text-ms-2xs text-muted-foreground">PIN (kirim terpisah agar lebih aman)</div>
          <div className="flex gap-ms-2">
            <input readOnly value={info.pin} className="h-9 w-32 rounded-md border bg-background px-ms-2 text-center text-ms-base tracking-widest tabular-nums" />
            <button aria-label="Salin" onClick={() => void copy(info.pin, "PIN")} className="inline-flex h-9 items-center gap-ms-1 rounded-md border px-ms-2 text-ms-xs"><Copy className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-ms-2.5 pt-2 sm:grid-cols-2 sm:gap-ms-2 [&>*]:min-h-11">
          <button type="button" onClick={onShare}
            className="inline-flex h-10 items-center justify-center gap-ms-1 rounded-md bg-wa text-ms-sm font-semibold text-white">
            <MessageCircle className="h-4 w-4" /> Bagikan
          </button>
          <a href={waUrl} target="_blank" rel="noreferrer" onClick={onOpenWa}
            className="inline-flex h-10 items-center justify-center gap-ms-1 rounded-md border text-ms-sm">
            <ExternalLink className="h-4 w-4" /> Buka MCM (WhatsApp Web)
          </a>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Task detail with realtime ----------
function TaskDetail({ task, onClose }: { task: Task; onClose: () => void }) {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [busy, setBusy] = useState(false);
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  const [sharePinOpen, setSharePinOpen] = useState(false);

  async function load() {
    const [{ data: i }, { data: s }] = await Promise.all([
      supabase.from("prep_task_items").select("*").eq("task_id", task.id).order("position"),
      supabase.from("prep_submissions").select("*").eq("task_id", task.id).order("submitted_at", { ascending: false }),
    ]);
    setItems((i ?? []) as TaskItem[]);
    setSubs((s ?? []) as Submission[]);
  }
  useEffect(() => {
    void load();
    // Detail task: burst update saat worker menandai banyak item sekaligus.
    const reload = debounce(() => { void load(); }, 300);
    const ch = supabase.channel(`prep:${task.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "prep_submissions", filter: `task_id=eq.${task.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "prep_task_items", filter: `task_id=eq.${task.id}` }, reload)
      .subscribe();
    return () => { reload.cancel(); supabase.removeChannel(ch); };
  }, [task.id]);

  const [completeOpen, setCompleteOpen] = useState(false);

  async function markDone(note: string) {
    setBusy(true);
    const { error } = await supabase
      .from("prep_tasks")
      .update({ status: "done", completed_at: new Date().toISOString(), completion_note: note.trim() || null })
      .eq("id", task.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Tugas ditandai selesai");
    setCompleteOpen(false);
    onClose();
  }

  async function reopenTask() {
    setBusy(true);
    const { error } = await supabase
      .from("prep_tasks")
      .update({ status: "active", completed_at: null, completion_note: null })
      .eq("id", task.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Tugas diaktifkan lagi");
  }

  const url = publicTaskUrl(task.share_token);

  return (
    <Modal title={task.title} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap gap-ms-2">
        <button onClick={() => setSharePinOpen(true)} className="inline-flex h-9 items-center gap-ms-1 rounded-md bg-wa px-ms-3 text-ms-xs font-semibold text-white"><MessageCircle className="h-4 w-4" /> Bagikan link + PIN</button>
        {task.status === "done" ? (
          <button disabled={busy} onClick={reopenTask} className="inline-flex h-9 items-center gap-ms-1 rounded-md border px-ms-3 text-ms-xs">Aktifkan lagi</button>
        ) : (
          <button disabled={busy} onClick={() => setCompleteOpen(true)} className="inline-flex h-9 items-center gap-ms-1 rounded-md border border-success/50 bg-success/10 px-ms-3 text-ms-xs font-semibold text-success hover:bg-success/20 dark:text-success"><CheckCircle2 className="h-4 w-4" /> Tandai selesai</button>
        )}
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-ms-1 rounded-md border px-ms-3 text-ms-xs"><ExternalLink className="h-4 w-4" /> Pratinjau link pegawai</a>
      </div>
      {task.status === "done" && task.completed_at && (
        <div className="mb-3 rounded-lg border border-success/40 bg-success/5 p-ms-3 text-ms-xs">
          <div className="flex items-center gap-ms-1.5 font-semibold text-success dark:text-success">
            <CheckCircle2 className="h-4 w-4" /> Selesai pada {new Date(task.completed_at).toLocaleString("id-ID")}
          </div>
          {task.completion_note && (
            <div className="mt-1 whitespace-pre-wrap text-foreground">{task.completion_note}</div>
          )}
        </div>
      )}
      {completeOpen && (
        <CompleteTaskDialog
          busy={busy}
          onClose={() => setCompleteOpen(false)}
          onConfirm={(n) => { void markDone(n); }}
        />
      )}
      {sharePinOpen && (
        <SharePinDialog title={task.title} url={url} taskId={task.id} shareToken={task.share_token} onClose={() => setSharePinOpen(false)} />
      )}
      <div className="space-ms-3">
        {items.map((it) => {
          const itemSubs = subs.filter((s) => s.task_item_id === it.id);
          const open = !!openItems[it.id];
          return (
            <div key={it.id} className="rounded-xl border bg-card">
              <button
                type="button"
                onClick={() => setOpenItems((p) => ({ ...p, [it.id]: !p[it.id] }))}
                aria-expanded={open}
                className="flex w-full items-center gap-ms-2 p-ms-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ms-sm font-semibold">{it.name_snapshot}</div>
                  <div className="text-ms-2xs text-muted-foreground">{it.category_snapshot ?? "—"} · diminta {it.qty_requested} · disiapkan {it.qty_prepared}</div>
                </div>
                <span className="rounded-full bg-muted px-ms-2 py-0.5 text-ms-2xs">{itemSubs.length} kiriman</span>
                <span className="text-muted-foreground text-ms-xs">{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div className="border-t p-ms-3">
                  {itemSubs.length > 0 ? (
                    <div className="grid grid-cols-2 gap-ms-2 sm:grid-cols-3">
                      {itemSubs.map((s) => <SubmissionCard key={s.id} sub={s} />)}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed bg-background/50 p-ms-3 text-center text-ms-2xs text-muted-foreground">
                      Belum ada kiriman foto/lokasi untuk item ini.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && <div className="rounded-xl border bg-card p-ms-4 text-center text-ms-xs text-muted-foreground">Tidak ada item.</div>}
      </div>
    </Modal>
  );
}

function SubmissionCard({ sub }: { sub: Submission }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { signedUrl(sub.photo_path, 60 * 60).then(setUrl); }, [sub.photo_path]);

  async function shareWA() {
    let files: File[] = [];
    if (url) {
      const f = await urlToFile(url, "foto.jpg");
      if (f) files = [f];
    }
    const text = [
      sub.note ? `Catatan: ${sub.note}` : "",
      sub.location_url ? `Lokasi: ${sub.location_url}` : "",
    ].filter(Boolean).join("\n");
    const result = await shareToWhatsApp({ text: text || "Foto barang", files, url: sub.location_url ?? undefined });
    notifyShareResult(result);
  }

  return (
    <div className="rounded-md border bg-background p-ms-2">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="aspect-square w-full rounded object-cover" /></a>
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded bg-muted text-ms-2xs text-muted-foreground"><ImageIcon className="h-5 w-5" /></div>
      )}
      <div className="mt-1 text-ms-2xs text-muted-foreground">{new Date(sub.submitted_at).toLocaleString("id-ID")}</div>
      {sub.note && <div className="mt-0.5 line-clamp-2 text-ms-2xs">{sub.note}</div>}
      <div className="mt-1 flex gap-ms-1">
        {sub.location_url && /^https:\/\//i.test(sub.location_url) && <a href={sub.location_url} target="_blank" rel="noreferrer" className="inline-flex h-7 flex-1 items-center justify-center gap-ms-1 rounded border text-ms-2xs"><MapPin className="h-3 w-3" /> Lokasi</a>}
        <button onClick={shareWA} className="inline-flex h-7 flex-1 items-center justify-center gap-ms-1 rounded bg-wa text-ms-2xs font-semibold text-white"><MessageCircle className="h-3 w-3" /> MCM</button>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-ms-4">
      <div className={`max-h-[90vh] w-full ${wide ? "max-w-3xl" : "max-w-lg"} overflow-y-auto rounded-t-2xl bg-card p-ms-4 shadow-xl sm:rounded-2xl`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-ms-base font-semibold">{title}</h2>
          <button aria-label="Tutup" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md border"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CompleteTaskDialog({ busy, onClose, onConfirm }: { busy: boolean; onClose: () => void; onConfirm: (note: string) => void | Promise<void> }) {
  const [note, setNote] = useState("");
  return (
    <Modal title="Tandai tugas selesai" onClose={onClose}>
      <div className="space-ms-3 text-ms-sm">
        <div className="rounded-md border border-success/40 bg-success/5 p-ms-2 text-ms-2xs text-success dark:text-success">
          Waktu selesai akan otomatis dicatat: <b>{new Date().toLocaleString("id-ID")}</b>.
        </div>
        <div>
          <label className="text-ms-2xs font-medium text-muted-foreground">Keterangan (opsional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Contoh: Semua siap, dikemas rapi, siap dikirim besok pagi."
            className="mt-1 w-full rounded-md border bg-background p-ms-2 text-ms-sm"
          />
          <div className="mt-1 text-right text-ms-2xs text-muted-foreground">{note.length}/500</div>
        </div>
        <div className="flex justify-end gap-ms-2 pt-1">
          <button onClick={onClose} disabled={busy} className="inline-flex h-9 items-center rounded-md border px-ms-3 text-ms-xs">Batal</button>
          <button
            onClick={() => void onConfirm(note)}
            disabled={busy}
            className="inline-flex h-9 items-center gap-ms-1 rounded-md bg-success px-ms-3 text-ms-xs font-semibold text-white hover:bg-success disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" /> Simpan & tandai selesai
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Variant manager ----------
function VariantsHub({ warehouse, catVariants, masterCategories, uid, onCategoriesChanged, onPickCategory, onClose }: { warehouse: WItem[]; catVariants: CatVariant[]; masterCategories: string[]; uid: string | null; onCategoriesChanged: () => void | Promise<void>; onPickCategory: (cat: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [newCat, setNewCat] = useState("");
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const c of masterCategories) { const v = c.trim(); if (v) set.add(v); }
    for (const w of warehouse) { const c = (w.category ?? "").trim(); if (c) set.add(c); }
    for (const v of catVariants) { const c = v.category.trim(); if (c) set.add(c); }
    const s = q.toLowerCase().trim();
    return Array.from(set).filter((c) => !s || c.toLowerCase().includes(s)).sort();
  }, [warehouse, catVariants, masterCategories, q]);

  async function createCategory(name: string) {
    const v = name.trim();
    if (!v) return;
    if (categories.some((c) => c.toLowerCase() === v.toLowerCase())) {
      // Sudah ada — langsung buka pengelola varian.
      setNewCat("");
      onPickCategory(v);
      return;
    }
    if (!uid) {
      toast.error("Harus login untuk membuat kategori");
      return;
    }
    const { error } = await supabase
      .from("warehouse_categories")
      .insert({ user_id: uid, name: v, position: masterCategories.length });
    if (error && (error as { code?: string }).code !== "23505") {
      toast.error(error.message);
      return;
    }
    setNewCat("");
    await onCategoriesChanged();
    onPickCategory(v);
  }

  return (
    <Modal title="Kelola Varian per Kategori" onClose={onClose}>
      <p className="mb-2 text-ms-2xs text-muted-foreground">
        Atur preset varian penyiapan <b>per kategori</b> (mis. <b>KRISTAL</b> → 1G=0.90 gr, ST=0.40 gr, SPR=0.20 gr).
        Preset otomatis berlaku untuk <b>semua produk</b> di kategori tersebut pada tugas berikutnya. Stok tetap berkurang dari produk induk.
      </p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kategori…"
        className="mb-2 h-9 w-full rounded-md border bg-background px-ms-3 text-ms-sm" />
      <div className="max-h-[55vh] space-y-1.5 overflow-y-auto">
        {categories.map((cat) => {
          const n = catVariants.filter((v) => v.category === cat).length;
          const items = warehouse.filter((w) => (w.category ?? "") === cat).length;
          return (
            <button key={cat} onClick={() => onPickCategory(cat)}
              className="flex w-full items-center justify-between gap-ms-2 rounded-md border bg-background p-ms-2 text-left text-ms-sm hover:bg-muted">
              <div className="min-w-0">
                <div className="truncate font-medium">{cat}</div>
                <div className="text-ms-2xs text-muted-foreground">{items} produk · {n} preset varian</div>
              </div>
              <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
        {categories.length === 0 && <div className="rounded border border-dashed p-ms-4 text-center text-ms-xs text-muted-foreground">Belum ada kategori.</div>}
      </div>
      <div className="mt-3 flex items-end gap-ms-1.5 border-t pt-3">
        <label className="flex-1">
          <div className="text-ms-2xs text-muted-foreground">Tambah kategori baru</div>
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="KRISTAL" className="h-9 w-full rounded border bg-background px-ms-2 text-ms-sm" />
        </label>
        <button
          onClick={() => { void createCategory(newCat); }}
          className="inline-flex h-9 items-center gap-ms-1 rounded-md bg-primary px-ms-3 text-ms-xs font-semibold text-primary-foreground">
          <Plus className="h-3.5 w-3.5" /> Atur
        </button>
      </div>
    </Modal>
  );
}

function CategoryVariantManager({ category, variants, onClose, onChanged }: { category: string; variants: CatVariant[]; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const [rows, setRows] = useState<CatVariant[]>(variants);
  const [label, setLabel] = useState("");
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState("gr");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setRows(variants); }, [variants]);

  async function add() {
    const w = Number(weight);
    if (!label.trim()) return toast.error("Isi label varian (mis. 1G, ST, SPR)");
    {
      const v = validateVariantWeight(w);
      if (!v.ok) return toast.error(v.error);
    }
    const ok = await confirmDialog({
      title: "Simpan preset varian?",
      description: `Kategori "${category}" — ${label.trim()} = ${w} ${unit.trim() || "gr"} per unit. Preset ini akan berlaku untuk semua produk berkategori ${category}.`,
      confirmText: "Simpan",
    });
    if (!ok) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("warehouse_category_variants").insert({
      user_id: u.user?.id, category,
      label: label.trim(), weight_per_unit: w, unit_label: unit.trim() || null,
      position: rows.length,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setLabel(""); setWeight("");
    await onChanged();
    toast.success("Preset varian disimpan");
  }

  async function remove(id: string) {
    if (!confirm("Hapus preset varian ini?")) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("warehouse_category_variants").delete().eq("id", id);
    if (error) return toast.error(error.message);
    await onChanged();
  }

  async function updateRow(id: string, patch: Partial<CatVariant>) {
    if (patch.weight_per_unit !== undefined) {
      const v = validateVariantWeight(patch.weight_per_unit);
      if (!v.ok) {
        toast.error(v.error);
        await onChanged();
        return;
      }
    }
    if (patch.label !== undefined) {
      const v = validateVariantLabel(patch.label);
      if (!v.ok) {
        toast.error(v.error);
        await onChanged();
        return;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("warehouse_category_variants").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    await onChanged();
  }

  return (
    <Modal title={`Preset Varian: ${category}`} onClose={onClose}>
      <p className="mb-2 text-ms-2xs text-muted-foreground">
        Preset ini disimpan permanen dan otomatis tersedia untuk <b>semua produk</b> berkategori <b>{category}</b> pada tugas berikutnya.
      </p>
      <div className="space-y-1.5">
        {rows.map((v) => (
          <div key={v.id} className="flex items-center gap-ms-1.5 rounded border bg-background p-ms-1.5">
            <input defaultValue={v.label} onBlur={(e) => e.target.value !== v.label && updateRow(v.id, { label: e.target.value })}
              className="h-8 w-20 rounded border bg-background px-1 text-ms-xs" placeholder="Label" />
            <input type="number" step="0.01" defaultValue={Number(v.weight_per_unit)}
              onBlur={(e) => Number(e.target.value) !== Number(v.weight_per_unit) && updateRow(v.id, { weight_per_unit: Number(e.target.value) })}
              className="h-8 w-20 rounded border bg-background px-1 text-center text-ms-xs tabular-nums" />
            <input defaultValue={v.unit_label ?? ""} onBlur={(e) => (e.target.value || null) !== v.unit_label && updateRow(v.id, { unit_label: e.target.value || null })}
              className="h-8 w-16 rounded border bg-background px-1 text-ms-xs" placeholder="gr" />
            <button aria-label="Hapus" onClick={() => remove(v.id)} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded border text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {rows.length === 0 && <div className="rounded border border-dashed p-ms-3 text-center text-ms-2xs text-muted-foreground">Belum ada preset. Tambah di bawah.</div>}
      </div>
      <div className="mt-3 flex items-end gap-ms-1.5 border-t pt-3">
        <label className="flex-1">
          <div className="text-ms-2xs text-muted-foreground">Label</div>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="1G" className="h-9 w-full rounded border bg-background px-ms-2 text-ms-sm" />
        </label>
        <label className="w-24">
          <div className="text-ms-2xs text-muted-foreground">Berat/unit</div>
          <NumericTextField value={weight} onValueChange={setWeight} step={0.01} decimal={true} className="h-9 w-full rounded border bg-background px-ms-2 text-center text-ms-sm tabular-nums" placeholder="0.90" />
        </label>
        <label className="w-16">
          <div className="text-ms-2xs text-muted-foreground">Satuan</div>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="gr" className="h-9 w-full rounded border bg-background px-ms-2 text-ms-sm" />
        </label>
        <button disabled={busy} onClick={add} className="inline-flex h-9 items-center gap-ms-1 rounded-md bg-primary px-ms-3 text-ms-xs font-semibold text-primary-foreground disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" /> Simpan
        </button>
      </div>
    </Modal>
  );
}

function VariantManager({ item, variants, onClose, onChanged }: { item: WItem; variants: Variant[]; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const [rows, setRows] = useState<Variant[]>(variants);
  const [label, setLabel] = useState("");
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState("gr");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setRows(variants); }, [variants]);

  async function add() {
    const w = Number(weight);
    if (!label.trim()) return toast.error("Isi label varian (mis. 1G, ST, SPR)");
    {
      const v = validateVariantWeight(w);
      if (!v.ok) return toast.error(v.error);
    }
    const ok = await confirmDialog({
      title: "Simpan varian produk?",
      description: `${item.name} — ${label.trim()} = ${w} ${unit.trim() || "gr"} per unit.`,
      confirmText: "Simpan",
    });
    if (!ok) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("warehouse_item_variants").insert({
      user_id: u.user?.id, warehouse_item_id: item.id,
      label: label.trim(), weight_per_unit: w, unit_label: unit.trim() || null,
      position: rows.length,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setLabel(""); setWeight("");
    await onChanged();
    toast.success("Varian ditambahkan");
  }

  async function remove(id: string) {
    if (!confirm("Hapus varian ini?")) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("warehouse_item_variants").delete().eq("id", id);
    if (error) return toast.error(error.message);
    await onChanged();
  }

  async function updateRow(id: string, patch: Partial<Variant>) {
    if (patch.weight_per_unit !== undefined) {
      const v = validateVariantWeight(patch.weight_per_unit);
      if (!v.ok) {
        toast.error(v.error);
        await onChanged();
        return;
      }
    }
    if (patch.label !== undefined) {
      const v = validateVariantLabel(patch.label);
      if (!v.ok) {
        toast.error(v.error);
        await onChanged();
        return;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("warehouse_item_variants").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    await onChanged();
  }

  return (
    <Modal title={`Varian: ${item.name}`} onClose={onClose}>
      <p className="mb-2 text-ms-2xs text-muted-foreground">
        Buat preset varian penyiapan untuk produk ini (mis. <b>1G</b> = 0.90 gr, <b>ST</b> = 0.40 gr, <b>SPR</b> = 0.20 gr).
        Saat membuat tugas, pilih varian + jumlah unit — sistem akan menghitung total berat dan mengurangi stok dari produk induk <b>{item.name}</b>.
      </p>
      <div className="space-y-1.5">
        {rows.map((v) => (
          <div key={v.id} className="flex items-center gap-ms-1.5 rounded border bg-background p-ms-1.5">
            <input defaultValue={v.label} onBlur={(e) => e.target.value !== v.label && updateRow(v.id, { label: e.target.value })}
              className="h-8 w-20 rounded border bg-background px-1 text-ms-xs" placeholder="Label" />
            <input type="number" step="0.01" defaultValue={Number(v.weight_per_unit)}
              onBlur={(e) => Number(e.target.value) !== Number(v.weight_per_unit) && updateRow(v.id, { weight_per_unit: Number(e.target.value) })}
              className="h-8 w-20 rounded border bg-background px-1 text-center text-ms-xs tabular-nums" />
            <input defaultValue={v.unit_label ?? ""} onBlur={(e) => (e.target.value || null) !== v.unit_label && updateRow(v.id, { unit_label: e.target.value || null })}
              className="h-8 w-16 rounded border bg-background px-1 text-ms-xs" placeholder="gr" />
            <button aria-label="Hapus" onClick={() => remove(v.id)} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded border text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {rows.length === 0 && <div className="rounded border border-dashed p-ms-3 text-center text-ms-2xs text-muted-foreground">Belum ada varian. Tambah di bawah.</div>}
      </div>
      <div className="mt-3 flex items-end gap-ms-1.5 border-t pt-3">
        <label className="flex-1">
          <div className="text-ms-2xs text-muted-foreground">Label</div>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="1G" className="h-9 w-full rounded border bg-background px-ms-2 text-ms-sm" />
        </label>
        <label className="w-24">
          <div className="text-ms-2xs text-muted-foreground">Berat/unit</div>
          <NumericTextField value={weight} onValueChange={setWeight} step={0.01} decimal={true} className="h-9 w-full rounded border bg-background px-ms-2 text-center text-ms-sm tabular-nums" placeholder="0.90" />
        </label>
        <label className="w-16">
          <div className="text-ms-2xs text-muted-foreground">Satuan</div>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="gr" className="h-9 w-full rounded border bg-background px-ms-2 text-ms-sm" />
        </label>
        <button disabled={busy} onClick={add} className="inline-flex h-9 items-center gap-ms-1 rounded-md bg-primary px-ms-3 text-ms-xs font-semibold text-primary-foreground disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" /> Tambah
        </button>
      </div>
    </Modal>
  );
}