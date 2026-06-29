import { createFileRoute, Link, useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { genPin, genShareToken, publicTaskUrl } from "@/lib/prep";
import { copyText, shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { Plus, Trash2, Copy, MessageCircle, ExternalLink, RefreshCw, ShieldCheck, ArrowLeft, Info, Check } from "lucide-react";
import { TaskQrCode } from "@/components/TaskQrCode";
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
    // Android lama, mode incognito tertentu, atau ketika tab di-suspend lalu
    // dibangunkan. Kita re-sync ketika tab kembali fokus/visible, dan
    // polling ringan setiap 5 dtk hanya saat tab terlihat agar tidak
    // menguras baterai.
    const resync = () => {
      const stored = loadTooltipMode();
      scheduleExternal(stored);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") resync();
    };
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", onVisibility);
    let pollId: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => {
      if (pollId != null) return;
      pollId = setInterval(resync, 5000);
    };
    const stopPoll = () => {
      if (pollId != null) {
        clearInterval(pollId);
        pollId = null;
      }
    };
    const onVisibilityPoll = () => {
      if (document.visibilityState === "visible") startPoll();
      else stopPoll();
    };
    document.addEventListener("visibilitychange", onVisibilityPoll);
    if (document.visibilityState === "visible") startPoll();
    return () => {
      window.removeEventListener("autosave-tooltip-mode", onChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("visibilitychange", onVisibilityPoll);
      stopPoll();
      if (debounceRef.current != null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        lastExternalRef.current = null;
      }
    };
  }, [scheduleExternal]);
  return [mode, update];
}
type Draft = { title: string; note: string; pin: string; rows: Row[]; phone: string };
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
  // Restore draft on first render so a remount (e.g. router invalidation
  // triggered by realtime/sidebar refetch) doesn't wipe what was typed.
  const initialRef = useRef<Draft | null>(loadDraft());
  const [title, setTitle] = useState(() => initialRef.current?.title ?? "");
  const [note, setNote] = useState(() => initialRef.current?.note ?? "");
  const [pin, setPin] = useState(() => initialRef.current?.pin ?? genPin());
  const [rows, setRows] = useState<Row[]>(() => initialRef.current?.rows ?? [newRow()]);
  const [phone, setPhone] = useState(() => initialRef.current?.phone ?? "");
  const [restored] = useState(() => !!initialRef.current);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ token: string; pin: string; title: string; url: string } | null>(null);
  const [titles, setTitles] = useState<TitleOpt[]>([]);
  type VerifyState = {
    status: "idle" | "checking" | "ok" | "missing" | "error";
    productName?: string;
    error?: string;
    wid?: string | null;
  };
  const [verify, setVerify] = useState<Record<string, VerifyState>>({});
  const verifySeq = useRef<Record<string, number>>({});

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
  const latestDraftRef = useRef<Draft>({ title, note, pin, rows, phone });
  useEffect(() => {
    latestDraftRef.current = { title, note, pin, rows, phone };
  }, [title, note, pin, rows, phone]);

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
  }, [title, note, pin, rows, phone, created, flushDraft]);

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

  // Re-verify warehouse links for restored rows so the green/red status badges
  // re-appear after a remount without forcing the user to re-pick each product.
  useEffect(() => {
    if (!initialRef.current) return;
    for (const r of initialRef.current.rows) {
      if (r.warehouse_item_id) verifyWid(r.key, r.warehouse_item_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function submit() {
    const t = title.trim();
    if (!t) return toast.error("Judul tugas wajib diisi");
    if (!/^\d{4,8}$/.test(pin)) return toast.error("PIN harus 4–8 digit angka");
    const items = rows
      .map((r) => ({
        name: r.name.trim(),
        qty: Number(r.qty),
        unit: r.unit.trim() || null,
        warehouse_item_id: r.warehouse_item_id,
      }))
      .filter((r) => r.name.length > 0);
    if (items.length === 0) return toast.error("Tambahkan minimal 1 barang");
    if (items.some((r) => !Number.isFinite(r.qty) || r.qty <= 0)) return toast.error("Jumlah setiap barang harus > 0");
    const missingWid = items.filter((r) => !r.warehouse_item_id).length;
    if (missingWid > 0) {
      const ok = window.confirm(
        `${missingWid} barang belum dipilih dari daftar produk. Tugas tetap bisa dibuat, tetapi foto pegawai tidak akan otomatis muncul di kartu Beranda (1g/ST/SPR/GS) dan tombol Kirim WA hanya aktif untuk barang yang cocok.\n\nLanjutkan tanpa cocokkan?`,
      );
      if (!ok) return;
    }

    setBusy(true);
    const token = genShareToken();
    const payload = items.map((r) => ({
      name: r.name,
      category: null,
      qty_requested: r.qty,
      unit_label: r.unit,
      ref_photo_path: null,
      warehouse_item_id: r.warehouse_item_id,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("prep_create_task", {
      _title: t,
      _note: note.trim() || null,
      _pin: pin,
      _share_token: token,
      _items: payload,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    const url = publicTaskUrl(token);
    clearDraft();
    setCreated({ token, pin, title: t, url });
    toast.success("Tugas berhasil dibuat");
  }

  async function shareWa() {
    if (!created) return;
    const cleaned = phone.replace(/\D/g, "");
    const text = `Tolong siapkan barang berikut. Buka link, masukkan PIN, foto barangnya & kirim:\n\n${created.title}\nPIN: ${created.pin}`;
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
    setVerify({});
    verifySeq.current = {};
    clearDraft();
  }

  function clearForm() {
    if (!window.confirm("Bersihkan formulir? Draft yang tersimpan akan dihapus.")) return;
    setTitle("");
    setNote("");
    setPin(genPin());
    setRows([newRow()]);
    setPhone("");
    setVerify({});
    verifySeq.current = {};
    clearDraft();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Buat Tugas Pegawai</h1>
          <p className="text-xs text-muted-foreground">Buat token & PIN langsung dari UI — tanpa perlu akses database.</p>
        </div>
        <Link to="/tugas" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
          <ArrowLeft className="h-3.5 w-3.5" /> Tugas
        </Link>
      </div>

      {created ? (
        <div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
          <div className="flex items-center gap-2 text-emerald-600">
            <ShieldCheck className="h-4 w-4" /> <span className="font-medium">Tugas siap dibagikan</span>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Judul</div>
            <div className="font-medium">{created.title}</div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="PIN">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-muted px-2 py-1 text-base tracking-widest">{created.pin}</code>
                <button type="button" onClick={() => copyText(created.pin)} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </Field>
            <Field label="Link pegawai">
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{created.url}</code>
                <button type="button" onClick={() => copyText(created.url)} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <a href={created.url} target="_blank" rel="noreferrer" className="rounded-md border px-2 py-1 text-xs hover:bg-accent">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </Field>
          </div>
          <TaskQrCode url={created.url} pin={created.pin} title={created.title} />
          <Field label="Kirim ke WhatsApp (opsional)">
            <div className="flex items-center gap-2">
              <input
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08xxxxxxxxxx"
                className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
              />
              <button type="button" onClick={shareWa} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
                <MessageCircle className="h-3.5 w-3.5" /> Kirim
              </button>
            </div>
          </Field>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
              <RefreshCw className="h-3.5 w-3.5" /> Buat tugas lain
            </button>
            <Link to="/tugas" className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
              Lihat daftar tugas
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
          <div className="flex items-start justify-between gap-2">
            <SaveIndicator state={saveState} savedAt={savedAt} visible={savedVisible} reason={savedReason} tooltipMode={tooltipMode} />
            <TooltipModeToggle mode={tooltipMode} onChange={setTooltipMode} />
          </div>
          <LastSavedSummary savedAt={savedAt} reason={savedReason} tooltipMode={tooltipMode} />
          <AutosaveAnnouncer state={saveState} savedAt={savedAt} reason={savedReason} />
          {restored ? (
            <div className="flex items-start justify-between gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-900 dark:text-emerald-200">
              <span>
                Draft sebelumnya dipulihkan otomatis — lanjutkan dari yang terakhir Anda isi.
              </span>
              <button
                type="button"
                onClick={clearForm}
                className="shrink-0 rounded border border-emerald-600/40 px-2 py-0.5 text-[10px] hover:bg-emerald-600/10"
              >
                Bersihkan draft
              </button>
            </div>
          ) : null}
          <Field label="Judul tugas">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Mis. Penyiapan pesanan Bu Ani"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Catatan (opsional)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Instruksi tambahan untuk pegawai…"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="PIN (4–8 digit)">
            <div className="flex items-center gap-2">
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                className="w-32 rounded-md border bg-background px-2 py-1.5 text-base tracking-widest"
              />
              <button type="button" onClick={() => setPin(genPin())} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                <RefreshCw className="h-3.5 w-3.5" /> Acak
              </button>
            </div>
          </Field>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Daftar barang</div>
              <div className="flex items-center gap-2">
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
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                  title="Paksa ulang verifikasi status terhubung untuk semua baris"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Verifikasi ulang
                </button>
                <button type="button" onClick={() => setRows((s) => [...s, newRow()])} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                  <Plus className="h-3.5 w-3.5" /> Tambah
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={r.key} className="grid grid-cols-12 items-center gap-2 rounded-md border p-2">
                  <div className="col-span-12 text-[11px] text-muted-foreground sm:hidden">Barang #{i + 1}</div>
                  <div className="col-span-12">
                    <label className="block space-y-1">
                      <div className="text-[11px] font-medium text-muted-foreground">
                        Pilih dari daftar produk (agar foto pegawai otomatis muncul di Beranda & tombol Kirim WA aktif)
                      </div>
                      <select
                        value={r.title_id}
                        onChange={(e) => pickTitle(r.key, e.target.value)}
                        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
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
                    className="col-span-12 rounded-md border bg-background px-2 py-1.5 text-sm sm:col-span-6"
                  />
                  <input
                    value={r.qty}
                    onChange={(e) => updateRow(r.key, { qty: e.target.value.replace(/[^\d.]/g, "") })}
                    inputMode="decimal"
                    placeholder="Jumlah"
                    className="col-span-5 rounded-md border bg-background px-2 py-1.5 text-sm sm:col-span-3"
                  />
                  <input
                    value={r.unit}
                    onChange={(e) => updateRow(r.key, { unit: e.target.value })}
                    placeholder="Satuan (gram/pcs/botol)"
                    className="col-span-6 rounded-md border bg-background px-2 py-1.5 text-sm sm:col-span-2"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(r.key)}
                    disabled={rows.length <= 1}
                    className="col-span-1 inline-flex items-center justify-center rounded-md border p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-40"
                    aria-label="Hapus baris"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <div className="col-span-12 text-[11px]">
                    {(() => {
                      const v = verify[r.key];
                      if (!r.warehouse_item_id) {
                        return (
                          <span className="text-amber-600">
                            ⚠ Belum terhubung produk — foto pegawai tidak akan tampil di kartu Beranda untuk barang ini.
                          </span>
                        );
                      }
                      if (!v || v.status === "checking") {
                        return <span className="text-muted-foreground">⏳ Memverifikasi tautan ke gudang…</span>;
                      }
                      if (v.status === "ok") {
                        return (
                          <span className="text-emerald-600">
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

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                const changed = flushDraft("manual");
                toast.success(changed ? "Draft disimpan" : "Draft sudah tersimpan");
              }}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs hover:bg-accent disabled:opacity-50"
            >
              Simpan draft
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Membuat…" : "Buat tugas"}
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
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
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
    cls: "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/25 dark:text-emerald-200",
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
      className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
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
        className="inline-flex flex-wrap items-center gap-1.5 animate-fade-in [animation-duration:220ms] motion-reduce:animate-none motion-reduce:[animation-duration:0ms]"
      >
        {info.stamp ? (
          <>
            <span className="tabular-nums" aria-hidden="true">{info.stamp}</span>
            <span className="text-muted-foreground/70" aria-hidden="true">({info.ago})</span>
            <span
              className={`rounded-sm px-1.5 py-px text-[10px] font-medium transition-colors duration-300 motion-reduce:transition-none ${info.meta.cls}`}
              aria-hidden="true"
            >
              {info.meta.label}
            </span>
          </>
        ) : (
          <span
            className="rounded-sm bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground"
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
        className="w-[320px] space-y-3 p-3 text-[11px]"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold" id="autosave-detail-heading">
            {dialogTitle}
          </span>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] hover:bg-accent"
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
              <summary className="cursor-pointer list-none px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground">
                Teks siap-salin ▾
              </summary>
              <textarea
                readOnly
                value={textToCopy}
                onFocus={(e) => e.currentTarget.select()}
                className={`${isShort ? "h-12" : "h-40"} w-full resize-none rounded-b-md border-0 border-t bg-background p-2 font-mono text-[10px] leading-snug tabular-nums`}
                aria-label={textareaLabel}
                aria-describedby="autosave-detail-heading"
              />
            </details>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">Belum ada draft tersimpan.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DetailGrid({ rows }: { rows: { label: string; value: string; mono?: boolean; wrap?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-[11px]">
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
      className="flex items-center gap-1 text-[10px] text-muted-foreground"
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
        className="inline-flex items-center gap-1 rounded-sm bg-amber-500/15 px-1.5 py-px text-amber-700 dark:bg-amber-400/25 dark:text-amber-200"
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
        className="inline-flex items-center gap-1"
        title={info.tooltip}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
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
          <span className="ml-1 rounded-sm bg-emerald-500/15 px-1 py-px text-[9px] font-medium text-emerald-700 dark:bg-emerald-400/25 dark:text-emerald-200">
            {reasonLabel}
          </span>
        ) : null}
      </span>
    ) : null;
  if (content) lastContentRef.current = content;
  return (
    <div
      className={`pointer-events-none flex h-4 justify-end text-[10px] text-muted-foreground transition-opacity duration-700 ease-out motion-reduce:transition-none motion-reduce:duration-0 ${
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