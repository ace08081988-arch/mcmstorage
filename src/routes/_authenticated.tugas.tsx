import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { genPin, genShareToken, publicTaskUrl, signedUrl } from "@/lib/prep";
import { shareToWhatsApp, urlToFile, buildWhatsAppUrl, notifyShareResult } from "@/lib/share-wa";
import { fmtItemQty } from "@/lib/stock-format";
import { Plus, Trash2, Send, Copy, MessageCircle, Image as ImageIcon, MapPin, ExternalLink, X, Settings2, ShieldCheck, CheckCircle2, AlertTriangle, ShieldAlert, Search, Download, ArrowUpDown, RotateCcw } from "lucide-react";
import { confirm as confirmDialog } from "@/lib/confirm";
import { validateVariantWeight, validateVariantLabel } from "@/lib/variant-validation";
import { SiapkanSendiriSection } from "@/components/SiapkanSendiriSection";
import { StaffContactsPanel } from "@/components/StaffContactsPanel";
import { SharePinDialog } from "@/components/tugas/SharePinDialog";

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
type Task = { id: string; title: string; note: string | null; share_token: string; status: string; expires_at: string; created_at: string };
type TaskItem = { id: string; task_id: string; name_snapshot: string; category_snapshot: string | null; qty_requested: number; qty_prepared: number; unit_label: string | null; ref_photo_path: string | null; warehouse_item_id: string | null };
type Submission = { id: string; task_id: string; task_item_id: string; photo_path: string | null; location_url: string | null; note: string | null; submitted_at: string };
type PinAlert = { id: string; task_id: string; share_token: string; failure_count: number; window_start: string; window_end: string; created_at: string };

function TugasPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [mode, setMode] = useState<"self" | "staff">("self");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [warehouse, setWarehouse] = useState<WItem[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [catVariants, setCatVariants] = useState<CatVariant[]>([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [createdInfo, setCreatedInfo] = useState<{ token: string; pin: string; title: string } | null>(null);
  const [openVariantsHub, setOpenVariantsHub] = useState(false);
  const [manageCategoryFor, setManageCategoryFor] = useState<string | null>(null);
  const [openAudit, setOpenAudit] = useState(false);
  const [pinAlerts, setPinAlerts] = useState<PinAlert[]>([]);
  const [sharePinFor, setSharePinFor] = useState<Task | null>(null);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null)); }, []);

  async function load() {
    if (!uid) return;
    const [{ data: t }, { data: w }, { data: v }, { data: cv }] = await Promise.all([
      supabase.from("prep_tasks").select("*").order("created_at", { ascending: false }),
      supabase.from("warehouse_items").select("id,name,category,image_path,stock_base,base_unit,package_type,package_size").order("name"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)("warehouse_item_variants").select("*").order("position"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)("warehouse_category_variants").select("*").order("position"),
    ]);
    setTasks((t ?? []) as Task[]);
    setWarehouse((w ?? []) as WItem[]);
    setVariants((v ?? []) as Variant[]);
    setCatVariants((cv ?? []) as CatVariant[]);
  }
  useEffect(() => { void load(); }, [uid]);

  async function loadPinAlerts() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from as any)("prep_pin_alerts")
      .select("id,task_id,share_token,failure_count,window_start,window_end,created_at")
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false });
    setPinAlerts((data ?? []) as PinAlert[]);
  }
  useEffect(() => {
    if (!uid) return;
    void loadPinAlerts();
    const id = setInterval(() => { void loadPinAlerts(); }, 30_000);
    return () => clearInterval(id);
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
    const { error } = await supabase.from("prep_tasks").delete().eq("id", id);
    if (error) return toast.error(error.message);
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
    <div className="mx-auto max-w-4xl px-3 py-4">
      <div className="mb-3">
        <h1 className="text-lg font-semibold">Penyiapan Produk</h1>
        <p className="text-[11px] text-muted-foreground">Pilih cara menyiapkan: kerjakan sendiri, atau kirim tugas ke pegawai.</p>
      </div>
      <div className="mb-3 inline-flex rounded-lg border bg-card p-1 text-xs shadow-sm">
        <button
          onClick={() => setMode("self")}
          className={`rounded-md px-3 py-1.5 font-semibold transition ${mode === "self" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
        >Siapkan Sendiri</button>
        <button
          onClick={() => setMode("staff")}
          className={`rounded-md px-3 py-1.5 font-semibold transition ${mode === "staff" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
        >Via Pegawai</button>
      </div>

      {mode === "self" ? (
        <SiapkanSendiriSection uid={uid} />
      ) : (
        <ViaPegawaiBlock />
      )}
    </div>
  );

  function ViaPegawaiBlock() {
    return (
      <>
      <StaffContactsPanel uid={uid} />

      <div className="mt-3 mb-3 flex items-center justify-between">
        <h2 className="mt-3 text-sm font-semibold">Tugas untuk Pegawai</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpenVariantsHub(true)} className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-xs font-semibold">
            <Settings2 className="h-4 w-4" /> Kelola Varian
          </button>
          <button onClick={() => setOpenAudit(true)} className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-xs font-semibold">
            <ShieldCheck className="h-4 w-4" /> Revalidasi
          </button>
          <button onClick={() => setOpenCreate(true)} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">
            <Plus className="h-4 w-4" /> Buat tugas
          </button>
        </div>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">Pilih barang yang perlu disiapkan pegawai, kirim link + PIN via WhatsApp. Foto & lokasi yang dikirim pegawai muncul otomatis di sini.</p>
      {pinAlerts.length > 0 && (
        <div className="mb-3 space-y-2">
          {pinAlerts.map((a) => {
            const task = tasks.find((t) => t.id === a.task_id);
            const minutes = Math.max(
              1,
              Math.round((new Date(a.window_end).getTime() - new Date(a.window_start).getTime()) / 60000),
            );
            return (
              <div key={a.id} className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-destructive">Lonjakan PIN gagal terdeteksi</div>
                  <div className="mt-0.5 text-foreground">
                    <b>{a.failure_count}× percobaan salah</b> dalam ~{minutes} menit pada tugas <b>“{task?.title ?? a.share_token}”</b>.
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">Terakhir: {new Date(a.window_end).toLocaleString("id-ID")}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {task && (
                      <button onClick={() => setOpenTask(task)} className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-[11px] font-medium">Buka tugas</button>
                    )}
                    <button onClick={() => ackPinAlert(a.id)} className="inline-flex h-7 items-center gap-1 rounded-md bg-destructive px-2 text-[11px] font-medium text-destructive-foreground">Sudah ditangani</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-400">
        ⚖️ <b>Anda</b> yang menentukan <b>berat / jumlah</b> yang harus disiapkan per item (boleh desimal, mis. <b>0.90</b> gram untuk eceran kristal). Pegawai cukup mengirim <b>foto + lokasi</b>. Stok gudang induk otomatis berkurang sesuai angka yang Anda isi (mis. 100 − 0.90 = 99.10).
      </div>

      <div className="space-y-2">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-xl border bg-card p-3 shadow-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{t.title}</div>
              <div className="text-[11px] text-muted-foreground">Dibuat {new Date(t.created_at).toLocaleString("id-ID")} · Status {t.status}</div>
            </div>
            <button onClick={() => setOpenTask(t)} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs">Buka</button>
            <button
              onClick={() => setSharePinFor(t)}
              title="Bagikan link + PIN via WhatsApp"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#25D366]/40 bg-[#25D366]/10 text-[#1ea952] hover:bg-[#25D366]/20"
            >
              <MessageCircle className="h-4 w-4" />
            </button>
            <button
              onClick={() => resetPinAttempts(t.share_token, t.title)}
              title="Reset percobaan PIN (pemilik / admin)"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button onClick={() => removeTask(t.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-destructive" title="Hapus tugas"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {tasks.length === 0 && <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">Belum ada tugas. Klik "Buat tugas".</div>}
      </div>

      {openCreate && (
        <CreateDialog
          warehouse={warehouse}
          variants={effectiveVariants}
          onVariantsChanged={load}
          onClose={() => setOpenCreate(false)}
          onCreated={(info) => { setOpenCreate(false); setCreatedInfo(info); void load(); }}
        />
      )}
      {createdInfo && <ShareDialog info={createdInfo} onClose={() => setCreatedInfo(null)} />}
      {openTask && <TaskDetail task={openTask} onClose={() => { setOpenTask(null); void load(); }} />}
      {sharePinFor && (
        <SharePinDialog
          title={sharePinFor.title}
          url={publicTaskUrl(sharePinFor.share_token)}
          onClose={() => setSharePinFor(null)}
        />
      )}
      {openVariantsHub && (
        <VariantsHub
          warehouse={warehouse}
          catVariants={catVariants}
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
function evaluateLine(line: Line, variants: Variant[]): {
  status: "valid" | "partial" | "invalid";
  weight: number;
  count: number;
  total: number;
} {
  const weight = lineWeight(line, variants);
  const count = Number(line.count);
  const cOk = Number.isFinite(count) && count > 0;
  const wOk = Number.isFinite(weight) && weight > 0;
  let status: "valid" | "partial" | "invalid";
  if (!cOk || !wOk) status = "invalid";
  else status = "valid";
  const total = status === "valid" ? weight * count : 0;
  return { status, weight: wOk ? weight : 0, count: cOk ? count : 0, total };
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
    return n != null && Number.isFinite(n) ? "valid" : "invalid";
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
    status === "partial" ? "ring-1 ring-amber-400 border-amber-400" :
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
  const [title, setTitle] = useState("Tugas siapkan barang");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState(genPin());
  const [phone, setPhone] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("prep:last_phone") ?? "";
  });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, PickedEntry>>({});
  const [manageVariantsFor, setManageVariantsFor] = useState<WItem | null>(null);
  const [busy, setBusy] = useState(false);
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
    let linesWithoutPhoto = 0;
    const itemsWithoutPhoto: string[] = [];
    for (const entry of Object.values(picked)) {
      const hasPhoto = !!entry.item.image_path;
      if (!hasPhoto) itemsWithoutPhoto.push(entry.item.name);
      for (const l of entry.lines) {
        totalLines++;
        if (!hasPhoto) linesWithoutPhoto++;
        // Satu selector tunggal — ringkasan & badge per-baris memakai
        // hasil yang sama, tidak ada lagi ketergantungan ke lineStatus.
        const ev = evaluateLine(l, variants);
        if (ev.status === "valid") {
          validLines++;
          totalWeight += ev.total;
          // Foto referensi opsional → baris valid selalu dihitung siap kirim.
          readyLines++;
          readyWeight += ev.total;
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
    if (error) { setBusy(false); return toast.error(error.message); }
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
    <Modal title="Buat tugas baru" onClose={onClose}>
      {manageVariantsFor && (
        <VariantManager
          item={manageVariantsFor}
          variants={variants.filter((v) => v.warehouse_item_id === manageVariantsFor.id)}
          onClose={() => setManageVariantsFor(null)}
          onChanged={onVariantsChanged}
        />
      )}
      <div className="space-y-3 text-sm">
        <div className="rounded-md border bg-muted/40 p-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold">Ringkasan</span>
            <span><b>{summary.items}</b> barang · <b>{summary.totalLines}</b> baris</span>
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> {summary.validLines} valid
            </span>
            {summary.partialLines > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600">
                <AlertTriangle className="h-3 w-3" /> {summary.partialLines} belum lengkap
              </span>
            )}
            {summary.invalidLines > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">
                <AlertTriangle className="h-3 w-3" /> {summary.invalidLines} tidak valid
              </span>
            )}
            {summary.linesWithoutPhoto > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive"
                title={`Belum ada foto: ${summary.itemsWithoutPhoto.join(", ")}`}
              >
                <ImageIcon className="h-3 w-3" /> {summary.itemsWithoutPhoto.length} barang tanpa foto
              </span>
            )}
            <span
              className="ml-auto tabular-nums"
              title={`Hanya baris valid yang sudah punya foto (${summary.readyLines} dari ${summary.validLines} baris valid).`}
            >
              Siap dikirim: <b>{fmtNum(summary.readyWeight, 2)}</b>{" "}
              <span className="text-muted-foreground">({summary.readyLines} baris)</span>
            </span>
          </div>
          {summary.linesWithoutPhoto > 0 && (
            <div className="mt-1 flex items-start gap-1 text-[10px] text-amber-600">
              <ImageIcon className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                <b>{summary.itemsWithoutPhoto.length}</b> barang belum punya foto referensi — tugas tetap bisa dikirim, hanya tanpa lampiran foto:{" "}
                <span className="text-muted-foreground">{summary.itemsWithoutPhoto.join(", ")}</span>
              </span>
            </div>
          )}
        </div>
        <label className="block">
          <div className="mb-1 text-[11px] text-muted-foreground">Judul</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
        </label>
        <label className="block">
          <div className="mb-1 text-[11px] text-muted-foreground">Catatan untuk pegawai (opsional)</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-md border bg-background p-2 text-sm" />
        </label>
        <div className="flex items-center gap-2">
          <label className="flex-1">
            <div className="mb-1 text-[11px] text-muted-foreground">PIN (4–8 digit)</div>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} className="h-10 w-full rounded-md border bg-background px-3 text-center text-lg tracking-widest tabular-nums" />
          </label>
          <button onClick={() => setPin(genPin())} className="h-10 rounded-md border px-3 text-xs">Acak</button>
        </div>

        <label className="block">
          <div className="mb-1 text-[11px] text-muted-foreground">Nomor WhatsApp pegawai (opsional, format: 628xxxx)</div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, "").slice(0, 16))}
            placeholder="62812xxxxxxx"
            inputMode="tel"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">Jika diisi, WhatsApp akan otomatis terbuka berisi link & PIN setelah tugas dibuat.</div>
        </label>

        <div className="border-t pt-3">
          <div className="mb-2 flex items-center gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari barang…" className="h-9 flex-1 rounded-md border bg-background px-2 text-sm" />
            <span className="text-[11px] text-muted-foreground">{Object.keys(picked).length} dipilih</span>
          </div>
          <div className="max-h-96 space-y-1 overflow-y-auto rounded-md border p-1">
            {filtered.map((it) => {
              const p = picked[it.id];
              const itemVariants = variants.filter((v) => v.warehouse_item_id === it.id);
              const missingPhoto = !it.image_path;
              const warnPhoto = !!p && missingPhoto;
              return (
                <div
                  key={it.id}
                  className={`rounded p-1.5 ${
                    warnPhoto
                      ? "border border-destructive/40 bg-destructive/5"
                      : p
                      ? "bg-primary/5"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={!!p} onChange={() => toggle(it)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{it.name}</span>
                        {missingPhoto && (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-destructive/10 px-1 py-0.5 text-[9px] font-medium text-destructive"
                            title="Barang ini belum punya foto — tidak bisa dikirim ke WA"
                          >
                            <ImageIcon className="h-2.5 w-2.5" /> Tanpa foto
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {it.category ?? "—"} · stok {fmtItemQty(it.stock_base, { name: it.name, base_unit: (it.base_unit ?? "pcs") as "g" | "pcs", package_type: it.package_type ?? "", package_size: Number(it.package_size) || 0 })}
                        {itemVariants.length > 0 && <span className="ml-1">· {itemVariants.length} varian</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => setManageVariantsFor(it)}
                      className="inline-flex h-7 items-center gap-1 rounded border px-2 text-[10px] text-muted-foreground hover:text-foreground"
                      title="Kelola varian (preset berat)">
                      <Settings2 className="h-3 w-3" /> Varian
                    </button>
                  </div>
                  {p && (
                    <div className="mt-2 space-y-1.5 pl-6">
                      {p.lines.map((l) => {
                        const ev = evaluateLine(l, variants);
                        const w = ev.weight;
                        const total = ev.total;
                        const isManual = !l.variantId;
                        const rs = ev.status;
                        return (
                          <div key={l.key} className="space-y-1.5 rounded border bg-background/60 p-2">
                            <div className="flex items-start gap-1.5">
                              <label className="flex-1 min-w-[120px]">
                                <div className="mb-0.5 text-[10px] text-muted-foreground">Varian / preset</div>
                                <select value={l.variantId ?? ""}
                                  onChange={(e) => updateLine(it.id, l.key, { variantId: e.target.value || null, weightOverride: null })}
                                  className="h-8 w-full rounded border bg-background px-1 text-[11px]">
                                  <option value="">Manual — isi berat di kolom kanan</option>
                                   {itemVariants.map((v) => (
                                     <option key={v.id} value={v.id}>{v.label} · {fmtNum(Number(v.weight_per_unit), 3)} {v.unit_label ?? ""}</option>
                                   ))}
                                </select>
                              </label>
                              <button type="button" onClick={() => removeLine(it.id, l.key)}
                                className="mt-4 inline-flex h-7 w-7 items-center justify-center rounded border text-destructive"
                                title="Hapus baris"><X className="h-3 w-3" /></button>
                            </div>
                            <div className="flex flex-wrap items-end gap-1.5">
                              <label className="w-20">
                                <div className="mb-0.5 text-[10px] text-muted-foreground">Jumlah unit</div>
                                <NumberInput
                                  value={l.count}
                                  maxFrac={3}
                                  emptyAs={0}
                                  onChange={(n) => updateLine(it.id, l.key, { count: n })}
                                  onStatusChange={(s) => setFieldStatus(l.key, "count", s)}
                                  className="h-8 w-full rounded border bg-background px-1 text-center text-xs tabular-nums"
                                />
                              </label>
                              <span className="pb-2 text-xs text-muted-foreground">×</span>
                              <label className="w-24">
                                <div className="mb-0.5 text-[10px] text-muted-foreground">
                                  Berat / unit{isManual ? "" : " (preset)"}
                                </div>
                                <NumberInput
                                  key={`${l.key}-${l.variantId ?? "m"}`}
                                  value={isManual ? (l.weightOverride ?? 0) : w}
                                  maxFrac={3}
                                  disabled={!isManual}
                                  emptyAs={isManual ? 0 : null}
                                  placeholder={isManual ? "isi manual" : undefined}
                                  onChange={(n) => updateLine(it.id, l.key, { weightOverride: n })}
                                  onStatusChange={(s) => setFieldStatus(l.key, "weight", s)}
                                  className="h-8 w-full rounded border bg-background px-1 text-center text-xs tabular-nums disabled:opacity-60"
                                />
                              </label>
                              <div className="pb-1 text-[11px] font-semibold tabular-nums">
                                 = {fmtNum(roundTo(total, 2), 2)} {(itemVariants.find((v) => v.id === l.variantId)?.unit_label) ?? ""}
                              </div>
                              <span
                                className={
                                  "ml-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium " +
                                  (rs === "invalid"
                                    ? "bg-destructive/10 text-destructive"
                                    : rs === "partial"
                                    ? "bg-amber-500/10 text-amber-600"
                                    : "bg-emerald-500/10 text-emerald-600")
                                }
                                title={
                                  rs === "invalid"
                                    ? "Input tidak valid"
                                    : rs === "partial"
                                    ? "Input belum lengkap"
                                    : "Input valid"
                                }
                              >
                                {rs === "invalid" ? (
                                  <><AlertTriangle className="h-3 w-3" /> Tidak valid</>
                                ) : rs === "partial" ? (
                                  <><AlertTriangle className="h-3 w-3" /> Belum lengkap</>
                                ) : (
                                  <><CheckCircle2 className="h-3 w-3" /> Valid</>
                                )}
                              </span>
                              <label className="ml-auto flex items-center gap-1 pb-2 text-[10px] text-muted-foreground">
                                <input type="checkbox" checked={l.split}
                                  onChange={(e) => updateLine(it.id, l.key, { split: e.target.checked })} />
                                Foto/unit
                              </label>
                            </div>
                          </div>
                        );
                      })}
                      <button type="button" onClick={() => addLine(it.id)}
                        className="inline-flex h-7 items-center gap-1 rounded border border-dashed px-2 text-[10px] text-muted-foreground">
                        <Plus className="h-3 w-3" /> Tambah varian/baris
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && <div className="p-4 text-center text-xs text-muted-foreground">Tidak ada barang.</div>}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="h-9 rounded-md border px-3 text-sm">Batal</button>
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
              className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
      <div className="mb-3 flex items-center justify-between text-xs">
        <div className="text-muted-foreground">
          {loading ? "Menghitung…" : `${rows.length} tugas diperiksa — ${okCount} OK, ${badCount} bermasalah${resolvedCount ? `, ${resolvedCount} ditandai dibetulkan` : ""}`}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={copySummary} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs" title="Salin ringkasan teks">
            <Copy className="h-3.5 w-3.5" /> Salin
          </button>
          <button onClick={exportCsv} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs" title="Unduh CSV">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <button onClick={() => void run()} className="h-8 rounded-md border px-3 text-xs">Hitung ulang</button>
        </div>
      </div>

      {/* Aggregate summary */}
      {!loading && rows.length > 0 && (
        <div className="mb-3 rounded-md border bg-muted/40 p-2 text-[11px]">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div><div className="text-muted-foreground">Item</div><div className="font-semibold tabular-nums">{agg.items}</div></div>
            <div><div className="text-muted-foreground">Diminta</div><div className="font-semibold tabular-nums">{fmtNum(agg.requested, 2)}</div></div>
            <div><div className="text-muted-foreground">Disiapkan</div><div className="font-semibold tabular-nums">{fmtNum(agg.prepared, 2)}</div></div>
            <div><div className="text-muted-foreground">Sisa</div><div className="font-semibold tabular-nums">{fmtNum(agg.remaining, 2)}</div></div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="mt-1 text-right text-[10px] text-muted-foreground">{progressPct}% selesai</div>
        </div>
      )}

      {/* Filter + search + sort */}
      <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
        {([
          ["all", `Semua (${rows.length})`],
          ["bad", `Bermasalah (${badCount})`],
          ["ok", `Aman (${okCount})`],
          ["fixed", `Dibetulkan (${resolvedCount})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`h-7 rounded-md border px-2 ${filter === key ? "bg-accent font-semibold" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari judul tugas atau item bermasalah…"
            className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-xs"
          />
        </div>
        <label className="inline-flex items-center gap-1">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="h-8 rounded-md border bg-background px-1 text-xs"
          >
            <option value="diff_desc">Sisa terbesar</option>
            <option value="diff_asc">Sisa terkecil</option>
            <option value="newest">Terbaru</option>
            <option value="oldest">Terlama</option>
            <option value="title">Judul A→Z</option>
          </select>
        </label>
      </div>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {visibleRows.map((r) => {
          const hasIssues = r.issues.length > 0;
          const isFixed = hasIssues && isResolved(r);
          const ok = !hasIssues;
          return (
            <div key={r.task.id} className={`rounded-md border p-2 text-xs ${ok ? "" : isFixed ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
              <div className="flex items-start gap-2">
                {ok || isFixed
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  : <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate font-semibold">{r.task.title}</div>
                    {isFixed && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Ditandai dibetulkan</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                     {r.items} item · diminta <b>{fmtNum(r.totalRequested, 2)}</b> · disiapkan <b>{fmtNum(r.totalPrepared, 2)}</b> · sisa <b>{fmtNum(r.remaining, 2)}</b>
                  </div>
                  {r.issues.length > 0 && (
                    <div className="mt-1 text-[10px] text-destructive">{r.issues.join(" · ")}</div>
                  )}
                  {r.problemItems.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[10px]">
                      {r.problemItems.map((p, i) => (
                        <li key={i} className="flex items-start justify-between gap-2 text-destructive">
                          <span className="min-w-0 flex-1">
                            • {p.name}: diminta {fmtNum(p.qty_requested, 2)}, disiapkan {fmtNum(p.qty_prepared, 2)} — {p.reason}
                          </span>
                          <button
                            onClick={() => previewWaForItem(r, p)}
                            title={`Kirim detail item "${p.name}" via WhatsApp`}
                            className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded border border-[#25D366]/40 bg-[#25D366]/10 px-1.5 text-[10px] font-medium text-[#1ea952] hover:bg-[#25D366]/20"
                          >
                            <MessageCircle className="h-2.5 w-2.5" /> WA
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      onClick={() => onOpenTask(r.task)}
                      className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]"
                    >
                      <ExternalLink className="h-3 w-3" /> Buka detail
                    </button>
                    <button
                      onClick={() => copyRowSummary(r)}
                      className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]"
                    >
                      <Copy className="h-3 w-3" /> Salin
                    </button>
                    <button
                      onClick={() => void openWaForRow(r)}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-[#25D366]/50 bg-[#25D366]/10 px-2 text-[11px] font-medium text-[#1ea952] hover:bg-[#25D366]/20"
                      title="Kirim ringkasan lengkap tugas + semua item bermasalah"
                    >
                      <MessageCircle className="h-3 w-3" /> Kirim WA
                    </button>
                    {hasIssues && (
                      isFixed ? (
                        <button
                          onClick={() => unmarkFixed(r.task.id)}
                          className="h-7 rounded-md border px-2 text-[11px]"
                        >
                          Urungkan tanda
                        </button>
                      ) : (
                        <button
                          onClick={() => markFixed(r)}
                          className="h-7 rounded-md border border-emerald-600/40 bg-emerald-600/10 px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-600/20"
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
          <div className="rounded-md border p-4 text-center text-xs text-muted-foreground">Belum ada tugas.</div>
        )}
        {!loading && rows.length > 0 && visibleRows.length === 0 && (
          <div className="rounded-md border p-4 text-center text-xs text-muted-foreground">Tidak ada tugas pada filter ini.</div>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <button onClick={onClose} className="h-9 rounded-md border px-3 text-sm">Tutup</button>
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
    <Modal title="Pratinjau pesan WhatsApp" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="text-[11px] text-muted-foreground">
          Cek isi pesan di bawah. Anda bisa mengedit sebelum mengirim.
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="min-h-[180px] w-full rounded-md border bg-background p-2 text-xs font-mono leading-relaxed"
        />
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onClose} className="h-9 rounded-md border px-3 text-xs">Batal</button>
          <button onClick={copy} className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-xs">
            <Copy className="h-3.5 w-3.5" /> Salin
          </button>
          <button
            onClick={() => void send()}
            className="inline-flex h-9 items-center gap-1 rounded-md bg-[#25D366] px-3 text-xs font-semibold text-white hover:opacity-90"
          >
            <MessageCircle className="h-3.5 w-3.5" /> Kirim ke WhatsApp
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ShareDialog({ info, onClose }: { info: { token: string; pin: string; title: string }; onClose: () => void }) {
  const url = publicTaskUrl(info.token);
  const message = `Tolong siapkan barang berikut. Buka link, masukkan PIN, foto barangnya & kirim:\n\n${info.title}\n${url}\nPIN: ${info.pin}`;
  function copy(t: string) { navigator.clipboard?.writeText(t).then(() => toast.success("Disalin")); }
  const waUrl = buildWhatsAppUrl(message);
  async function onShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await shareToWhatsApp({ text: message, title: info.title, url });
      notifyShareResult(res);
    } catch (err) {
      toast.error(`Gagal membagikan: ${(err as Error)?.message ?? String(err)}`);
    }
  }
  function onOpenWa(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const win = window.open(waUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      // Popup blocked (mis. dalam iframe pratinjau) — buka di tab teratas.
      try { window.top!.location.href = waUrl; }
      catch { window.location.href = waUrl; }
    }
  }
  return (
    <Modal title="Bagikan ke pegawai" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-[11px] text-muted-foreground">Link</div>
          <div className="flex gap-2">
            <input readOnly value={url} className="h-9 flex-1 rounded-md border bg-background px-2 text-xs" />
            <button onClick={() => copy(url)} className="inline-flex h-9 items-center gap-1 rounded-md border px-2 text-xs"><Copy className="h-4 w-4" /></button>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">PIN (kirim terpisah agar lebih aman)</div>
          <div className="flex gap-2">
            <input readOnly value={info.pin} className="h-9 w-32 rounded-md border bg-background px-2 text-center text-base tracking-widest tabular-nums" />
            <button onClick={() => copy(info.pin)} className="inline-flex h-9 items-center gap-1 rounded-md border px-2 text-xs"><Copy className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <button type="button" onClick={onShare}
            className="inline-flex h-10 items-center justify-center gap-1 rounded-md bg-[#25D366] text-sm font-semibold text-white">
            <MessageCircle className="h-4 w-4" /> Bagikan
          </button>
          <a href={waUrl} target="_blank" rel="noreferrer" onClick={onOpenWa}
            className="inline-flex h-10 items-center justify-center gap-1 rounded-md border text-sm">
            <ExternalLink className="h-4 w-4" /> Buka WA Web
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
    const ch = supabase.channel(`prep:${task.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "prep_submissions", filter: `task_id=eq.${task.id}` }, () => { void load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "prep_task_items", filter: `task_id=eq.${task.id}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [task.id]);

  async function setStatus(status: "done" | "active") {
    setBusy(true);
    const { error } = await supabase.from("prep_tasks").update({ status }).eq("id", task.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Status diperbarui");
  }

  const url = publicTaskUrl(task.share_token);

  return (
    <Modal title={task.title} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap gap-2">
        <button onClick={() => setSharePinOpen(true)} className="inline-flex h-9 items-center gap-1 rounded-md bg-[#25D366] px-3 text-xs font-semibold text-white"><MessageCircle className="h-4 w-4" /> Bagikan link + PIN</button>
        <button disabled={busy} onClick={() => setStatus(task.status === "done" ? "active" : "done")} className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-xs">{task.status === "done" ? "Aktifkan lagi" : "Tandai selesai"}</button>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-xs"><ExternalLink className="h-4 w-4" /> Pratinjau link pegawai</a>
      </div>
      {sharePinOpen && (
        <SharePinDialog title={task.title} url={url} onClose={() => setSharePinOpen(false)} />
      )}
      <div className="space-y-3">
        {items.map((it) => {
          const itemSubs = subs.filter((s) => s.task_item_id === it.id);
          const open = !!openItems[it.id];
          return (
            <div key={it.id} className="rounded-xl border bg-card">
              <button
                type="button"
                onClick={() => setOpenItems((p) => ({ ...p, [it.id]: !p[it.id] }))}
                aria-expanded={open}
                className="flex w-full items-center gap-2 p-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{it.name_snapshot}</div>
                  <div className="text-[11px] text-muted-foreground">{it.category_snapshot ?? "—"} · diminta {it.qty_requested} · disiapkan {it.qty_prepared}</div>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{itemSubs.length} kiriman</span>
                <span className="text-muted-foreground text-xs">{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div className="border-t p-3">
                  {itemSubs.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {itemSubs.map((s) => <SubmissionCard key={s.id} sub={s} />)}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed bg-background/50 p-3 text-center text-[11px] text-muted-foreground">
                      Belum ada kiriman foto/lokasi untuk item ini.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && <div className="rounded-xl border bg-card p-4 text-center text-xs text-muted-foreground">Tidak ada item.</div>}
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
    <div className="rounded-md border bg-background p-2">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="aspect-square w-full rounded object-cover" /></a>
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded bg-muted text-[10px] text-muted-foreground"><ImageIcon className="h-5 w-5" /></div>
      )}
      <div className="mt-1 text-[10px] text-muted-foreground">{new Date(sub.submitted_at).toLocaleString("id-ID")}</div>
      {sub.note && <div className="mt-0.5 line-clamp-2 text-[11px]">{sub.note}</div>}
      <div className="mt-1 flex gap-1">
        {sub.location_url && /^https:\/\//i.test(sub.location_url) && <a href={sub.location_url} target="_blank" rel="noreferrer" className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded border text-[10px]"><MapPin className="h-3 w-3" /> Lokasi</a>}
        <button onClick={shareWA} className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded bg-[#25D366] text-[10px] font-semibold text-white"><MessageCircle className="h-3 w-3" /> WA</button>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className={`max-h-[90vh] w-full ${wide ? "max-w-3xl" : "max-w-lg"} overflow-y-auto rounded-t-2xl bg-card p-4 shadow-xl sm:rounded-2xl`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md border"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Variant manager ----------
function VariantsHub({ warehouse, catVariants, onPickCategory, onClose }: { warehouse: WItem[]; catVariants: CatVariant[]; onPickCategory: (cat: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [newCat, setNewCat] = useState("");
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const w of warehouse) { const c = (w.category ?? "").trim(); if (c) set.add(c); }
    for (const v of catVariants) { const c = v.category.trim(); if (c) set.add(c); }
    const s = q.toLowerCase().trim();
    return Array.from(set).filter((c) => !s || c.toLowerCase().includes(s)).sort();
  }, [warehouse, catVariants, q]);
  return (
    <Modal title="Kelola Varian per Kategori" onClose={onClose}>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Atur preset varian penyiapan <b>per kategori</b> (mis. <b>KRISTAL</b> → 1G=0.90 gr, ST=0.40 gr, SPR=0.20 gr).
        Preset otomatis berlaku untuk <b>semua produk</b> di kategori tersebut pada tugas berikutnya. Stok tetap berkurang dari produk induk.
      </p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kategori…"
        className="mb-2 h-9 w-full rounded-md border bg-background px-3 text-sm" />
      <div className="max-h-[55vh] space-y-1.5 overflow-y-auto">
        {categories.map((cat) => {
          const n = catVariants.filter((v) => v.category === cat).length;
          const items = warehouse.filter((w) => (w.category ?? "") === cat).length;
          return (
            <button key={cat} onClick={() => onPickCategory(cat)}
              className="flex w-full items-center justify-between gap-2 rounded-md border bg-background p-2 text-left text-sm hover:bg-muted">
              <div className="min-w-0">
                <div className="truncate font-medium">{cat}</div>
                <div className="text-[11px] text-muted-foreground">{items} produk · {n} preset varian</div>
              </div>
              <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
        {categories.length === 0 && <div className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground">Belum ada kategori.</div>}
      </div>
      <div className="mt-3 flex items-end gap-1.5 border-t pt-3">
        <label className="flex-1">
          <div className="text-[10px] text-muted-foreground">Tambah kategori baru</div>
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="KRISTAL" className="h-9 w-full rounded border bg-background px-2 text-sm" />
        </label>
        <button
          onClick={() => { const c = newCat.trim(); if (!c) return; setNewCat(""); onPickCategory(c); }}
          className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground">
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
      <p className="mb-2 text-[11px] text-muted-foreground">
        Preset ini disimpan permanen dan otomatis tersedia untuk <b>semua produk</b> berkategori <b>{category}</b> pada tugas berikutnya.
      </p>
      <div className="space-y-1.5">
        {rows.map((v) => (
          <div key={v.id} className="flex items-center gap-1.5 rounded border bg-background p-1.5">
            <input defaultValue={v.label} onBlur={(e) => e.target.value !== v.label && updateRow(v.id, { label: e.target.value })}
              className="h-8 w-20 rounded border bg-background px-1 text-xs" placeholder="Label" />
            <input type="number" step="0.01" defaultValue={Number(v.weight_per_unit)}
              onBlur={(e) => Number(e.target.value) !== Number(v.weight_per_unit) && updateRow(v.id, { weight_per_unit: Number(e.target.value) })}
              className="h-8 w-20 rounded border bg-background px-1 text-center text-xs tabular-nums" />
            <input defaultValue={v.unit_label ?? ""} onBlur={(e) => (e.target.value || null) !== v.unit_label && updateRow(v.id, { unit_label: e.target.value || null })}
              className="h-8 w-16 rounded border bg-background px-1 text-xs" placeholder="gr" />
            <button onClick={() => remove(v.id)} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded border text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {rows.length === 0 && <div className="rounded border border-dashed p-3 text-center text-[11px] text-muted-foreground">Belum ada preset. Tambah di bawah.</div>}
      </div>
      <div className="mt-3 flex items-end gap-1.5 border-t pt-3">
        <label className="flex-1">
          <div className="text-[10px] text-muted-foreground">Label</div>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="1G" className="h-9 w-full rounded border bg-background px-2 text-sm" />
        </label>
        <label className="w-24">
          <div className="text-[10px] text-muted-foreground">Berat/unit</div>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} type="number" step="0.01" placeholder="0.90" className="h-9 w-full rounded border bg-background px-2 text-center text-sm tabular-nums" />
        </label>
        <label className="w-16">
          <div className="text-[10px] text-muted-foreground">Satuan</div>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="gr" className="h-9 w-full rounded border bg-background px-2 text-sm" />
        </label>
        <button disabled={busy} onClick={add} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
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
      <p className="mb-2 text-[11px] text-muted-foreground">
        Buat preset varian penyiapan untuk produk ini (mis. <b>1G</b> = 0.90 gr, <b>ST</b> = 0.40 gr, <b>SPR</b> = 0.20 gr).
        Saat membuat tugas, pilih varian + jumlah unit — sistem akan menghitung total berat dan mengurangi stok dari produk induk <b>{item.name}</b>.
      </p>
      <div className="space-y-1.5">
        {rows.map((v) => (
          <div key={v.id} className="flex items-center gap-1.5 rounded border bg-background p-1.5">
            <input defaultValue={v.label} onBlur={(e) => e.target.value !== v.label && updateRow(v.id, { label: e.target.value })}
              className="h-8 w-20 rounded border bg-background px-1 text-xs" placeholder="Label" />
            <input type="number" step="0.01" defaultValue={Number(v.weight_per_unit)}
              onBlur={(e) => Number(e.target.value) !== Number(v.weight_per_unit) && updateRow(v.id, { weight_per_unit: Number(e.target.value) })}
              className="h-8 w-20 rounded border bg-background px-1 text-center text-xs tabular-nums" />
            <input defaultValue={v.unit_label ?? ""} onBlur={(e) => (e.target.value || null) !== v.unit_label && updateRow(v.id, { unit_label: e.target.value || null })}
              className="h-8 w-16 rounded border bg-background px-1 text-xs" placeholder="gr" />
            <button onClick={() => remove(v.id)} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded border text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {rows.length === 0 && <div className="rounded border border-dashed p-3 text-center text-[11px] text-muted-foreground">Belum ada varian. Tambah di bawah.</div>}
      </div>
      <div className="mt-3 flex items-end gap-1.5 border-t pt-3">
        <label className="flex-1">
          <div className="text-[10px] text-muted-foreground">Label</div>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="1G" className="h-9 w-full rounded border bg-background px-2 text-sm" />
        </label>
        <label className="w-24">
          <div className="text-[10px] text-muted-foreground">Berat/unit</div>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} type="number" step="0.01" placeholder="0.90" className="h-9 w-full rounded border bg-background px-2 text-center text-sm tabular-nums" />
        </label>
        <label className="w-16">
          <div className="text-[10px] text-muted-foreground">Satuan</div>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="gr" className="h-9 w-full rounded border bg-background px-2 text-sm" />
        </label>
        <button disabled={busy} onClick={add} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" /> Tambah
        </button>
      </div>
    </Modal>
  );
}