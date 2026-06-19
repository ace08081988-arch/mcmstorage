import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { genPin, genShareToken, publicTaskUrl, signedUrl } from "@/lib/prep";
import { shareToWhatsApp, urlToFile, buildWhatsAppUrl } from "@/lib/share-wa";
import { Plus, Trash2, Send, Copy, MessageCircle, Image as ImageIcon, MapPin, ExternalLink, X, Settings2, ShieldCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import { confirm as confirmDialog } from "@/lib/confirm";
import { validateVariantWeight, validateVariantLabel } from "@/lib/variant-validation";

export const Route = createFileRoute("/_authenticated/tugas")({
  head: () => ({
    meta: [
      { title: "Tugas Pegawai · MCM Storage" },
      { name: "description", content: "Buat tugas siapkan barang dan kirim link ke pegawai." },
    ],
  }),
  component: TugasPage,
});

type WItem = { id: string; name: string; category: string | null; image_path: string | null; stock_base: number };
type Variant = { id: string; warehouse_item_id: string; label: string; weight_per_unit: number; unit_label: string | null; position: number };
type CatVariant = { id: string; category: string; label: string; weight_per_unit: number; unit_label: string | null; position: number };
type Task = { id: string; title: string; note: string | null; share_token: string; status: string; expires_at: string; created_at: string };
type TaskItem = { id: string; task_id: string; name_snapshot: string; category_snapshot: string | null; qty_requested: number; qty_prepared: number; unit_label: string | null; ref_photo_path: string | null; warehouse_item_id: string | null };
type Submission = { id: string; task_id: string; task_item_id: string; photo_path: string | null; location_url: string | null; note: string | null; submitted_at: string };

function TugasPage() {
  const [uid, setUid] = useState<string | null>(null);
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

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null)); }, []);

  async function load() {
    if (!uid) return;
    const [{ data: t }, { data: w }, { data: v }, { data: cv }] = await Promise.all([
      supabase.from("prep_tasks").select("*").order("created_at", { ascending: false }),
      supabase.from("warehouse_items").select("id,name,category,image_path,stock_base").order("name"),
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
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Tugas Pegawai</h1>
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
            <button onClick={() => removeTask(t.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-destructive"><Trash2 className="h-4 w-4" /></button>
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
      {openAudit && <AuditDialog tasks={tasks} onClose={() => setOpenAudit(false)} />}
    </div>
  );
}

// ---------- Create dialog ----------
type Line = { key: string; variantId: string | null; count: number; weightOverride: number | null; split: boolean };
type PickedEntry = { item: WItem; lines: Line[] };

function newLine(variantId: string | null = null): Line {
  return { key: Math.random().toString(36).slice(2), variantId, count: 1, weightOverride: null, split: false };
}
function lineWeight(line: Line, variants: Variant[]): number {
  if (line.weightOverride != null) return line.weightOverride;
  const v = variants.find((x) => x.id === line.variantId);
  return v ? Number(v.weight_per_unit) : 1;
}
// Parser angka yang menerima koma desimal (format Indonesia) maupun titik.
function parseNum(input: string): number | null {
  const s = (input ?? "").toString().trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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
    const cleanedPhone = phone.replace(/\D/g, "");
    // Open a tab synchronously so popup blockers don't intercept after await
    const waWindow = cleanedPhone ? window.open("about:blank", "_blank") : null;
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
    setBusy(false);
    if (error) { if (waWindow) waWindow.close(); return toast.error(error.message); }
    if (cleanedPhone) {
      localStorage.setItem("prep:last_phone", cleanedPhone);
      const url = publicTaskUrl(token);
      const msg = `Tolong siapkan barang berikut. Buka link, masukkan PIN, foto barangnya & kirim:\n\n${title}\n${url}\nPIN: ${pin}`;
      const waUrl = `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(msg)}`;
      if (waWindow) waWindow.location.href = waUrl;
      toast.success("Tugas dibuat — WhatsApp dibuka");
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
              return (
                <div key={it.id} className={`rounded p-1.5 ${p ? "bg-primary/5" : ""}`}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={!!p} onChange={() => toggle(it)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{it.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {it.category ?? "—"} · stok {it.stock_base}
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
                        const w = lineWeight(l, variants);
                        const total = w * (l.count || 0);
                        const isManual = !l.variantId;
                        return (
                          <div key={l.key} className="space-y-1.5 rounded border bg-background/60 p-2">
                            <div className="flex items-start gap-1.5">
                              <label className="flex-1 min-w-[120px]">
                                <div className="mb-0.5 text-[10px] text-muted-foreground">Varian / preset</div>
                                <select value={l.variantId ?? ""}
                                  onChange={(e) => updateLine(it.id, l.key, { variantId: e.target.value || null, weightOverride: null })}
                                  className="h-8 w-full rounded border bg-background px-1 text-[11px]">
                                  <option value="">Manual (isi berat sendiri)</option>
                                  {itemVariants.map((v) => (
                                    <option key={v.id} value={v.id}>{v.label} · {Number(v.weight_per_unit)} {v.unit_label ?? ""}</option>
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
                                <input type="text" inputMode="decimal" defaultValue={String(l.count)}
                                  onChange={(e) => {
                                    const n = parseNum(e.target.value);
                                    updateLine(it.id, l.key, { count: n ?? 0 });
                                  }}
                                  className="h-8 w-full rounded border bg-background px-1 text-center text-xs tabular-nums" />
                              </label>
                              <span className="pb-2 text-xs text-muted-foreground">×</span>
                              <label className="w-24">
                                <div className="mb-0.5 text-[10px] text-muted-foreground">
                                  Berat / unit{isManual ? "" : " (preset)"}
                                </div>
                                <input type="text" inputMode="decimal"
                                  defaultValue={String(l.weightOverride ?? w)}
                                  disabled={!isManual}
                                  key={`${l.key}-${l.variantId ?? "m"}-${w}`}
                                  onChange={(e) => {
                                    const n = parseNum(e.target.value);
                                    updateLine(it.id, l.key, { weightOverride: n });
                                  }}
                                  className="h-8 w-full rounded border bg-background px-1 text-center text-xs tabular-nums disabled:opacity-60" />
                              </label>
                              <div className="pb-1 text-[11px] font-semibold tabular-nums">
                                = {total.toFixed(2)} {(itemVariants.find((v) => v.id === l.variantId)?.unit_label) ?? ""}
                              </div>
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
        <button disabled={busy} onClick={create} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          <Send className="h-4 w-4" /> Buat & kirim
        </button>
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
function AuditDialog({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AuditRow[]>([]);

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
      for (const it of items) {
        const q = Number(it.qty_requested);
        const p = Number(it.qty_prepared ?? 0);
        if (!Number.isFinite(q) || q <= 0) {
          problemItems.push({ name: it.name_snapshot, qty_requested: q, qty_prepared: p, reason: "qty diminta ≤ 0 / invalid" });
        } else if (Number.isFinite(p) && p > q + 1e-9) {
          problemItems.push({ name: it.name_snapshot, qty_requested: q, qty_prepared: p, reason: "qty disiapkan > diminta" });
        }
        if (Number.isFinite(q)) totalRequested += q;
        if (Number.isFinite(p)) totalPrepared += p;
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
  const badCount = rows.length - okCount;

  return (
    <Modal title="Revalidasi total berat & jumlah" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between text-xs">
        <div className="text-muted-foreground">
          {loading ? "Menghitung…" : `${rows.length} tugas diperiksa — ${okCount} OK, ${badCount} bermasalah`}
        </div>
        <button onClick={() => void run()} className="h-8 rounded-md border px-3 text-xs">Hitung ulang</button>
      </div>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {rows.map((r) => {
          const ok = r.issues.length === 0;
          return (
            <div key={r.task.id} className={`rounded-md border p-2 text-xs ${ok ? "" : "border-destructive/40 bg-destructive/5"}`}>
              <div className="flex items-start gap-2">
                {ok
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  : <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{r.task.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.items} item · diminta <b>{r.totalRequested.toFixed(2)}</b> · disiapkan <b>{r.totalPrepared.toFixed(2)}</b> · sisa <b>{r.remaining.toFixed(2)}</b>
                  </div>
                  {r.issues.length > 0 && (
                    <div className="mt-1 text-[10px] text-destructive">{r.issues.join(" · ")}</div>
                  )}
                  {r.problemItems.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[10px]">
                      {r.problemItems.map((p, i) => (
                        <li key={i} className="text-destructive">
                          • {p.name}: diminta {p.qty_requested}, disiapkan {p.qty_prepared} — {p.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!loading && rows.length === 0 && (
          <div className="rounded-md border p-4 text-center text-xs text-muted-foreground">Belum ada tugas.</div>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <button onClick={onClose} className="h-9 rounded-md border px-3 text-sm">Tutup</button>
      </div>
    </Modal>
  );
}

function ShareDialog({ info, onClose }: { info: { token: string; pin: string; title: string }; onClose: () => void }) {
  const url = publicTaskUrl(info.token);
  const message = `Tolong siapkan barang berikut. Buka link, masukkan PIN, foto barangnya & kirim:\n\n${info.title}\n${url}\nPIN: ${info.pin}`;
  function copy(t: string) { navigator.clipboard?.writeText(t).then(() => toast.success("Disalin")); }
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
          <button onClick={() => shareToWhatsApp({ text: message, title: info.title, url })}
            className="inline-flex h-10 items-center justify-center gap-1 rounded-md bg-[#25D366] text-sm font-semibold text-white">
            <MessageCircle className="h-4 w-4" /> Bagikan
          </button>
          <a href={buildWhatsAppUrl(message)} target="_blank" rel="noreferrer"
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
  const message = `Tugas: ${task.title}\n${url}`;

  return (
    <Modal title={task.title} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap gap-2">
        <button onClick={() => shareToWhatsApp({ text: message, title: task.title, url })} className="inline-flex h-9 items-center gap-1 rounded-md bg-[#25D366] px-3 text-xs font-semibold text-white"><MessageCircle className="h-4 w-4" /> Bagikan ulang</button>
        <button disabled={busy} onClick={() => setStatus(task.status === "done" ? "active" : "done")} className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-xs">{task.status === "done" ? "Aktifkan lagi" : "Tandai selesai"}</button>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-xs"><ExternalLink className="h-4 w-4" /> Pratinjau link pegawai</a>
      </div>
      <div className="space-y-3">
        {items.map((it) => {
          const itemSubs = subs.filter((s) => s.task_item_id === it.id);
          return (
            <div key={it.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{it.name_snapshot}</div>
                  <div className="text-[11px] text-muted-foreground">{it.category_snapshot ?? "—"} · diminta {it.qty_requested} · disiapkan {it.qty_prepared}</div>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{itemSubs.length} kiriman</span>
              </div>
              {itemSubs.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {itemSubs.map((s) => <SubmissionCard key={s.id} sub={s} />)}
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
    if (result === "fallback" && files.length > 0) {
      toast.message("Foto sudah diunduh — di WA tap 📎 lalu pilih foto tadi untuk dikirim.");
    }
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