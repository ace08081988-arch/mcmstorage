import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { genPin, genShareToken, publicTaskUrl, signedUrl } from "@/lib/prep";
import { shareToWhatsApp, urlToFile, buildWhatsAppUrl } from "@/lib/share-wa";
import { Plus, Trash2, Send, Copy, MessageCircle, Image as ImageIcon, MapPin, ExternalLink, X, Settings2 } from "lucide-react";

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
type Task = { id: string; title: string; note: string | null; share_token: string; status: string; expires_at: string; created_at: string };
type TaskItem = { id: string; task_id: string; name_snapshot: string; category_snapshot: string | null; qty_requested: number; qty_prepared: number; unit_label: string | null; ref_photo_path: string | null; warehouse_item_id: string | null };
type Submission = { id: string; task_id: string; task_item_id: string; photo_path: string | null; location_url: string | null; note: string | null; submitted_at: string };

function TugasPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [warehouse, setWarehouse] = useState<WItem[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [createdInfo, setCreatedInfo] = useState<{ token: string; pin: string; title: string } | null>(null);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null)); }, []);

  async function load() {
    if (!uid) return;
    const [{ data: t }, { data: w }, { data: v }] = await Promise.all([
      supabase.from("prep_tasks").select("*").order("created_at", { ascending: false }),
      supabase.from("warehouse_items").select("id,name,category,image_path,stock_base").order("name"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)("warehouse_item_variants").select("*").order("position"),
    ]);
    setTasks((t ?? []) as Task[]);
    setWarehouse((w ?? []) as WItem[]);
    setVariants((v ?? []) as Variant[]);
  }
  useEffect(() => { void load(); }, [uid]);

  async function removeTask(id: string) {
    if (!confirm("Hapus tugas ini? Semua foto kiriman juga ikut terhapus.")) return;
    const { error } = await supabase.from("prep_tasks").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Tugas dihapus"); void load();
  }

  return (
    <div className="mx-auto max-w-4xl px-3 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Tugas Pegawai</h1>
        <button onClick={() => setOpenCreate(true)} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">
          <Plus className="h-4 w-4" /> Buat tugas
        </button>
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
          variants={variants}
          onVariantsChanged={load}
          onClose={() => setOpenCreate(false)}
          onCreated={(info) => { setOpenCreate(false); setCreatedInfo(info); void load(); }}
        />
      )}
      {createdInfo && <ShareDialog info={createdInfo} onClose={() => setCreatedInfo(null)} />}
      {openTask && <TaskDetail task={openTask} onClose={() => { setOpenTask(null); void load(); }} />}
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
                        return (
                          <div key={l.key} className="flex flex-wrap items-center gap-1.5 rounded border bg-background/60 p-1.5">
                            <select value={l.variantId ?? ""}
                              onChange={(e) => updateLine(it.id, l.key, { variantId: e.target.value || null, weightOverride: null })}
                              className="h-8 max-w-[160px] flex-1 rounded border bg-background px-1 text-[11px]">
                              <option value="">Berat manual…</option>
                              {itemVariants.map((v) => (
                                <option key={v.id} value={v.id}>{v.label} · {Number(v.weight_per_unit)} {v.unit_label ?? ""}</option>
                              ))}
                            </select>
                            <input type="number" inputMode="numeric" min={0} step="1" value={l.count}
                              onChange={(e) => updateLine(it.id, l.key, { count: Number(e.target.value) || 0 })}
                              title="Jumlah unit yang dipesan"
                              className="h-8 w-14 rounded border bg-background px-1 text-center text-xs tabular-nums" />
                            <span className="text-[10px] text-muted-foreground">×</span>
                            <input type="number" inputMode="decimal" min={0} step="0.01"
                              value={l.weightOverride ?? w}
                              onChange={(e) => updateLine(it.id, l.key, { weightOverride: e.target.value === "" ? null : Number(e.target.value) })}
                              title="Berat per unit (boleh desimal)"
                              className="h-8 w-20 rounded border bg-background px-1 text-center text-xs tabular-nums" />
                            <span className="text-[10px] font-semibold tabular-nums">= {total.toFixed(2)}</span>
                            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <input type="checkbox" checked={l.split}
                                onChange={(e) => updateLine(it.id, l.key, { split: e.target.checked })} />
                              Foto/unit
                            </label>
                            <button type="button" onClick={() => removeLine(it.id, l.key)}
                              className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded border text-destructive"
                              title="Hapus baris"><X className="h-3 w-3" /></button>
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
    if (!isFinite(w) || w <= 0) return toast.error("Berat per unit harus > 0");
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