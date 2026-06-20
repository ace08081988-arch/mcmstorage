import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/friendly-error";
import { confirm } from "@/lib/confirm";
import { shareToWhatsApp, urlToFile } from "@/lib/share-wa";
import { fmtBase } from "@/routes/_authenticated.gudang";

type Item = {
  id: string;
  name: string;
  base_unit: "g" | "pcs";
  stock_base: number;
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
  status: "ready" | "sent" | "archived";
  sent_at: string | null;
  sent_to_name: string | null;
  sent_to_phone: string | null;
  created_at: string;
};

const signedCache = new Map<string, { url: string; exp: number }>();
function SignedThumb({ path, className }: { path: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const c = signedCache.get(path);
    if (c && c.exp > Date.now()) { setUrl(c.url); return; }
    supabase.storage.from("ready-packages").createSignedUrl(path, 3600).then(({ data }) => {
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

  const list = pkgs.filter((p) => (tab === "ready" ? p.status === "ready" : p.status !== "ready"));

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-3" onClick={onClose}>
      <div className="flex h-[95vh] w-full max-w-2xl flex-col rounded-t-lg sm:rounded-lg border bg-card" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">📦 Paket Siap Kirim</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {item.name} · stok: {fmtBase(item.stock_base, item.base_unit)}
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
            Riwayat ({pkgs.filter((p) => p.status !== "ready").length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Memuat…</div>
          ) : list.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {tab === "ready" ? "Belum ada paket. Ketuk + untuk buat paket baru." : "Belum ada riwayat."}
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

  async function doShare(targetName: string, targetPhone: string) {
    setSharing(true);
    try {
      const lines = [
        `Halo${targetName ? " " + targetName : ""},`,
        ``,
        `Pesanan ${item.name} (${fmtBase(pkg.qty_base, item.base_unit)}) siap diambil.`,
      ];
      if (pkg.note) lines.push(``, `Catatan: ${pkg.note}`);
      if (pkg.location_url) lines.push(``, `📍 Lokasi: ${pkg.location_url}`);
      const text = lines.join("\n");

      const files: File[] = [];
      if (pkg.photo_path) {
        const { data } = await supabase.storage.from("ready-packages").createSignedUrl(pkg.photo_path, 600);
        if (data?.signedUrl) {
          const f = await urlToFile(data.signedUrl, `${item.name.replace(/\W+/g, "-")}.jpg`);
          if (f) files.push(f);
        }
      }

      const res = await shareToWhatsApp({ text, title: item.name, files, phone: targetPhone || undefined });
      if (res === "fallback") {
        toast.message("Foto tidak bisa dilampirkan otomatis di perangkat ini — terbuka di WhatsApp, lampirkan foto manual.");
      }
      setPickWA(false);
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
        if (pkg.photo_path) await supabase.storage.from("ready-packages").remove([pkg.photo_path]);
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
    if (pkg.photo_path) await supabase.storage.from("ready-packages").remove([pkg.photo_path]);
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
    if (pkg.photo_path) await supabase.storage.from("ready-packages").remove([pkg.photo_path]);
    const { error } = await supabase.from("ready_packages").delete().eq("id", pkg.id);
    if (error) toast.error(friendlyError(error));
    else { toast.success("Riwayat dihapus"); onChanged(); }
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
          <div className="font-semibold tabular-nums text-sm">{fmtBase(pkg.qty_base, item.base_unit)}</div>
          {pkg.location_url && (
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
              onClick={deleteReady}
              className="inline-flex h-9 items-center justify-center rounded-md border border-destructive/40 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10"
            >
              🗑
            </button>
          </>
        ) : (
          <button
            onClick={deleteHistory}
            className="inline-flex h-9 w-full items-center justify-center rounded-md border border-destructive/40 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10"
          >
            🗑 Hapus riwayat
          </button>
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

  async function uploadPhoto(file: File) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    setUploadingPhoto(true);
    const { error } = await supabase.storage.from("ready-packages").upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg",
    });
    setUploadingPhoto(false);
    if (error) { toast.error("Gagal upload: " + friendlyError(error)); return; }
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
    if (qtyNum > item.stock_base) { toast.error(`Stok hanya ${fmtBase(item.stock_base, item.base_unit)}`); return; }
    if (locationUrl && locationUrl.length > 2048) { toast.error("Link lokasi terlalu panjang"); return; }
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
      if (photoPath) await supabase.storage.from("ready-packages").remove([photoPath]);
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
          <label className="block">
            <span className="text-[11px] text-muted-foreground">
              Jumlah ({item.base_unit}) · stok: {fmtBase(item.stock_base, item.base_unit)}
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