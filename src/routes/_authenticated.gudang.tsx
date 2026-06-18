import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/gudang")({
  head: () => ({
    meta: [
      { title: "Gudang & Supplier · MCM Storage" },
      { name: "description", content: "Kelola stok gudang, supplier, pembelian dan penjualan dengan perhitungan otomatis." },
    ],
  }),
  component: GudangPage,
});

type PackageType = "gram" | "pcs" | "botol" | "sachet";

type Supplier = { id: string; name: string; contact: string | null; notes: string | null };
type WItem = {
  id: string;
  name: string;
  category: string | null;
  package_type: PackageType;
  package_size: number;
  base_unit: "g" | "pcs";
  stock_base: number;
  avg_cost_per_base: number;
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
};
type Payment = {
  id: string;
  supplier_id: string;
  purchase_id: string;
  amount: number;
  note: string | null;
  created_at: string;
};

function rupiah(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}
function fmtBase(n: number, u: "g" | "pcs") {
  const v = Number(n) || 0;
  return u === "g"
    ? `${v.toLocaleString("id-ID", { maximumFractionDigits: 2 })} g`
    : `${v.toLocaleString("id-ID")} pcs`;
}

function defaultBase(pt: PackageType): "g" | "pcs" {
  return pt === "gram" ? "g" : "pcs";
}

function GudangPage() {
  const [tab, setTab] = useState<"stok" | "supplier" | "beli" | "jual" | "hutang" | "riwayat">("stok");
  const [uid, setUid] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<WItem[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);

  async function reloadAll() {
    const [s, w, p, sa] = await Promise.all([
      supabase.from("suppliers").select("*").order("created_at", { ascending: false }),
      supabase.from("warehouse_items").select("*").order("name"),
      supabase.from("purchases").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("sales").select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    if (s.data) setSuppliers(s.data as Supplier[]);
    if (w.data) setItems(w.data as WItem[]);
    if (p.data) setPurchases(p.data as Purchase[]);
    if (sa.data) setSales(sa.data as Sale[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!uid) return;
    reloadAll();
  }, [uid]);

  const itemMap = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const supMap = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers]);

  const totalStokValue = useMemo(
    () => items.reduce((a, i) => a + i.stock_base * i.avg_cost_per_base, 0),
    [items],
  );
  const totalRevenue = useMemo(() => sales.reduce((a, s) => a + Number(s.total_revenue), 0), [sales]);
  const totalCost = useMemo(() => sales.reduce((a, s) => a + Number(s.cost_at_sale), 0), [sales]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 py-3">
          <div className="flex items-center gap-2">
            <Link to="/" className="rounded-md border px-2 py-1 text-xs hover:bg-accent">← Beranda</Link>
            <h1 className="text-base font-bold">📦 Gudang</h1>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Nilai stok: <span className="font-semibold text-foreground">{rupiah(totalStokValue)}</span>
          </div>
        </div>
        <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-3 pb-2 text-xs">
          {([
            ["stok", "Stok"],
            ["supplier", "Supplier"],
            ["beli", "Beli"],
            ["jual", "Jual"],
            ["hutang", "Hutang"],
            ["riwayat", "Riwayat"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`shrink-0 rounded-md border px-3 py-1.5 font-medium ${tab === k ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 p-3">
        {loading && <div className="text-sm text-muted-foreground">Memuat…</div>}

        {tab === "stok" && (
          <StokTab items={items} onChanged={reloadAll} />
        )}
        {tab === "supplier" && (
          <SupplierTab suppliers={suppliers} uid={uid} onChanged={reloadAll} />
        )}
        {tab === "beli" && (
          <BeliTab suppliers={suppliers} items={items} uid={uid} onChanged={reloadAll} />
        )}
        {tab === "jual" && (
          <JualTab items={items} uid={uid} onChanged={reloadAll} />
        )}
        {tab === "hutang" && (
          <HutangTab
            purchases={purchases}
            payments={payments}
            suppliers={suppliers}
            itemMap={itemMap}
            uid={uid}
            onChanged={reloadAll}
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
      </main>
    </div>
  );
}

/* ----------------- STOK ----------------- */
function StokTab({ items, onChanged }: { items: WItem[]; onChanged: () => void }) {
  async function remove(id: string, name: string) {
    if (!confirm(`Hapus barang "${name}"? Semua pembelian/penjualan terkait juga dihapus.`)) return;
    const { error } = await supabase.from("warehouse_items").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Barang dihapus"); onChanged(); }
  }
  if (items.length === 0)
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Belum ada barang. Tambahkan saat mencatat pembelian pertama di tab <b>Beli</b>.
      </div>
    );
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.id} className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{i.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {i.category || "—"} · per {i.package_type}
                {i.package_type !== "pcs" && ` (${i.package_size}${i.base_unit === "g" ? "g" : ""}/kemasan)`}
              </div>
            </div>
            <button
              onClick={() => remove(i.id, i.name)}
              className="shrink-0 rounded border px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
            >
              Hapus
            </button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
            <div className="rounded bg-muted/50 p-2">
              <div className="text-muted-foreground">Stok</div>
              <div className="font-semibold">{fmtBase(i.stock_base, i.base_unit)}</div>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <div className="text-muted-foreground">HPP / {i.base_unit}</div>
              <div className="font-semibold">{rupiah(i.avg_cost_per_base)}</div>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <div className="text-muted-foreground">Nilai</div>
              <div className="font-semibold">{rupiah(i.stock_base * i.avg_cost_per_base)}</div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ----------------- SUPPLIER ----------------- */
function SupplierTab({ suppliers, uid, onChanged }: { suppliers: Supplier[]; uid: string | null; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  function resetForm() {
    setEditingId(null); setName(""); setContact(""); setNotes("");
  }
  function startEdit(s: Supplier) {
    setEditingId(s.id);
    setName(s.name);
    setContact(s.contact ?? "");
    setNotes(s.notes ?? "");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !name.trim()) return;
    const payload = {
      name: name.trim(),
      contact: contact.trim() || null,
      notes: notes.trim() || null,
    };
    if (editingId) {
      const { error } = await supabase.from("suppliers").update(payload).eq("id", editingId);
      if (error) { toast.error(error.message); return; }
      toast.success("Supplier diperbarui");
    } else {
      const { error } = await supabase.from("suppliers").insert({ user_id: uid, ...payload });
      if (error) { toast.error(error.message); return; }
      toast.success("Supplier ditambahkan");
    }
    resetForm();
    onChanged();
  }
  async function remove(id: string, n: string) {
    if (!confirm(`Hapus supplier "${n}"?`)) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Supplier dihapus");
      if (editingId === id) resetForm();
      onChanged();
    }
  }
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-2 rounded-lg border bg-card p-3">
        <div className="text-xs font-semibold">{editingId ? "Edit Supplier" : "Tambah Supplier"}</div>
        <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Nama supplier *" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Kontak (opsional)" value={contact} onChange={(e) => setContact(e.target.value)} />
        <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Catatan (opsional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex gap-2">
          <button className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
            {editingId ? "Perbarui" : "Simpan"}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="rounded-md border px-3 py-2 text-sm hover:bg-accent">
              Batal
            </button>
          )}
        </div>
      </form>
      {suppliers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada supplier.</div>
      ) : (
        <ul className="space-y-2">
          {suppliers.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-2 rounded-lg border bg-card p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{s.name}</div>
                {s.contact && <div className="text-[11px] text-muted-foreground">📞 {s.contact}</div>}
                {s.notes && <div className="text-[11px] text-muted-foreground">{s.notes}</div>}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => startEdit(s)}
                  className={`rounded border px-2 py-1 text-[11px] hover:bg-accent ${editingId === s.id ? "border-primary text-primary" : ""}`}
                >
                  Edit
                </button>
                <button onClick={() => remove(s.id, s.name)} className="rounded border px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10">Hapus</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----------------- BELI ----------------- */
function BeliTab({ suppliers, items, uid, onChanged }: { suppliers: Supplier[]; items: WItem[]; uid: string | null; onChanged: () => void }) {
  const [supplierId, setSupplierId] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [itemId, setItemId] = useState("");
  // new item
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [packageType, setPackageType] = useState<PackageType>("botol");
  const [packageSize, setPackageSize] = useState("500");
  // purchase
  const [packageQty, setPackageQty] = useState("1");
  const [pricePerPackage, setPricePerPackage] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"kas" | "hutang">("kas");

  useEffect(() => {
    if (mode === "existing" && !itemId && items[0]) setItemId(items[0].id);
  }, [mode, items, itemId]);

  const baseUnit = defaultBase(packageType);
  const effectivePkgSize = packageType === "pcs" ? 1 : Number(packageSize) || 0;
  const pkgQ = Number(packageQty) || 0;
  const price = Number(pricePerPackage) || 0;
  const baseAdded = pkgQ * effectivePkgSize;
  const totalCost = pkgQ * price;

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
      const { data, error } = await supabase.from("warehouse_items").insert({
        user_id: uid,
        name: name.trim(),
        category: category.trim() || null,
        package_type: packageType,
        package_size: packageType === "pcs" ? 1 : effectivePkgSize,
        base_unit: baseUnit,
      }).select().single();
      if (error || !data) { toast.error(error?.message || "Gagal buat barang"); return; }
      useItemId = (data as WItem).id;
      useSize = (data as WItem).package_size;
    } else {
      const it = items.find((i) => i.id === itemId);
      if (!it) { toast.error("Pilih barang"); return; }
      useSize = it.package_size;
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
    if (error) { toast.error(error.message); return; }
    toast.success(`Pembelian dicatat (${paymentMethod === "hutang" ? "hutang" : "kas"}), stok bertambah`);
    setName(""); setCategory(""); setPackageQty("1"); setPricePerPackage("");
    onChanged();
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border bg-card p-3">
      <div className="text-xs font-semibold">Catat Pembelian</div>

      <label className="block">
        <span className="text-[11px] text-muted-foreground">Supplier</span>
        <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">— Tanpa supplier —</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>

      <div className="flex gap-1 text-xs">
        <button type="button" onClick={() => setMode("new")} className={`flex-1 rounded border px-2 py-1 ${mode === "new" ? "bg-primary text-primary-foreground border-primary" : ""}`}>Barang baru</button>
        <button type="button" onClick={() => setMode("existing")} className={`flex-1 rounded border px-2 py-1 ${mode === "existing" ? "bg-primary text-primary-foreground border-primary" : ""}`} disabled={items.length === 0}>Barang yang ada</button>
      </div>

      {mode === "new" ? (
        <div className="space-y-2">
          <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Nama barang *" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Kategori (opsional, mis. Minuman)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Jenis kemasan</span>
              <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={packageType} onChange={(e) => setPackageType(e.target.value as PackageType)}>
                <option value="gram">gram (curah)</option>
                <option value="botol">botol</option>
                <option value="sachet">sachet</option>
                <option value="pcs">pcs</option>
              </select>
            </label>
            {packageType !== "pcs" && (
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Isi / kemasan ({baseUnit})</span>
                <input type="number" step="0.01" min="0.01" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={packageSize} onChange={(e) => setPackageSize(e.target.value)} required />
              </label>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Stok disimpan dalam <b>{baseUnit}</b>. Saat dijual per {baseUnit}, akan dikurangi otomatis.
          </div>
        </div>
      ) : (
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Pilih barang</span>
          <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={itemId} onChange={(e) => setItemId(e.target.value)} required>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.package_type}{i.package_type !== "pcs" ? ` ${i.package_size}${i.base_unit}` : ""}) · stok {fmtBase(i.stock_base, i.base_unit)}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Jumlah kemasan</span>
          <input type="number" step="0.01" min="0.01" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={packageQty} onChange={(e) => setPackageQty(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Harga / kemasan (Rp)</span>
          <input type="number" step="1" min="0" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={pricePerPackage} onChange={(e) => setPricePerPackage(e.target.value)} required />
        </label>
      </div>

      <div>
        <div className="text-[11px] text-muted-foreground mb-1">Cara bayar</div>
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setPaymentMethod("kas")}
            className={`flex-1 rounded border px-2 py-1.5 ${paymentMethod === "kas" ? "bg-primary text-primary-foreground border-primary" : ""}`}
          >
            💵 Kas (lunas)
          </button>
          <button
            type="button"
            onClick={() => setPaymentMethod("hutang")}
            className={`flex-1 rounded border px-2 py-1.5 ${paymentMethod === "hutang" ? "bg-amber-500 text-white border-amber-500" : ""}`}
          >
            📝 Hutang
          </button>
        </div>
      </div>

      <div className="rounded-md bg-muted/50 p-2 text-[11px]">
        <div>Total tambahan stok: <b>{fmtBase(baseAdded, baseUnit)}</b></div>
        <div>Total biaya: <b>{rupiah(totalCost)}</b> ({paymentMethod === "hutang" ? "hutang ke supplier" : "lunas tunai"})</div>
        {baseAdded > 0 && <div>Modal per {baseUnit}: <b>{rupiah(totalCost / baseAdded)}</b></div>}
      </div>

      <button className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Simpan pembelian</button>
    </form>
  );
}

/* ----------------- JUAL ----------------- */
function JualTab({ items, uid, onChanged }: { items: WItem[]; uid: string | null; onChanged: () => void }) {
  const [itemId, setItemId] = useState("");
  const [sellMode, setSellMode] = useState<"base" | "package">("base");
  const [qty, setQty] = useState("");
  const [pricePerBase, setPricePerBase] = useState("");
  const [pricePerPackage, setPricePerPackage] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!itemId && items[0]) setItemId(items[0].id);
  }, [items, itemId]);

  const item = items.find((i) => i.id === itemId);
  const qtyN = Number(qty) || 0;
  const qtyBase = item
    ? (sellMode === "base" ? qtyN : qtyN * item.package_size)
    : 0;
  const pricePerBaseEff = item
    ? (sellMode === "base"
        ? Number(pricePerBase) || 0
        : item.package_size > 0
          ? (Number(pricePerPackage) || 0) / item.package_size
          : 0)
    : 0;
  const total = qtyBase * pricePerBaseEff;
  const profit = item ? (pricePerBaseEff - item.avg_cost_per_base) * qtyBase : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !item) return;
    if (qtyBase <= 0) { toast.error("Jumlah harus > 0"); return; }
    if (qtyBase > item.stock_base) { toast.error(`Stok kurang. Tersedia ${fmtBase(item.stock_base, item.base_unit)}`); return; }
    const { error } = await supabase.from("sales").insert({
      user_id: uid,
      item_id: item.id,
      qty_base: qtyBase,
      price_per_base: pricePerBaseEff,
      total_revenue: total,
      cost_at_sale: 0, // recomputed in trigger
      note: note.trim() || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Penjualan dicatat, stok berkurang");
    setQty(""); setPricePerBase(""); setPricePerPackage(""); setNote("");
    onChanged();
  }

  if (items.length === 0) {
    return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada barang. Catat pembelian dulu di tab <b>Beli</b>.</div>;
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border bg-card p-3">
      <div className="text-xs font-semibold">Catat Penjualan</div>

      <label className="block">
        <span className="text-[11px] text-muted-foreground">Barang</span>
        <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} · stok {fmtBase(i.stock_base, i.base_unit)} · HPP {rupiah(i.avg_cost_per_base)}/{i.base_unit}
            </option>
          ))}
        </select>
      </label>

      {item && (
        <>
          <div className="flex gap-1 text-xs">
            <button type="button" onClick={() => setSellMode("base")} className={`flex-1 rounded border px-2 py-1 ${sellMode === "base" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
              Jual per {item.base_unit}
            </button>
            {item.package_type !== "pcs" && (
              <button type="button" onClick={() => setSellMode("package")} className={`flex-1 rounded border px-2 py-1 ${sellMode === "package" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                Jual per {item.package_type}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">
                Jumlah ({sellMode === "base" ? item.base_unit : item.package_type})
              </span>
              <input type="number" step="0.01" min="0.01" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={qty} onChange={(e) => setQty(e.target.value)} required />
            </label>
            {sellMode === "base" ? (
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Harga / {item.base_unit} (Rp)</span>
                <input type="number" step="1" min="0" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={pricePerBase} onChange={(e) => setPricePerBase(e.target.value)} required />
              </label>
            ) : (
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Harga / {item.package_type} (Rp)</span>
                <input type="number" step="1" min="0" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={pricePerPackage} onChange={(e) => setPricePerPackage(e.target.value)} required />
              </label>
            )}
          </div>

          <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />

          <div className="rounded-md bg-muted/50 p-2 text-[11px] space-y-0.5">
            <div>Akan kurangi stok: <b>{fmtBase(qtyBase, item.base_unit)}</b> (sisa {fmtBase(Math.max(0, item.stock_base - qtyBase), item.base_unit)})</div>
            <div>Total pendapatan: <b>{rupiah(total)}</b></div>
            <div className={profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
              Estimasi laba: <b>{rupiah(profit)}</b>
            </div>
          </div>

          <button className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Simpan penjualan</button>
        </>
      )}
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
    if (!confirm("Hapus pembelian ini? Stok akan dikurangi sesuai isi pembelian.")) return;
    const { error } = await supabase.from("purchases").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Pembelian dihapus"); onChanged(); }
  }
  async function delSale(id: string) {
    if (!confirm("Hapus penjualan ini? Stok akan dikembalikan.")) return;
    const { error } = await supabase.from("sales").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Penjualan dihapus"); onChanged(); }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-md border bg-card p-2">
          <div className="text-muted-foreground">Pendapatan</div>
          <div className="text-sm font-semibold">{rupiah(totalRevenue)}</div>
        </div>
        <div className="rounded-md border bg-card p-2">
          <div className="text-muted-foreground">Modal terjual</div>
          <div className="text-sm font-semibold">{rupiah(totalCost)}</div>
        </div>
        <div className="rounded-md border bg-card p-2">
          <div className="text-muted-foreground">Laba</div>
          <div className={`text-sm font-semibold ${totalRevenue - totalCost >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
            {rupiah(totalRevenue - totalCost)}
          </div>
        </div>
      </div>

      <div className="flex gap-1 text-xs">
        <button onClick={() => setSub("jual")} className={`flex-1 rounded border px-2 py-1 ${sub === "jual" ? "bg-primary text-primary-foreground border-primary" : ""}`}>Penjualan</button>
        <button onClick={() => setSub("beli")} className={`flex-1 rounded border px-2 py-1 ${sub === "beli" ? "bg-primary text-primary-foreground border-primary" : ""}`}>Pembelian</button>
      </div>

      {sub === "jual" ? (
        sales.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada penjualan.</div>
        ) : (
          <ul className="space-y-2">
            {sales.map((s) => {
              const it = itemMap[s.item_id];
              return (
                <li key={s.id} className="rounded-lg border bg-card p-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{it?.name || "(barang dihapus)"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(s.created_at).toLocaleString("id-ID")} {s.note && `· ${s.note}`}
                      </div>
                    </div>
                    <button onClick={() => delSale(s.id)} className="shrink-0 rounded border px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10">Hapus</button>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    <div><span className="text-muted-foreground">Jumlah </span><b>{fmtBase(Number(s.qty_base), it?.base_unit || "pcs")}</b></div>
                    <div><span className="text-muted-foreground">Harga </span><b>{rupiah(Number(s.price_per_base))}/{it?.base_unit || "pcs"}</b></div>
                    <div><span className="text-muted-foreground">Total </span><b>{rupiah(Number(s.total_revenue))}</b></div>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        purchases.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada pembelian.</div>
        ) : (
          <ul className="space-y-2">
            {purchases.map((p) => {
              const it = itemMap[p.item_id];
              const sup = p.supplier_id ? supMap[p.supplier_id] : null;
              return (
                <li key={p.id} className="rounded-lg border bg-card p-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{it?.name || "(barang dihapus)"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(p.created_at).toLocaleString("id-ID")} · dari {sup?.name || "—"}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${p.payment_method === "hutang" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"}`}>
                        {p.payment_method === "hutang" ? "📝 Hutang" : "💵 Kas"}
                      </span>
                      <button onClick={() => delPurchase(p.id)} className="rounded border px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10">Hapus</button>
                    </div>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    <div><span className="text-muted-foreground">Kemasan </span><b>{Number(p.package_qty)} × {Number(p.package_size_snapshot)}{it?.base_unit || ""}</b></div>
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