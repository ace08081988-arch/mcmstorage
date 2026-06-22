import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logStorageError } from "@/lib/storage-log";
import { friendlyError } from "@/lib/friendly-error";
import { confirm } from "@/lib/confirm";
import { urlToFile } from "@/lib/share-wa";
import { previewAndShareWA } from "@/lib/share-wa-preview";
import { fmtBase, fmtItemQty } from "@/lib/stock-format";

type Item = {
  id: string;
  name: string;
  base_unit: "g" | "pcs";
  stock_base: number;
  package_type?: string | null;
  package_size?: number | null;
};
type Customer = { id: string; name: string; contact: string | null };

type Pkg = {
  id: string;
  qty_base: number;
  photo_path: string | null;
  location_url: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  note: string | null;
  status: "ready" | "sent" | "archived" | "cancelled" | "failed";
  sent_at: string | null;
  sent_to_name: string | null;
  sent_to_phone: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<Pkg["status"], string> = {
  ready: "Siap dikirim",
  sent: "Berhasil dikirim",
  archived: "Diarsipkan",
  cancelled: "Batal",
  failed: "Gagal dikirim",
};
const STATUS_BADGE: Record<Pkg["status"], string> = {
  ready: "bg-muted text-foreground",
  sent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  archived: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  cancelled: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  failed: "bg-destructive/15 text-destructive",
};

const signedCache = new Map<string, { url: string; exp: number }>();
function SignedThumb({ path, className }: { path: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const c = signedCache.get(path);
    if (c && c.exp > Date.now()) { setUrl(c.url); return; }
    supabase.storage.from("ready-packages").createSignedUrl(path, 3600).then(({ data, error }) => {
      logStorageError({ bucket: "ready-packages", op: "createSignedUrl", path, source: "ReadyPackagesPanel.thumb" }, error);
      if (!alive || !data) return;
      signedCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
      setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  if (!url) return <div className={className} />;
  return <img src={url} alt="" className={className} loading="lazy" />;
}

export function ReadyPackagesPanel({
  item, uid, onClose, onStockChanged,
}: {
  item: Item;
  uid: string;
  onClose: () => void;
  onStockChanged: () => void;
}) {
  const [tab, setTab] = useState<"ready" | "history">("ready");
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [histQuery, setHistQuery] = useState("");
  const [histStatus, setHistStatus] = useState<"all" | "sent" | "archived" | "cancelled" | "failed">("all");
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");

  async function reload() {
    setLoading(true);
    const { data, error } = await supabase
      .from("ready_packages")
      .select("id,qty_base,photo_path,location_url,gps_lat,gps_lng,note,status,sent_at,sent_to_name,sent_to_phone,created_at")
      .eq("warehouse_item_id", item.id)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { toast.error(friendlyError(error)); return; }
    setPkgs((data ?? []) as Pkg[]);
  }

  useEffect(() => {
    reload();
    supabase.from("customers").select("id,name,contact").order("name").then(({ data }) => {
      setCustomers((data ?? []) as Customer[]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const historyAll = pkgs.filter((p) => p.status !== "ready");
  const histQ = histQuery.trim().toLowerCase();
  const fromTs = histFrom ? new Date(histFrom + "T00:00:00").getTime() : null;
  const toTs = histTo ? new Date(histTo + "T23:59:59.999").getTime() : null;
  const historyFiltered = historyAll.filter((p) => {
    if (histStatus !== "all" && p.status !== histStatus) return false;
    if (fromTs !== null || toTs !== null) {
      const ts = new Date(p.sent_at ?? p.created_at).getTime();
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
    }
    if (!histQ) return true;
    const hay = `${p.sent_to_phone ?? ""} ${p.sent_to_name ?? ""}`.toLowerCase();
    return hay.includes(histQ);
  });
  const list = tab === "ready" ? pkgs.filter((p) => p.status === "ready") : historyFiltered;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-3" onClick={onClose}>
      <div className="flex h-[95vh] w-full max-w-2xl flex-col rounded-t-lg sm:rounded-lg border bg-card" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">📦 Paket Siap Kirim</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {item.name} · stok: {fmtItemQty(item.stock_base, item)}
            </div>
          </div>
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">Tutup</button>
        </header>

        <div className="flex border-b text-xs">
          <button
            onClick={() => setTab("ready")}
            className={`flex-1 px-3 py-2 font-medium ${tab === "ready" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
          >
            Siap dikirim ({pkgs.filter((p) => p.status === "ready").length})
          </button>
          <button
            onClick={() => setTab("history")}
            className={`flex-1 px-3 py-2 font-medium ${tab === "history" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
          >
            Riwayat ({historyAll.length})
          </button>
        </div>

        {tab === "history" && historyAll.length > 0 && (
          <div className="flex flex-col gap-2 border-b bg-muted/30 px-3 py-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={histQuery}
                onChange={(e) => setHistQuery(e.target.value)}
                placeholder="Cari nomor WA / nama pelanggan…"
                className="h-9 flex-1 rounded-md border bg-background px-3 text-xs"
              />
              <select
                value={histStatus}
                onChange={(e) => setHistStatus(e.target.value as typeof histStatus)}
                className="h-9 rounded-md border bg-background px-2 text-xs"
              >
                <option value="all">Semua status</option>
                <option value="sent">Berhasil dikirim</option>
                <option value="archived">Diarsipkan</option>
                <option value="cancelled">Batal</option>
                <option value="failed">Gagal dikirim</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11px] text-muted-foreground">Dari</label>
              <input
                type="date"
                value={histFrom}
                max={histTo || undefined}
                onChange={(e) => setHistFrom(e.target.value)}
                className="h-9 flex-1 min-w-[8rem] rounded-md border bg-background px-2 text-xs"
              />
              <label className="text-[11px] text-muted-foreground">s/d</label>
              <input
                type="date"
                value={histTo}
                min={histFrom || undefined}
                onChange={(e) => setHistTo(e.target.value)}
                className="h-9 flex-1 min-w-[8rem] rounded-md border bg-background px-2 text-xs"
              />
              {(histQuery || histStatus !== "all" || histFrom || histTo) && (
                <button
                  onClick={() => { setHistQuery(""); setHistStatus("all"); setHistFrom(""); setHistTo(""); }}
                  className="h-9 rounded-md border px-3 text-xs hover:bg-accent"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Memuat…</div>
          ) : list.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {tab === "ready"
                ? "Belum ada paket. Ketuk + untuk buat paket baru."
                : historyAll.length === 0
                  ? "Belum ada riwayat."
                  : "Tidak ada riwayat yang cocok dengan filter."}
            </div>
          ) : list.map((p) => (
            <PackageCard
              key={p.id}
              pkg={p}
              item={item}
              customers={customers}
              onChanged={() => { reload(); onStockChanged(); }}
            />
          ))}
        </div>

        {tab === "ready" && (
          <footer className="border-t bg-card/95 p-3">
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              + Buat paket baru
            </button>
          </footer>
        )}
      </div>

      {showForm && (
        <PackageForm
          item={item}
          uid={uid}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); reload(); onStockChanged(); }}
        />
      )}
    </div>
  );
}

function PackageCard({
  pkg, item, customers, onChanged,
}: {
  pkg: Pkg;
  item: Item;
  customers: Customer[];
  onChanged: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const [pickWA, setPickWA] = useState(false);

  function buildCaption(targetName: string, targetPhone: string): string {
    const shopName = (localStorage.getItem("shop:name") || "").trim();
    const greetingTarget = targetName?.trim() || targetPhone?.trim() || "";
    // Pakai label satuan dari konfigurasi ecer bila ada (mis. "gram" vs "g")
    let unitLabel: string = item.base_unit;
    try {
      const raw = localStorage.getItem(`ecer:presets:${item.id}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { unit?: "g" | "gram" };
        if (item.base_unit === "g" && (parsed.unit === "g" || parsed.unit === "gram")) {
          unitLabel = parsed.unit;
        }
      }
    } catch { /* ignore */ }
    const qtyText = fmtBase(pkg.qty_base, item.base_unit).replace(/\s*g$/i, ` ${unitLabel}`);
    const qtyLabel = `${qtyText} ${item.name}`;
    const lines: string[] = [];
    lines.push(`✅ PEMBAYARAN DIKONFIRMASI${shopName ? ` - ${shopName.toUpperCase()}` : ""}`);
    lines.push(``);
    lines.push(`Halo${greetingTarget ? ` ${greetingTarget}` : ""}! 👋`);
    lines.push(``);
    lines.push(`Terima kasih! Pembayaran Anda sudah kami terima. ✅`);
    lines.push(``);
    lines.push(`📍 Lokasi pengambilan ${qtyLabel}:`);
    lines.push(qtyLabel);
    if (pkg.note) lines.push(`📝 ${pkg.note}`);
    if (pkg.location_url) {
      lines.push(``);
      lines.push(`🗺️ Buka Maps:`);
      lines.push(pkg.location_url);
    }
    lines.push(``);
    lines.push(`Silakan ambil produk di lokasi tersebut ya kak. Jika ada pertanyaan, balas pesan ini. Terima kasih! 🙏`);
    return lines.join("\n");
  }

  async function copyCaption() {
    const text = buildCaption("", "");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Caption disalin — tinggal tempel di WhatsApp.");
    } catch {
      // Fallback for browsers without Clipboard API
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast.success("Caption disalin."); }
      catch { toast.error("Gagal menyalin — salin manual dari pratinjau."); }
      ta.remove();
    }
  }

  async function doShare(targetName: string, targetPhone: string) {
    setSharing(true);
    try {
      const text = buildCaption(targetName, targetPhone);

      const files: File[] = [];
      if (pkg.photo_path) {
        const { data, error } = await supabase.storage.from("ready-packages").createSignedUrl(pkg.photo_path, 600);
        logStorageError({ bucket: "ready-packages", op: "createSignedUrl", path: pkg.photo_path, source: "doShare" }, error);
        if (data?.signedUrl) {
          const f = await urlToFile(data.signedUrl, `${item.name.replace(/\W+/g, "-")}.jpg`);
          if (f) files.push(f);
          else toast.warning("Foto tidak bisa diambil — coba lagi atau periksa koneksi.");
        }
      }

      // Jika ada foto: jangan kirim phone agar share sheet sistem muncul
      // (di Android tap "WhatsApp" → foto otomatis terlampir + teks jadi caption).
      // Tanpa foto: pakai wa.me ke nomor langsung.
      const res = await previewAndShareWA({
        text,
        title: item.name,
        files,
        phone: files.length === 0 ? (targetPhone || undefined) : undefined,
      });
      setPickWA(false);
      if (res.status === "cancelled" || res.status === "failed") {
        // Tidak jadi kirim — paket tetap "ready", tak perlu tanya lanjut.
        return;
      }
      // After share — ask what to do
      const choice = await confirmThreeWay({
        title: "Pengiriman berhasil?",
        description: "Pilih apa yang dilakukan dengan paket ini.",
      });
      if (choice === "archive") {
        const { error } = await supabase.from("ready_packages").update({
          status: "archived",
          sent_at: new Date().toISOString(),
          sent_to_name: targetName || null,
          sent_to_phone: targetPhone || null,
        }).eq("id", pkg.id);
        if (error) toast.error(friendlyError(error));
        else { toast.success("Tersimpan di riwayat"); onChanged(); }
      } else if (choice === "delete") {
        // Permanently delete (foto + row). Stock stays deducted because we mark sent first.
        const { error: e1 } = await supabase.from("ready_packages").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          sent_to_name: targetName || null,
          sent_to_phone: targetPhone || null,
        }).eq("id", pkg.id);
        if (e1) { toast.error(friendlyError(e1)); return; }
        if (pkg.photo_path) {
          const { error: rmErr } = await supabase.storage.from("ready-packages").remove([pkg.photo_path]);
          logStorageError({ bucket: "ready-packages", op: "remove", path: pkg.photo_path, source: "doShare.delete" }, rmErr);
        }
        const { error: e2 } = await supabase.from("ready_packages").delete().eq("id", pkg.id);
        if (e2) { toast.error(friendlyError(e2)); return; }
        toast.success("Paket dihapus");
        onChanged();
      }
      // 'cancel' → do nothing, package remains 'ready'
    } finally {
      setSharing(false);
    }
  }

  async function deleteReady() {
    if (!(await confirm({
      title: "Hapus paket?",
      description: "Stok akan dikembalikan ke gudang. Foto ikut terhapus.",
      confirmText: "Hapus",
    }))) return;
    if (pkg.photo_path) {
      const { error: rmErr } = await supabase.storage.from("ready-packages").remove([pkg.photo_path]);
      logStorageError({ bucket: "ready-packages", op: "remove", path: pkg.photo_path, source: "deleteReady" }, rmErr);
    }
    const { error } = await supabase.from("ready_packages").delete().eq("id", pkg.id);
    if (error) toast.error(friendlyError(error));
    else { toast.success("Paket dihapus, stok dikembalikan"); onChanged(); }
  }

  async function deleteHistory() {
    if (!(await confirm({
      title: "Hapus dari riwayat?",
      description: "Foto dan link lokasi ikut terhapus permanen.",
      confirmText: "Hapus",
    }))) return;
    if (pkg.photo_path) {
      const { error: rmErr } = await supabase.storage.from("ready-packages").remove([pkg.photo_path]);
      logStorageError({ bucket: "ready-packages", op: "remove", path: pkg.photo_path, source: "deleteHistory" }, rmErr);
    }
    const { error } = await supabase.from("ready_packages").delete().eq("id", pkg.id);
    if (error) toast.error(friendlyError(error));
    else { toast.success("Riwayat dihapus"); onChanged(); }
  }

  async function setStatus(next: Pkg["status"]) {
    const label = STATUS_LABEL[next].toLowerCase();
    if (!(await confirm({
      title: `Tandai paket sebagai "${STATUS_LABEL[next]}"?`,
      description: next === "cancelled"
        ? "Stok akan dikembalikan ke gudang."
        : `Paket akan dipindahkan ke riwayat dengan status ${label}.`,
      confirmText: "Tandai",
    }))) return;
    const patch: { status: Pkg["status"]; sent_at?: string } = { status: next };
    if (next !== "ready" && !pkg.sent_at) patch.sent_at = new Date().toISOString();
    const { error } = await supabase.from("ready_packages").update(patch).eq("id", pkg.id);
    if (error) toast.error(friendlyError(error));
    else { toast.success(`Status diubah: ${STATUS_LABEL[next]}`); onChanged(); }
  }

  const isReady = pkg.status === "ready";

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex gap-3">
        {pkg.photo_path ? (
          <SignedThumb path={pkg.photo_path} className="h-20 w-20 shrink-0 rounded-md border object-cover bg-muted" />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-dashed text-[10px] text-muted-foreground">
            tanpa foto
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-semibold tabular-nums text-sm">{fmtBase(pkg.qty_base, item.base_unit)}</div>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[pkg.status]}`}>
              {STATUS_LABEL[pkg.status]}
            </span>
          </div>
          {pkg.location_url && /^https:\/\//i.test(pkg.location_url) && (
            <a href={pkg.location_url} target="_blank" rel="noreferrer" className="block truncate text-primary hover:underline">
              📍 {pkg.location_url}
            </a>
          )}
          {pkg.note && <div className="text-muted-foreground line-clamp-2">{pkg.note}</div>}
          {!isReady && pkg.sent_at && (
            <div className="text-[10px] text-muted-foreground">
              Terkirim {new Date(pkg.sent_at).toLocaleString("id-ID")}
              {pkg.sent_to_name && ` · ke ${pkg.sent_to_name}`}
              {pkg.sent_to_phone && ` (${pkg.sent_to_phone})`}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {isReady ? (
          <>
            <button
              disabled={sharing}
              onClick={() => setPickWA(true)}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-[#25D366] px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              💬 Kirim WA
            </button>
            <button
              onClick={copyCaption}
              className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-xs font-semibold hover:bg-accent"
              title="Salin caption ke clipboard tanpa membuka WA"
            >
              📋 Salin
            </button>
            <button
              onClick={() => setStatus("cancelled")}
              className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-xs font-semibold hover:bg-accent"
              title="Batalkan & kembalikan stok"
            >
              Batal
            </button>
            <button
              onClick={deleteReady}
              className="inline-flex h-9 items-center justify-center rounded-md border border-destructive/40 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10"
            >
              🗑
            </button>
          </>
        ) : (
          <>
            <select
              value={pkg.status}
              onChange={(e) => setStatus(e.target.value as Pkg["status"])}
              className="h-9 flex-1 rounded-md border bg-background px-2 text-xs"
              aria-label="Ubah status"
            >
              <option value="sent">Berhasil dikirim</option>
              <option value="archived">Diarsipkan</option>
              <option value="cancelled">Batal</option>
              <option value="failed">Gagal dikirim</option>
            </select>
            <button
              onClick={deleteHistory}
              className="inline-flex h-9 items-center justify-center rounded-md border border-destructive/40 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10"
            >
              🗑
            </button>
          </>
        )}
      </div>

      {pickWA && (
        <WAPicker
          customers={customers}
          onClose={() => setPickWA(false)}
          onPick={(name, phone) => doShare(name, phone)}
        />
      )}
    </div>
  );
}

function WAPicker({
  customers, onClose, onPick,
}: {
  customers: Customer[];
  onClose: () => void;
  onPick: (name: string, phone: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [query, setQuery] = useState("");
  const filtered = query
    ? customers.filter((c) => (c.name + " " + (c.contact ?? "")).toLowerCase().includes(query.toLowerCase()))
    : customers.slice(0, 10);

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border bg-card p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold">Kirim ke pelanggan</div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari pelanggan…"
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        />
        {filtered.length > 0 && (
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => { setName(c.name); setPhone(c.contact ?? ""); }}
                className="block w-full rounded-md border bg-background px-3 py-2 text-left text-xs hover:bg-accent"
              >
                <div className="font-medium">{c.name}</div>
                {c.contact && <div className="text-[10px] text-muted-foreground">{c.contact}</div>}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Nama</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">No. WA (628…)</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="6281234…"
              inputMode="tel"
              className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-md border px-3 py-2 text-xs hover:bg-accent">Batal</button>
          <button
            onClick={() => onPick(name.trim(), phone.trim())}
            className="flex-1 rounded-md bg-[#25D366] px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
          >
            💬 Kirim
          </button>
        </div>
      </div>
    </div>
  );
}

function PackageForm({
  item, uid, onClose, onCreated,
}: {
  item: Item;
  uid: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [qty, setQty] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [locationUrl, setLocationUrl] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Judul Ecer + preset berat (localStorage per item) ──
  type Preset = { label: string; grams: number };
  const ecerKey = `ecer:presets:${item.id}`;
  const [ecerTitle, setEcerTitle] = useState("");
  const [ecerUnit, setEcerUnit] = useState<"g" | "gram">("g");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [showEcer, setShowEcer] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newGrams, setNewGrams] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ecerKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { title?: string; presets?: Preset[]; unit?: "g" | "gram" };
      setEcerTitle(parsed.title ?? "");
      setEcerUnit(parsed.unit === "gram" ? "gram" : "g");
      setPresets(Array.isArray(parsed.presets) ? parsed.presets : []);
    } catch { /* ignore */ }
  }, [ecerKey]);

  function persistEcer(title: string, list: Preset[], unit: "g" | "gram" = ecerUnit) {
    try {
      localStorage.setItem(ecerKey, JSON.stringify({ title, presets: list, unit }));
    } catch { /* ignore */ }
  }

  function addPreset() {
    const label = newLabel.trim();
    const grams = Number(newGrams);
    if (!label) { toast.error("Label preset wajib diisi (mis. 1G)"); return; }
    if (!Number.isFinite(grams) || grams <= 0) { toast.error("Berat harus > 0"); return; }
    const next = [...presets, { label, grams }];
    setPresets(next);
    persistEcer(ecerTitle, next);
    setNewLabel("");
    setNewGrams("");
  }

  function removePreset(idx: number) {
    const next = presets.filter((_, i) => i !== idx);
    setPresets(next);
    persistEcer(ecerTitle, next);
  }

  function pickPreset(p: Preset) {
    setQty(String(p.grams));
    const unitText = item.base_unit === "g" ? ecerUnit : item.base_unit;
    if (!note.trim()) setNote(`${ecerTitle ? ecerTitle + " · " : ""}${p.label} (${p.grams} ${unitText})`);
    toast.success(`Preset ${p.label} dipilih`);
  }

  async function uploadPhoto(file: File) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    setUploadingPhoto(true);
    const { error } = await supabase.storage.from("ready-packages").upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg",
    });
    setUploadingPhoto(false);
    if (error) {
      logStorageError({ bucket: "ready-packages", op: "upload", path, source: "ReadyPackagesPanel.uploadPhoto" }, error);
      toast.error("Gagal upload: " + friendlyError(error));
      return;
    }
    setPhotoPath(path);

    // Auto-fill GPS+link if not yet set
    if (!locationUrl && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setGps({ lat: latitude, lng: longitude });
          setLocationUrl(`https://www.google.com/maps?q=${latitude},${longitude}`);
          toast.success("Lokasi terisi otomatis dari foto");
        },
        () => { /* silent */ },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
      );
    }
  }

  async function takeLocation() {
    if (!navigator.geolocation) { toast.error("GPS tidak tersedia"); return; }
    const tId = toast.loading("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setGps({ lat: latitude, lng: longitude });
        setLocationUrl(`https://www.google.com/maps?q=${latitude},${longitude}`);
        toast.success("Lokasi diambil", { id: tId });
      },
      (err) => toast.error("Gagal: " + friendlyError(err), { id: tId }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  async function pasteLink() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { setLocationUrl(t.trim()); toast.success("Link ditempel"); }
    } catch { toast.error("Tidak bisa membaca clipboard"); }
  }

  async function save() {
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) { toast.error("Jumlah harus > 0"); return; }
    if (qtyNum > item.stock_base) { toast.error(`Stok hanya ${fmtItemQty(item.stock_base, item)}`); return; }
    if (locationUrl && locationUrl.length > 2048) { toast.error("Link lokasi terlalu panjang"); return; }
    if (locationUrl && !/^https:\/\//i.test(locationUrl.trim())) { toast.error("Link lokasi harus diawali https://"); return; }
    if (note && note.length > 1000) { toast.error("Catatan terlalu panjang"); return; }
    setSaving(true);
    const { error } = await supabase.from("ready_packages").insert({
      user_id: uid,
      warehouse_item_id: item.id,
      qty_base: qtyNum,
      photo_path: photoPath,
      location_url: locationUrl.trim() || null,
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      note: note.trim() || null,
      status: "ready",
    });
    setSaving(false);
    if (error) {
      // Clean orphan photo on failure
      if (photoPath) {
        const { error: rmErr } = await supabase.storage.from("ready-packages").remove([photoPath]);
        logStorageError({ bucket: "ready-packages", op: "remove", path: photoPath, source: "save.cleanup" }, rmErr);
      }
      toast.error(friendlyError(error)); return;
    }
    toast.success("Paket dibuat, stok dikurangi");
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-lg border bg-card" onClick={(e) => e.stopPropagation()}>
        <header className="border-b px-4 py-3 text-sm font-semibold">Paket baru — {item.name}</header>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
          {/* Judul Ecer + preset */}
          <div className="rounded-md border bg-background/60 p-2">
            <button
              type="button"
              onClick={() => setShowEcer((v) => !v)}
              className="flex w-full items-center justify-between text-left text-[12px] font-semibold"
            >
              <span>⚖️ Ecer{ecerTitle ? ` — ${ecerTitle}` : ""} {presets.length > 0 && <span className="ml-1 text-[10px] font-normal text-muted-foreground">({presets.length} preset · {item.base_unit === "g" ? ecerUnit : item.base_unit})</span>}</span>
              <span className="text-muted-foreground">{showEcer ? "▲" : "▼"}</span>
            </button>

            {/* Pintasan preset selalu tampil bila ada */}
            {presets.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {presets.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickPreset(p)}
                    className="rounded-full border bg-card px-2.5 py-1 text-[11px] hover:bg-accent"
                    title={`${p.grams} ${item.base_unit === "g" ? ecerUnit : item.base_unit}`}
                  >
                    {p.label} <span className="text-muted-foreground">· {p.grams} {item.base_unit === "g" ? ecerUnit : item.base_unit}</span>
                  </button>
                ))}
              </div>
            )}

            {showEcer && (
              <div className="mt-2 space-y-2">
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Judul ecer (untuk produk ini)</span>
                  <input
                    value={ecerTitle}
                    onChange={(e) => { setEcerTitle(e.target.value); persistEcer(e.target.value, presets); }}
                    placeholder="mis. KRISTAL Ecer"
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                  />
                </label>

                {item.base_unit === "g" && (
                  <div>
                    <div className="text-[11px] text-muted-foreground">Satuan tampilan berat</div>
                    <div className="mt-1 inline-flex rounded-md border bg-background p-0.5">
                      {(["g", "gram"] as const).map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => { setEcerUnit(u); persistEcer(ecerTitle, presets, u); }}
                          className={`h-8 px-3 text-xs rounded-[5px] ${ecerUnit === u ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent"}`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Dipakai di chip preset, judul, catatan, dan caption WA.
                    </p>
                  </div>
                )}

                {presets.length > 0 && (
                  <ul className="space-y-1">
                    {presets.map((p, i) => (
                      <li key={i} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-[12px]">
                        <span className="min-w-12 font-semibold">{p.label}</span>
                        <span className="text-muted-foreground">{p.grams} {item.base_unit === "g" ? ecerUnit : item.base_unit}</span>
                        <button
                          type="button"
                          onClick={() => removePreset(i)}
                          className="ml-auto text-[11px] text-destructive hover:underline"
                        >Hapus</button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="Label (1G)"
                    className="h-9 rounded-md border bg-background px-2 text-xs"
                  />
                  <input
                    type="number" step="0.01" min="0"
                    value={newGrams}
                    onChange={(e) => setNewGrams(e.target.value)}
                    placeholder={`Berat (${item.base_unit === "g" ? ecerUnit : item.base_unit})`}
                    className="h-9 rounded-md border bg-background px-2 text-xs tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={addPreset}
                    className="h-9 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
                  >+ Tambah</button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Contoh: label <b>1G</b> berat <b>0.90</b>. Klik chip preset untuk auto-isi jumlah.
                </p>
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-[11px] text-muted-foreground">
              Jumlah ({item.base_unit}) · stok: {fmtItemQty(item.stock_base, item)}
            </span>
            <input
              type="number"
              step={item.base_unit === "g" ? "0.01" : "1"}
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder={item.base_unit === "g" ? "mis. 0.5" : "mis. 1"}
              className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            />
          </label>

          <div>
            <div className="mb-1 text-[11px] text-muted-foreground">Foto paket (kamera akan otomatis isi lokasi)</div>
            <div className="flex gap-2">
              {photoPath ? (
                <SignedThumb path={photoPath} className="h-20 w-20 rounded-md border object-cover bg-muted" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed text-[10px] text-muted-foreground">tidak ada</div>
              )}
              <div className="flex flex-1 flex-col gap-2">
                <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border bg-background px-2 text-xs hover:bg-accent">
                  📷 {uploadingPhoto ? "Mengunggah…" : "Kamera"}
                  <input type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }} />
                </label>
                <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border bg-background px-2 text-xs hover:bg-accent">
                  🖼️ Galeri
                  <input type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }} />
                </label>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1 text-[11px] text-muted-foreground">Link lokasi pengambilan</div>
            <input
              value={locationUrl}
              onChange={(e) => setLocationUrl(e.target.value)}
              placeholder="https://maps.google.com/?q=…"
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={takeLocation} className="h-10 rounded-md border text-xs hover:bg-accent">📍 Ambil GPS</button>
              <button onClick={pasteLink} className="h-10 rounded-md border text-xs hover:bg-accent">📋 Tempel link</button>
            </div>
          </div>

          <label className="block">
            <span className="text-[11px] text-muted-foreground">Catatan (opsional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-1 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>
        <footer className="flex gap-2 border-t p-3">
          <button onClick={onClose} className="flex-1 rounded-md border px-3 py-2 text-sm hover:bg-accent">Batal</button>
          <button
            disabled={saving || uploadingPhoto}
            onClick={save}
            className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Menyimpan…" : "Simpan paket"}
          </button>
        </footer>
      </div>
    </div>
  );
}

// Tiny three-way confirm built on the page (archive / delete / cancel)
function confirmThreeWay(opts: { title: string; description?: string }): Promise<"archive" | "delete" | "cancel"> {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const cleanup = (r: "archive" | "delete" | "cancel") => {
      document.body.removeChild(root);
      resolve(r);
    };
    root.className = "fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 p-3";
    root.onclick = (e) => { if (e.target === root) cleanup("cancel"); };
    root.innerHTML = `
      <div class="w-full max-w-sm rounded-lg border bg-card p-4 space-y-3" data-stop>
        <div class="text-sm font-semibold">${opts.title}</div>
        ${opts.description ? `<div class="text-xs text-muted-foreground">${opts.description}</div>` : ""}
        <div class="grid gap-2">
          <button data-act="archive" class="h-10 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90">📚 Arsipkan ke riwayat</button>
          <button data-act="delete" class="h-10 rounded-md border border-destructive/40 text-sm font-semibold text-destructive hover:bg-destructive/10">🗑 Hapus permanen</button>
          <button data-act="cancel" class="h-10 rounded-md border text-sm hover:bg-accent">Belum jadi kirim</button>
        </div>
      </div>`;
    root.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => {
      b.onclick = () => cleanup(b.dataset.act as "archive" | "delete" | "cancel");
    });
  });
}