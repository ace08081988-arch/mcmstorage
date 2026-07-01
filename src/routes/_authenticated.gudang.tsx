import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
} from "lucide-react";
import { friendlyError } from "@/lib/friendly-error";
import { StatusBadge } from "@/components/StatusBadge";
import { buildMailto, isValidEmail } from "@/lib/mailto";
import { supabase } from "@/integrations/supabase/client";
import { logStorageError } from "@/lib/storage-log";
import { confirm } from "@/lib/confirm";
import { ReadyPackagesPanel } from "@/components/ReadyPackagesPanel";
import { useMyProfile } from "@/lib/profile";
import { normalizeWaNumber } from "@/lib/phone";

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
    toast.error("Gagal upload foto: " + friendlyError(error));
    return null;
  }
  return path;
}

function PhotoPicker({ value, onChange, uid }: { value: string | null; onChange: (p: string | null) => void; uid: string | null }) {
  const [busy, setBusy] = useState(false);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f || !uid) return;
    setBusy(true);
    const p = await uploadItemPhoto(f, uid);
    setBusy(false);
    if (p) onChange(p);
    e.target.value = "";
  }
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-muted-foreground">Foto barang (opsional)</div>
      <div className="flex items-center gap-2">
        {value ? (
          <SignedImg path={value} className="h-16 w-16 rounded-md border object-cover bg-muted" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed text-[11px] text-muted-foreground">Tidak ada</div>
        )}
        <label className="flex-1 cursor-pointer rounded-md border bg-background px-2 py-1.5 text-center text-xs hover:bg-accent">
          {busy ? "Mengunggah…" : "📷 Ambil / Pilih foto"}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} disabled={busy} />
        </label>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="rounded-md border px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10">Hapus</button>
        )}
      </div>
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

function GudangPage() {
  const [tab, setTab] = useState<
    "stok" | "supplier" | "beli" | "jual" | "pesanan" | "hutang" | "pelanggan" | "piutang" | "riwayat"
  >("stok");
  const [uid, setUid] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [beliDefaultPayment, setBeliDefaultPayment] = useState<"kas" | "hutang">("kas");
  const [beliPresetKey, setBeliPresetKey] = useState(0);
  const [items, setItems] = useState<WItem[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [custPayments, setCustPayments] = useState<CustomerPayment[]>([]);
  const [orders, setOrders] = useState<OrderRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);

  async function reloadAll() {
    const [s, w, p, sa, py, c, cp, or] = await Promise.all([
      supabase.from("suppliers").select("*").order("created_at", { ascending: false }),
      supabase.from("warehouse_items").select("*").order("name"),
      supabase.from("purchases").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("sales").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("supplier_payments").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("customers").select("*").order("created_at", { ascending: false }),
      supabase.from("customer_payments").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("order_requests").select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    if (s.data) setSuppliers(s.data as Supplier[]);
    if (w.data) setItems(w.data as WItem[]);
    if (p.data) setPurchases(p.data as Purchase[]);
    if (sa.data) setSales(sa.data as Sale[]);
    if (py.data) setPayments(py.data as Payment[]);
    if (c.data) setCustomers(c.data as Customer[]);
    if (cp.data) setCustPayments(cp.data as CustomerPayment[]);
    if (or.data) setOrders(or.data as OrderRequest[]);
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

  const navItems = [
    { k: "stok", label: "Stok", icon: Boxes },
    { k: "supplier", label: "Supplier", icon: Truck },
    { k: "beli", label: "Beli", icon: ShoppingCart },
    { k: "jual", label: "Jual", icon: Banknote },
    { k: "pesanan", label: "Pesanan", icon: ClipboardList },
    { k: "hutang", label: "Hutang", icon: CreditCard },
    { k: "pelanggan", label: "Pelanggan", icon: Users },
    { k: "piutang", label: "Piutang", icon: Wallet },
    { k: "riwayat", label: "Riwayat", icon: History },
  ] as const;

  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      {/* Sidebar — md+ */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r bg-card md:flex md:flex-col">
        <div className="border-b px-4 py-4">
          <Link to="/" className="text-[11px] text-muted-foreground hover:underline">← Beranda</Link>
          <h1 className="mt-1 text-lg font-bold">📦 Gudang</h1>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Nilai stok
          </p>
          <p className="text-sm font-semibold">{rupiah(totalStokValue)}</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {navItems.map(({ k, label, icon: Icon }) => {
            const active = tab === k;
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-foreground/80 hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile header + horizontal nav */}
      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur md:hidden">
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
            {navItems.map(({ k, label }) => (
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

        <main className="mx-auto max-w-3xl space-y-4 p-3 md:max-w-4xl md:p-6">
        {loading && <div className="text-sm text-muted-foreground">Memuat…</div>}

        {tab === "stok" && (
          <StokTab items={items} uid={uid} onChanged={reloadAll} />
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
  const normalizedMyPhone = normalizeWaNumber(myProfile?.phone, myProfile?.country_code);
  const canUseMyContact = !!(myProfile?.display_name || normalizedMyPhone);
  function useMyContact() {
    if (!myProfile) return;
    const filled: string[] = [];
    if (myProfile.display_name) { setName(myProfile.display_name); filled.push("nama"); }
    if (normalizedMyPhone) { setContact(normalizedMyPhone); filled.push("no. MCM"); }
    else if (myProfile.phone) {
      toast.warning("Nomor MCM di profil tidak valid — perbarui di halaman Profil Akun");
    }
    if (filled.length) toast.success(`Diisi dari akun Anda (${filled.join(" & ")})`);
  }

  function resetForm() { setEditingId(null); setName(""); setContact(""); setNotes(""); }
  function startEdit(c: Customer) {
    setEditingId(c.id); setName(c.name); setContact(c.contact ?? ""); setNotes(c.notes ?? "");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !name.trim()) return;
    const payload = { name: name.trim(), contact: contact.trim() || null, notes: notes.trim() || null };
    if (editingId) {
      const { error } = await supabase.from("customers").update(payload).eq("id", editingId);
      if (error) { toast.error(friendlyError(error)); return; }
      toast.success("Pelanggan diperbarui");
    } else {
      const { error } = await supabase.from("customers").insert({ user_id: uid, ...payload });
      if (error) { toast.error(friendlyError(error)); return; }
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
    if (error) toast.error(friendlyError(error));
    else { toast.success("Pelanggan dihapus"); if (editingId === id) resetForm(); onChanged(); }
  }
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-2 rounded-lg border bg-card p-3">
        <div className="text-xs font-semibold">{editingId ? "Edit Pelanggan" : "Tambah Pelanggan"}</div>
        <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Nama pelanggan *" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="No. MCM / kontak (opsional)" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={50} />
        <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Catatan (opsional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
        <button
          type="button"
          onClick={useMyContact}
          disabled={!canUseMyContact}
          className="w-full rounded-md border border-dashed px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
          title={canUseMyContact ? "Isi nama & no. MCM dari profil akun Anda" : "Lengkapi profil akun terlebih dahulu"}
        >
          👤 Pakai kontak akun saya
        </button>
        <div className="flex gap-2">
          <button className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">{editingId ? "Perbarui" : "Simpan"}</button>
          {editingId && <button type="button" onClick={resetForm} className="rounded-md border px-3 py-2 text-sm hover:bg-accent">Batal</button>}
        </div>
      </form>
      {customers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada pelanggan.</div>
      ) : (
        <ul className="space-y-2">
          {customers.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2 rounded-lg border bg-card p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold" title={c.name}>{c.name}</div>
                {c.contact && <div className="text-[11px] text-muted-foreground">📞 {c.contact}</div>}
                {c.notes && <div className="text-[11px] text-muted-foreground">{c.notes}</div>}
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => startEdit(c)} className={`rounded border px-2 py-1 text-[11px] hover:bg-accent ${editingId === c.id ? "border-primary text-primary" : ""}`}>Edit</button>
                <button onClick={() => remove(c.id, c.name)} className="rounded border px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10">Hapus</button>
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
  customers, sales, custPayments, itemMap, uid, onChanged, onLocalPayment, onLocalRemovePayment,
}: {
  customers: Customer[];
  sales: Sale[];
  custPayments: CustomerPayment[];
  itemMap: Record<string, WItem>;
  uid: string | null;
  onChanged: () => void;
  onLocalPayment: (p: CustomerPayment) => void;
  onLocalRemovePayment: (id: string) => void;
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

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Belum ada catatan piutang/kelebihan pelanggan. Jual dengan cara bayar <b>Hutang</b> di tab Jual untuk mulai mencatat.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-md border bg-card p-2">
          <div className="text-muted-foreground">Total piutang (pelanggan hutang)</div>
          <div className="text-sm font-semibold text-amber-600 dark:text-amber-400">{rupiah(totals.owed)}</div>
        </div>
        <div className="rounded-md border bg-card p-2">
          <div className="text-muted-foreground">Total kelebihan/deposit</div>
          <div className="text-sm font-semibold text-sky-600 dark:text-sky-400">{rupiah(totals.credit)}</div>
        </div>
      </div>

      {groups.map((g) => {
        const status: "hutang" | "lunas" | "kelebihan" =
          g.balance > 0.001 ? "hutang" : g.balance < -0.001 ? "kelebihan" : "lunas";
        return (
          <div key={g.customer.id} className="space-y-2 rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold" title={g.customer.name}>{g.customer.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  Hutang {rupiah(g.totalHutang)} · Bayar {rupiah(g.totalBayar)}
                </div>
              </div>
              <StatusBadge variant={status}>
                {status === "hutang" ? `Sisa ${rupiah(g.balance)}`
                  : status === "kelebihan" ? `Kelebihan ${rupiah(-g.balance)}`
                  : "✓ Lunas"}
              </StatusBadge>
            </div>

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
                    <li key={s.id} className="rounded border bg-background p-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-semibold" title={it?.name || "(barang dihapus)"}>{it?.name || "(barang dihapus)"}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {new Date(s.created_at).toLocaleDateString("id-ID")} · {fmtItemQty(Number(s.qty_base), it)}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[11px]">
                          <div className="font-semibold">{rupiah(Number(s.total_revenue))}</div>
                        </div>
                      </div>
                    </li>
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
                  <li key={pay.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate">
                      {new Date(pay.created_at).toLocaleDateString("id-ID")} ·{" "}
                      <b className="text-emerald-600 dark:text-emerald-400">{rupiah(Number(pay.amount))}</b>
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
                        const { error } = await supabase.from("customer_payments").delete().eq("id", pay.id);
                        if (error) { toast.error(friendlyError(error)); onChanged(); }
                        else { toast.success("Pembayaran dihapus"); onChanged(); }
                      }}
                      className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10"
                    >
                      Hapus
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
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
    if (error) { toast.error(friendlyError(error)); return; }
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
    <div className="space-y-1.5 rounded border border-dashed p-2">
      <div className="flex gap-1.5">
        <input
          type="number" step="1" min="0"
          placeholder="Nominal terima (Rp)"
          className={`flex-1 rounded border bg-background px-2 py-1 text-xs ${errorMsg ? "border-destructive" : ""}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button type="button" disabled={payDisabled} onClick={() => pay(parsed)}
          className="rounded bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          Terima
        </button>
        {balance > 0.001 && (
          <button type="button" disabled={busy} onClick={() => pay(balance)}
            className="rounded border border-emerald-500 px-2 py-1 text-xs font-semibold text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400">
            Lunasi
          </button>
        )}
      </div>
      {errorMsg && <div className="text-[11px] text-destructive">{errorMsg}</div>}
      <input type="text" placeholder="Catatan (opsional)" maxLength={200}
        className="w-full rounded border bg-background px-2 py-1 text-xs"
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
        toast.error("Browser ini tidak mengizinkan berbagi file. Coba dari MCM/Chrome di HP.");
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
    { label: "Kirim via MCM", emoji: "💬", href: waPhone ? `https://wa.me/${waPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`, cls: "border-emerald-500 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400" },
    { label: "Kirim via MCM Business", emoji: "🏪", href: waPhone ? `whatsapp://send?phone=${waPhone}&text=${encoded}` : `whatsapp://send?text=${encoded}`, cls: "border-emerald-700 text-emerald-700 hover:bg-emerald-700/10 dark:text-emerald-400" },
    { label: "Viber", emoji: "📞", href: waPhone ? `viber://chat?number=%2B${waPhone}&text=${encoded}` : `viber://forward?text=${encoded}`, cls: "border-purple-500 text-purple-600 hover:bg-purple-500/10 dark:text-purple-400" },
    { label: "Telegram", emoji: "✈️", href: `https://t.me/share/url?url=${encodeURIComponent(" ")}&text=${encoded}`, cls: "border-sky-500 text-sky-600 hover:bg-sky-500/10 dark:text-sky-400" },
    { label: "SMS", emoji: "✉️", href: waPhone ? `sms:+${waPhone}?body=${encoded}` : `sms:?body=${encoded}`, cls: "border-amber-500 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400" },
  ];

  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          {customer.contact ? <>📞 {customer.contact}</> : <>Tidak ada nomor kontak — pesan tetap bisa dikirim</>}
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground">
          {open ? "Tutup" : balance > 0.001 ? "📤 Ingatkan tagihan" : "📤 Kirim catatan"}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <textarea readOnly value={message} className="h-32 w-full resize-none rounded border bg-background p-2 text-[11px]" />
          <div className="flex flex-wrap gap-1.5">
            {links.map((l) => (
              <button key={l.label} type="button" onClick={() => openLink(l.href)}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${l.cls}`}>
                {l.emoji} {l.label}
              </button>
            ))}
            <button type="button" onClick={copyText}
              className="rounded-md border px-2 py-1 text-[11px] font-semibold hover:bg-accent">
              📋 Salin
            </button>
            <button type="button" onClick={shareWithPhotos} disabled={sharing || uniqueImagePaths.length === 0}
              className="rounded-md border border-fuchsia-500 px-2 py-1 text-[11px] font-semibold text-fuchsia-600 hover:bg-fuchsia-500/10 disabled:opacity-50 dark:text-fuchsia-400">
              {sharing ? "Menyiapkan…" : `📷 Bagikan + Foto (${uniqueImagePaths.length})`}
            </button>
          </div>
          {uniqueImagePaths.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Tombol "Bagikan + Foto" memakai berbagi bawaan HP (Android/iOS) sehingga foto barang ikut terkirim. Tombol MCM/Telegram di atas hanya mengirim teks karena tidak mendukung lampiran via link.
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
      label: "Kirim via MCM",
      emoji: "💬",
      href: waPhone ? `https://wa.me/${waPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`,
      cls: "border-emerald-500 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400",
    },
    {
      label: "Kirim via MCM Business",
      emoji: "🏪",
      href: waPhone
        ? `whatsapp://send?phone=${waPhone}&text=${encoded}`
        : `whatsapp://send?text=${encoded}`,
      cls: "border-emerald-700 text-emerald-700 hover:bg-emerald-700/10 dark:text-emerald-400",
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
      cls: "border-amber-500 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400",
    },
  ];

  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          {supplier.contact ? <>📞 {supplier.contact}</> : <>Tidak ada nomor kontak — pesan tetap bisa dikirim</>}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground"
        >
          {open ? "Tutup" : "📤 Kirim tagihan"}
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          <textarea
            readOnly
            value={message}
            className="h-28 w-full resize-none rounded border bg-background p-2 text-[11px]"
          />
          <div className="flex flex-wrap gap-1.5">
            {links.map((l) => (
              <button
                key={l.label}
                type="button"
                onClick={() => openLink(l.href)}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${l.cls}`}
              >
                {l.emoji} {l.label}
              </button>
            ))}
            <button
              type="button"
              onClick={copyText}
              className="rounded-md border px-2 py-1 text-[11px] font-semibold hover:bg-accent"
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
function StokTab({ items, uid, onChanged }: { items: WItem[]; uid: string | null; onChanged: () => void }) {
  const [editing, setEditing] = useState<WItem | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  async function remove(id: string, name: string) {
    if (!(await confirm({
      title: "Hapus barang?",
      description: `Barang "${name}" beserta seluruh pembelian dan penjualan terkait akan dihapus permanen.`,
      confirmText: "Hapus",
    }))) return;
    const { error } = await supabase.from("warehouse_items").delete().eq("id", id);
    if (error) toast.error(friendlyError(error));
    else { toast.success("Barang dihapus"); onChanged(); }
  }
  if (items.length === 0)
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Belum ada barang. Tambahkan saat mencatat pembelian pertama di tab <b>Beli</b>.
      </div>
    );

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.category ?? "").toLowerCase().includes(q),
      )
    : items;

  const groups = new Map<string, WItem[]>();
  for (const it of filtered) {
    const key = (it.category ?? "").trim() || "Tanpa Kategori";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }
  const groupKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === "Tanpa Kategori") return 1;
    if (b === "Tanpa Kategori") return -1;
    return a.localeCompare(b, "id");
  });
  for (const k of groupKeys) {
    groups.get(k)!.sort((a, b) => a.name.localeCompare(b.name, "id"));
  }

  const totalItems = items.length;
  const totalValue = items.reduce((s, i) => s + i.stock_base * i.avg_cost_per_base, 0);
  const totalCategories = new Set(items.map((i) => (i.category ?? "").trim() || "Tanpa Kategori")).size;

  return (
    <>
    {/* Ringkasan profesional */}
    <section className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-stretch">
        <div className="flex flex-1 items-center px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Inventaris Gudang
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold tabular-nums">
              {rupiah(totalValue)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 divide-x border-l text-right">
          <Stat label="Item" value={totalItems.toLocaleString("id-ID")} />
          <Stat label="Kategori" value={totalCategories.toLocaleString("id-ID")} />
        </div>
      </div>
      <div className="border-t p-2">
        <input
          type="search"
          placeholder="Cari nama atau kategori…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none ring-primary/20 focus:ring-2"
        />
      </div>
    </section>

    {/* Ringkasan per kategori (berdasarkan seluruh stok, bukan hasil filter) */}
    {(() => {
      const catSummary = new Map<string, { count: number; value: number }>();
      for (const it of items) {
        const key = (it.category ?? "").trim() || "Tanpa Kategori";
        const cur = catSummary.get(key) ?? { count: 0, value: 0 };
        cur.count += 1;
        cur.value += it.stock_base * it.avg_cost_per_base;
        catSummary.set(key, cur);
      }
      const rows = Array.from(catSummary.entries()).sort((a, b) => {
        if (a[0] === "Tanpa Kategori") return 1;
        if (b[0] === "Tanpa Kategori") return -1;
        return b[1].value - a[1].value;
      });
      if (rows.length === 0) return null;
      return (
        <section className="mt-3 overflow-hidden rounded-xl border bg-card shadow-sm">
          <header className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
            <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase leading-none tracking-[0.08em] text-muted-foreground">
              Total per Kategori
            </h3>
            <span
              className="inline-flex h-5 max-w-[7rem] shrink-0 items-center rounded-full border bg-background px-1.5 text-[11px] font-medium leading-none text-muted-foreground tabular-nums"
              title={`${rows.length} kategori`}
            >
              <span className="min-w-0 truncate whitespace-nowrap">{rows.length} kategori</span>
            </span>
          </header>
          <ul className="divide-y text-sm">
            {rows.map(([cat, { count, value }]) => {
              const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
              return (
                <li
                  key={cat}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-muted/30"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${cat === "Tanpa Kategori" ? "bg-muted-foreground/50" : "bg-primary"}`}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium" title={cat}>{cat}</span>
                    <span
                      className="inline-flex h-5 max-w-[7rem] shrink-0 items-center rounded-full border bg-background px-1.5 text-[11px] font-medium leading-none text-muted-foreground tabular-nums"
                      title={`${count} item`}
                    >
                      <span className="min-w-0 truncate whitespace-nowrap">{count}</span>
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums">{rupiah(value)}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
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
      <div className="mt-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Tidak ada barang cocok dengan pencarian.
      </div>
    )}

    {/* Daftar dikelompokkan per kategori */}
    <div className="mt-3 space-y-3">
      {groupKeys.map((cat) => {
        const list = groups.get(cat)!;
        const catValue = list.reduce((s, i) => s + i.stock_base * i.avg_cost_per_base, 0);
        const isCollapsed = !!collapsed[cat];
        return (
          <section key={cat} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <header
              className="flex cursor-pointer items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2"
              onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  aria-hidden
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${cat === "Tanpa Kategori" ? "bg-muted-foreground/50" : "bg-primary"}`}
                />
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug" title={cat}>{cat}</h3>
                <span
                  className="inline-flex h-5 max-w-[7rem] shrink-0 items-center rounded-full border bg-background px-1.5 text-[11px] font-medium leading-none text-muted-foreground tabular-nums"
                  title={`${list.length} item`}
                >
                  <span className="min-w-0 truncate whitespace-nowrap">{list.length} item</span>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-[11px] leading-snug">
                <span className="hidden text-muted-foreground sm:inline">Nilai</span>
                <span className="whitespace-nowrap font-semibold tabular-nums">{rupiah(catValue)}</span>
                <span className="text-muted-foreground">{isCollapsed ? "▸" : "▾"}</span>
              </div>
            </header>
            {!isCollapsed && (
              <ul className="divide-y">
                {list.map((i) => (
                  <li key={i.id} className="p-3 transition-colors hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 gap-2">
                        {i.image_path ? (
                          <SignedImg path={i.image_path} className="h-12 w-12 shrink-0 rounded-md border object-cover bg-muted" />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-dashed text-[11px] text-muted-foreground">📷</div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 break-words text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{i.name}</div>
                          <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                            per {i.package_type}
                            {i.package_type !== "pcs" && ` (${i.package_size} ${i.base_unit}/kemasan)`}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => setEditing(i)}
                          className="rounded border px-2 py-1 text-[11px] hover:bg-accent"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => remove(i.id, i.name)}
                          className="rounded border px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] leading-snug">
                      <div className="min-w-0 rounded bg-muted/50 p-2">
                        <div className="truncate text-muted-foreground">Stok</div>
                        <div className="font-semibold tabular-nums [overflow-wrap:anywhere]">{fmtItemQty(i.stock_base, i)}</div>
                      </div>
                      <div className="min-w-0 rounded bg-muted/50 p-2">
                        <div className="truncate text-muted-foreground">HPP / {i.base_unit}</div>
                        <div className="font-semibold tabular-nums [overflow-wrap:anywhere]">{rupiah(i.avg_cost_per_base)}</div>
                      </div>
                      <div className="min-w-0 rounded bg-muted/50 p-2">
                        <div className="truncate text-muted-foreground">Nilai</div>
                        <div className="font-semibold tabular-nums [overflow-wrap:anywhere]">{rupiah(i.stock_base * i.avg_cost_per_base)}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col justify-center px-3 py-2 sm:px-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function EditItemDialog({ item, uid, onClose, onSaved, onSilentRefresh }: { item: WItem; uid: string | null; onClose: () => void; onSaved: () => void; onSilentRefresh?: () => void }) {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category ?? "");
  const [packageType, setPackageType] = useState<PackageType>(item.package_type as PackageType);
  const [packageSize, setPackageSize] = useState(String(item.package_size));
  const [stockBase, setStockBase] = useState(String(item.stock_base));
  const [avgCost, setAvgCost] = useState(String(item.avg_cost_per_base));
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
      image_path: imagePath,
    }).eq("id", item.id);
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Barang diperbarui");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border bg-card p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold">Edit Barang</div>
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Nama</span>
          <input className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <PhotoPicker value={imagePath} onChange={setImagePath} uid={uid} />
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Kategori</span>
          <input className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>
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
              <input type="number" step="0.01" min="0.01" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={packageSize} onChange={(e) => setPackageSize(e.target.value)} />
            </label>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Stok ({baseUnit})</span>
            <input type="number" step="0.01" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={stockBase} onChange={(e) => setStockBase(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">HPP / {baseUnit} (Rp)</span>
            <input type="number" step="0.01" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} />
          </label>
        </div>
        <div className="text-[11px] text-amber-500">
          ⚠️ Mengubah stok / HPP manual akan menimpa nilai dari riwayat pembelian.
        </div>
        {baseUnitChanged && (
          <div className="rounded-md border border-destructive bg-destructive/10 p-2 text-[11px] text-destructive">
            🚨 Anda mengubah satuan dasar <b>{originalBaseUnit}</b> → <b>{baseUnit}</b>. Stok & HPP
            TIDAK dikonversi otomatis, dan histori pembelian/penjualan akan terbaca dalam satuan baru.
            Untuk barang yang sudah punya transaksi, sebaiknya buat <b>barang baru</b> daripada mengganti
            jenis kemasan antara <i>gram</i> dan <i>botol/sachet/pcs</i>.
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button disabled={saving} onClick={save} className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {saving ? "Menyimpan..." : "Simpan"}
          </button>
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm hover:bg-accent">Batal</button>
        </div>
        <button
          type="button"
          onClick={() => setShowPackages(true)}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-xs font-semibold hover:bg-accent"
        >
          📦 Paket Siap Kirim
        </button>
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
  const normalizedMyPhone = normalizeWaNumber(myProfile?.phone, myProfile?.country_code);
  const canUseMyContact = !!(myProfile?.display_name || normalizedMyPhone);
  function useMyContact() {
    if (!myProfile) return;
    const filled: string[] = [];
    if (myProfile.display_name) { setName(myProfile.display_name); filled.push("nama"); }
    if (normalizedMyPhone) { setContact(normalizedMyPhone); filled.push("no. MCM"); }
    else if (myProfile.phone) {
      toast.warning("Nomor MCM di profil tidak valid — perbarui di halaman Profil Akun");
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
  async function submit(e: React.FormEvent) {
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
    if (editingId) {
      const { error } = await supabase.from("suppliers").update(payload).eq("id", editingId);
      if (error) { toast.error(friendlyError(error)); return; }
      toast.success("Supplier diperbarui");
    } else {
      const { error } = await supabase.from("suppliers").insert({ user_id: uid, ...payload });
      if (error) { toast.error(friendlyError(error)); return; }
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
    if (error) toast.error(friendlyError(error));
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
        <input type="email" className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Email (opsional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="CC (pisahkan dengan koma, opsional)" value={emailCc} onChange={(e) => setEmailCc(e.target.value)} />
        <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="BCC (pisahkan dengan koma, opsional)" value={emailBcc} onChange={(e) => setEmailBcc(e.target.value)} />
        <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Catatan (opsional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button
          type="button"
          onClick={useMyContact}
          disabled={!canUseMyContact}
          className="w-full rounded-md border border-dashed px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
          title={canUseMyContact ? "Isi nama & no. MCM dari profil akun Anda" : "Lengkapi profil akun terlebih dahulu"}
        >
          👤 Pakai kontak akun saya
        </button>
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
                <div className="truncate text-sm font-semibold" title={s.name}>{s.name}</div>
                {s.contact && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground">📞 {s.contact}</span>
                    {(() => {
                      const digits = s.contact.replace(/\D/g, "");
                      const wa = digits.startsWith("0") ? "62" + digits.slice(1) : digits;
                      return (
                        <>
                          <a
                            href={`tel:${s.contact}`}
                            className="rounded border border-sky-500 px-1.5 py-0.5 text-[11px] font-semibold text-sky-600 hover:bg-sky-500/10 dark:text-sky-400"
                            aria-label={`Panggil ${s.name}`}
                          >
                            📞 Panggil
                          </a>
                          {wa && (
                            <a
                              href={`https://wa.me/${wa}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded border border-emerald-500 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                              aria-label={`Kirim via MCM ke ${s.name}`}
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
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[11px] text-muted-foreground" title={s.email}>📧 {s.email}</span>
                    <a
                      href={buildMailto({ to: s.email, cc: s.email_cc, bcc: s.email_bcc }).href}
                      className="rounded border border-indigo-500 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-500/10 dark:text-indigo-400"
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
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {ccAll.length > 0 && <span>CC: {ccAll.join(", ")}</span>}
                        {ccAll.length > 0 && bccAll.length > 0 && <span> · </span>}
                        {bccAll.length > 0 && <span>BCC: {bccAll.join(", ")}</span>}
                      </div>
                      {(ccInvalid.length > 0 || bccInvalid.length > 0) && (
                        <div className="mt-0.5 text-[11px] text-amber-500">
                          ⚠️ Alamat tidak valid diabaikan: {[...ccInvalid, ...bccInvalid].join(", ")}
                        </div>
                      )}
                    </>
                  );
                })()}
                {s.notes && <div className="mt-1 text-[11px] text-muted-foreground">{s.notes}</div>}
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

  useEffect(() => {
    if (mode === "existing" && !itemId && items[0]) setItemId(items[0].id);
  }, [mode, items, itemId]);

  // Untuk mode "existing", SEMUA turunan (jenis kemasan, ukuran, base unit)
  // WAJIB diambil dari item terpilih — bukan state form "barang baru".
  const selectedItem = mode === "existing" ? items.find((i) => i.id === itemId) ?? null : null;
  const derived = computeBeliDerived({
    mode,
    selectedItem,
    newPackageType: packageType,
    newPackageSize: packageSize,
    packageQty,
    pricePerPackage,
    priceMode,
    pricePerBase,
    inputKarton,
  });
  const { effPackageType, effBaseUnit, effectivePkgSize, kartonActive, pkgQ, price, baseAdded, totalCost } = derived;
  const baseUnit = effBaseUnit;
  const warnings = computeBeliWarnings({
    mode,
    selectedItem,
    derived,
    priceMode,
    inputKarton,
  }).filter((w) => w.level !== "error"); // error-level sudah ditangani di submit()

  // Bila item terpilih bukan botol, mode karton wajib mati agar tidak
  // ×100 dari qty. Bila pindah ke item pcs, harga per-kemasan tidak
  // punya arti — paksa priceMode ke "base".
  useEffect(() => {
    if (!selectedItem) return;
    if (selectedItem.package_type !== "botol" && inputKarton) setInputKarton(false);
    if (selectedItem.package_type === "pcs" && priceMode !== "base") setPriceMode("base");
  }, [selectedItem, inputKarton, priceMode]);

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
        image_path: newImagePath,
      }).select().single();
      if (error || !data) { toast.error(friendlyError(error) || "Gagal buat barang"); return; }
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
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`Pembelian dicatat (${paymentMethod === "hutang" ? "hutang" : "kas"}), stok bertambah`);
    setName(""); setCategory(""); setPackageQty("1"); setPricePerPackage(""); setPricePerBase(""); setNewImagePath(null);
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
          <PhotoPicker value={newImagePath} onChange={setNewImagePath} uid={uid} />
        </div>
      ) : (
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Pilih barang</span>
          <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={itemId} onChange={(e) => setItemId(e.target.value)} required>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.package_type}{i.package_type !== "pcs" ? ` ${i.package_size} ${i.base_unit}` : ""}) · stok {fmtItemQty(i.stock_base, i)}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] text-muted-foreground">
            Jumlah {kartonActive ? "karton" : "kemasan"}
          </span>
          <input type="number" step="0.01" min="0.01" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={packageQty} onChange={(e) => setPackageQty(e.target.value)} required />
        </label>
        {priceMode === "package" ? (
          <label className="block">
            <span className="text-[11px] text-muted-foreground">
              Harga beli / {kartonActive ? "karton" : effPackageType} (Rp)
            </span>
            <input type="number" step="1" min="0" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={pricePerPackage} onChange={(e) => setPricePerPackage(e.target.value)} required />
          </label>
        ) : (
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Harga beli / {baseUnit} (Rp)</span>
            <input type="number" step="0.01" min="0" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={pricePerBase} onChange={(e) => setPricePerBase(e.target.value)} required />
          </label>
        )}
      </div>

      {effPackageType === "botol" && (
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
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

      {effPackageType !== "pcs" && (
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => setPriceMode("package")} className={`flex-1 rounded border px-2 py-1 ${priceMode === "package" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
            Harga per {effPackageType}
          </button>
          <button type="button" onClick={() => setPriceMode("base")} className={`flex-1 rounded border px-2 py-1 ${priceMode === "base" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
            Harga per {baseUnit}
          </button>
        </div>
      )}

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
        <div>Total tambahan stok: <b>{selectedItem ? fmtItemQty(baseAdded, selectedItem) : fmtBase(baseAdded, baseUnit)}</b></div>
        <div>Total biaya: <b>{rupiah(totalCost)}</b> ({paymentMethod === "hutang" ? "hutang ke supplier" : "lunas tunai"})</div>
        {baseAdded > 0 && <div>Modal per {baseUnit}: <b>{rupiah(totalCost / baseAdded)}</b></div>}
      </div>

      <button className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Simpan pembelian</button>
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

  useEffect(() => {
    if (!itemId && items[0]) setItemId(items[0].id);
  }, [items, itemId]);

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
      toast.error(
        `Jumlah minimal ${minBase} ${item.base_unit}. Tidak bisa menjual di bawah itu.`
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
      if (ncErr || !nc) { toast.error(friendlyError(ncErr ?? new Error("Gagal simpan pelanggan"))); return; }
      useCustomerId = nc.id;
    }
    if (paymentMethod === "hutang" && !useCustomerId) {
      toast.error("Penjualan hutang wajib pilih pelanggan");
      return;
    }
    const { error } = await supabase.from("sales").insert({
      user_id: uid,
      item_id: item.id,
      qty_base: qtyBase,
      price_per_base: pricePerBaseEff,
      total_revenue: total,
      cost_at_sale: 0, // recomputed in trigger
      note: note.trim() || null,
      customer_id: useCustomerId,
      payment_method: paymentMethod,
    });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`Penjualan dicatat (${paymentMethod === "hutang" ? "hutang" : "kas"}), stok berkurang`);
    setQty(""); setPricePerBase(""); setPricePerPackage(""); setNote("");
    setNewCustName(""); setNewCustWa("");
    if (customerId === "__new__") setCustomerId("");
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
              {i.name} · stok {fmtQtyDual(i.stock_base, i.base_unit, i.package_type, i.package_size, i.package_type !== "pcs" ? "package" : "base", i.name)} · HPP {rupiah(i.avg_cost_per_base)}/{i.base_unit}
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
            {item.package_type === "botol" && (
              <button type="button" onClick={() => setSellMode("karton")} className={`flex-1 rounded border px-2 py-1 ${sellMode === "karton" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                Jual per karton
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">
                Jumlah ({sellMode === "base" ? item.base_unit : sellMode === "karton" ? "karton" : item.package_type})
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
                <span className="text-[11px] text-muted-foreground">
                  Harga / {sellMode === "karton" ? "karton" : item.package_type} (Rp)
                </span>
                <input type="number" step="1" min="0" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={pricePerPackage} onChange={(e) => setPricePerPackage(e.target.value)} required />
              </label>
            )}
          </div>

          <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />

          <label className="block">
            <span className="text-[11px] text-muted-foreground">Pelanggan {paymentMethod === "hutang" && <span className="text-destructive">*</span>}</span>
            <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Tanpa pelanggan —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__new__">+ Pelanggan baru…</option>
            </select>
          </label>

          {customerId === "__new__" && (
            <div className="grid grid-cols-1 gap-2 rounded-md border border-dashed bg-muted/30 p-2">
              <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Nama pelanggan baru *" value={newCustName} onChange={(e) => setNewCustName(e.target.value)} maxLength={100} required />
              <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="No. MCM / HP (cth: 0812xxxxx)" inputMode="tel" value={newCustWa} onChange={(e) => setNewCustWa(e.target.value)} maxLength={50} />
              <div className="text-[11px] text-muted-foreground">Pelanggan & nomor MCM akan otomatis tersimpan ke daftar pelanggan.</div>
            </div>
          )}

          {customerId && customerId !== "__new__" && (() => {
            const c = customers.find((x) => x.id === customerId);
            if (!c) return null;
            return (
              <div className="rounded-md border border-dashed bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
                No. MCM pelanggan: {c.contact ? <span className="font-medium text-foreground">📞 {c.contact}</span> : <span className="italic">belum ada — tambahkan di menu Pelanggan</span>}
              </div>
            );
          })()}

          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Cara bayar</div>
            <div className="flex gap-1 text-xs">
              <button type="button" onClick={() => setPaymentMethod("kas")} className={`flex-1 rounded border px-2 py-1.5 ${paymentMethod === "kas" ? "bg-primary text-primary-foreground border-primary" : ""}`}>💵 Kas (lunas)</button>
              <button type="button" onClick={() => setPaymentMethod("hutang")} className={`flex-1 rounded border px-2 py-1.5 ${paymentMethod === "hutang" ? "bg-amber-500 text-white border-amber-500" : ""}`}>📝 Hutang pelanggan</button>
            </div>
          </div>

          {(() => {
            const kurang = qtyBase > item.stock_base;
            const sisa = item.stock_base - qtyBase;
            const dispMode: "base" | "package" = sellMode === "base" ? "base" : "package";
            return (
              <div className="rounded-md bg-muted/50 p-2 text-[11px] space-y-0.5">
                <div>
                  Akan kurangi stok: <b>{fmtQtyDual(qtyBase, item.base_unit, item.package_type, item.package_size, dispMode, item.name)}</b>
                </div>
                <div>
                  Stok tersedia: <b>{fmtQtyDual(item.stock_base, item.base_unit, item.package_type, item.package_size, dispMode, item.name)}</b>
                </div>
                <div className={kurang ? "text-destructive font-semibold" : ""}>
                  {kurang
                    ? <>Stok kurang {fmtBase(qtyBase - item.stock_base, item.base_unit)} — tidak bisa disimpan</>
                    : <>Sisa setelah jual: <b>{fmtQtyDual(sisa, item.base_unit, item.package_type, item.package_size, dispMode, item.name)}</b></>}
                </div>
                <div>Total pendapatan: <b>{rupiah(total)}</b> ({paymentMethod === "hutang" ? "piutang ke pelanggan" : "lunas tunai"})</div>
                <div className={profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                  Estimasi laba: <b>{rupiah(profit)}</b>
                </div>
              </div>
            );
          })()}

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
    if (!(await confirm({
      title: "Hapus pembelian?",
      description: "Stok akan dikurangi sesuai isi pembelian ini.",
      confirmText: "Hapus",
    }))) return;
    const { error } = await supabase.from("purchases").delete().eq("id", id);
    if (error) toast.error(friendlyError(error)); else { toast.success("Pembelian dihapus"); onChanged(); }
  }
  async function delSale(id: string) {
    if (!(await confirm({
      title: "Hapus penjualan?",
      description: "Stok akan dikembalikan ke gudang.",
      confirmText: "Hapus",
    }))) return;
    const { error } = await supabase.from("sales").delete().eq("id", id);
    if (error) toast.error(friendlyError(error)); else { toast.success("Penjualan dihapus"); onChanged(); }
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
                      <div className="truncate font-semibold" title={it?.name || "(barang dihapus)"}>{it?.name || "(barang dihapus)"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(s.created_at).toLocaleString("id-ID")} {s.note && `· ${s.note}`}
                      </div>
                    </div>
                    <button onClick={() => delSale(s.id)} className="shrink-0 rounded border px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10">Hapus</button>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2">
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
                      <div className="truncate font-semibold" title={it?.name || "(barang dihapus)"}>{it?.name || "(barang dihapus)"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(p.created_at).toLocaleString("id-ID")} · dari {sup?.name || "—"}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge size="xs" variant={p.payment_method === "hutang" ? "hutang" : "lunas"}>
                        {p.payment_method === "hutang" ? "📝 Hutang" : "💵 Kas"}
                      </StatusBadge>
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

  if (debts.length === 0) {
    return (
      <div className="space-y-3">
        <button
          onClick={onAddDebt}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          ➕ Tambah hutang (catat pembelian)
        </button>
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Tidak ada hutang ke supplier. Pembelian dengan cara bayar <b>Hutang</b> akan muncul di sini.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        onClick={onAddDebt}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        ➕ Tambah hutang (catat pembelian)
      </button>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-md border bg-card p-2">
          <div className="text-muted-foreground">Total hutang</div>
          <div className="text-sm font-semibold">{rupiah(totals.total)}</div>
        </div>
        <div className="rounded-md border bg-card p-2">
          <div className="text-muted-foreground">Sudah dibayar</div>
          <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{rupiah(totals.paid)}</div>
        </div>
        <div className="rounded-md border bg-card p-2">
          <div className="text-muted-foreground">Sisa</div>
          <div className="text-sm font-semibold text-amber-600 dark:text-amber-400">{rupiah(totals.remaining)}</div>
        </div>
      </div>

      {groups.map((g, idx) => (
        <div key={g.supplier?.id || `_none-${idx}`} className="space-y-2 rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">{g.supplier?.name || "(tanpa supplier)"}</div>
            <div className="text-[11px]">
              Sisa: <span className="font-semibold text-amber-600 dark:text-amber-400">{rupiah(g.remaining)}</span>
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
          <ul className="space-y-2">
            {g.debts.map((d) => {
              const it = itemMap[d.item_id];
              const paid = paidByPurchase[d.id] || 0;
              const remaining = Math.max(0, Number(d.total_cost) - paid);
              const isPaid = remaining <= 0;
              return (
                <li key={d.id} className="rounded-md border bg-background p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold" title={it?.name || "(barang dihapus)"}>{it?.name || "(barang dihapus)"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(d.created_at).toLocaleDateString("id-ID")} · {Number(d.package_qty)} × {rupiah(Number(d.price_per_package))}
                      </div>
                    </div>
                    <StatusBadge size="xs" variant={isPaid ? "lunas" : "hutang"}>
                      {isPaid ? "✓ Lunas" : "Hutang"}
                    </StatusBadge>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
                    <div><span className="text-muted-foreground">Total </span><b>{rupiah(Number(d.total_cost))}</b></div>
                    <div><span className="text-muted-foreground">Bayar </span><b className="text-emerald-600 dark:text-emerald-400">{rupiah(paid)}</b></div>
                    <div><span className="text-muted-foreground">Sisa </span><b className="text-amber-600 dark:text-amber-400">{rupiah(remaining)}</b></div>
                  </div>
                  {!isPaid && g.supplier && (
                    <PayForm purchase={d} supplierId={g.supplier.id} remaining={remaining} uid={uid} onChanged={onChanged} onLocalPayment={onLocalPayment} />
                  )}
                  {(paymentsByPurchase[d.id]?.length ?? 0) > 0 && (
                    <ul className="mt-2 space-y-1 border-t pt-1.5">
                      {paymentsByPurchase[d.id]!.map((pay) => (
                        <li key={pay.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="truncate">
                            {new Date(pay.created_at).toLocaleDateString("id-ID")} ·{" "}
                            <b className="text-emerald-600 dark:text-emerald-400">{rupiah(Number(pay.amount))}</b>
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
                              if (error) { toast.error(friendlyError(error)); onChanged(); }
                              else { toast.success("Pembayaran dihapus"); onChanged(); }
                            }}
                            className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10"
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
    if (error) { toast.error(friendlyError(error)); return; }
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
    <div className="mt-2 space-y-1.5 rounded border border-dashed p-2">
      <div className="flex gap-1.5">
        <input
          type="number"
          step="1"
          min="0"
          max={remaining}
          placeholder="Nominal bayar (Rp)"
          className={`flex-1 rounded border bg-background px-2 py-1 text-xs ${errorMsg ? "border-destructive" : ""}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button
          type="button"
          disabled={payDisabled}
          onClick={() => pay(parsed)}
          className="rounded bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          Bayar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => pay(remaining)}
          className="rounded border border-emerald-500 px-2 py-1 text-xs font-semibold text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
        >
          Lunas
        </button>
      </div>
      {errorMsg && <div className="text-[11px] text-destructive">{errorMsg}</div>}
      <input
        type="text"
        placeholder="Catatan (opsional)"
        className="w-full rounded border bg-background px-2 py-1 text-xs"
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
      if (ncErr || !nc) { toast.error(friendlyError(ncErr ?? new Error("Gagal simpan pelanggan"))); return; }
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
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Pesanan ditambahkan");
    setQty(""); setPrice(""); setNote("");
    setNewCustName(""); setNewCustWa("");
    if (customerId === "__new__") setCustomerId("");
    onChanged();
  }

  async function setStatus(id: string, status: OrderRequest["status"], opts: { silent?: boolean } = {}) {
    const { error } = await supabase.from("order_requests").update({ status }).eq("id", id);
    if (error) { toast.error(friendlyError(error)); return false; }
    if (!opts.silent) toast.success(`Status: ${status}`);
    onChanged();
    return true;
  }

  async function konversiKePenjualan(o: OrderRequest, skipConfirm = false): Promise<boolean> {
    if (!uid) return false;
    const it = itemMap[o.item_id]; if (!it) return false;
    const qBase = o.qty_mode === "base" ? Number(o.qty) : Number(o.qty) * it.package_size;
    if (qBase > it.stock_base) { toast.error("Stok kurang untuk konversi"); return false; }
    const perBase = o.price_per_unit
      ? (o.qty_mode === "base" ? Number(o.price_per_unit) : Number(o.price_per_unit) / it.package_size)
      : 0;
    if (
      !skipConfirm &&
      !(await confirm({
        title: "Catat penjualan?",
        description: `${fmtItemQty(qBase, it)} × ${fmtItemPrice(perBase, it)}`,
        confirmText: "Catat",
      }))
    )
      return false;
    const { error } = await supabase.from("sales").insert({
      user_id: uid, item_id: it.id, qty_base: qBase,
      price_per_base: perBase, total_revenue: qBase * perBase, cost_at_sale: 0,
      note: `Pesanan: ${o.note ?? "-"}`, customer_id: o.customer_id, payment_method: "kas",
    });
    if (error) { toast.error(friendlyError(error)); return false; }
    await supabase.from("order_requests").update({ status: "selesai" }).eq("id", o.id);
    if (!skipConfirm) toast.success("Pesanan dijadikan penjualan");
    onChanged();
    return true;
  }

  async function tandaiSiap(o: OrderRequest) {
    const it = itemMap[o.item_id];
    const qBase = it ? (o.qty_mode === "base" ? Number(o.qty) : Number(o.qty) * it.package_size) : 0;
    const ringkasan = it
      ? `${it.name} — ${fmtItemQty(qBase, it)}${o.price_per_unit != null ? ` × ${rupiah(Number(o.price_per_unit))}/${o.qty_mode === "base" ? it.base_unit : it.package_type}` : ""}`
      : "pesanan ini";
    const labelPelanggan = o.customer_id ? (custMap[o.customer_id]?.name ?? "pelanggan") : "tanpa pelanggan";
    const pilihan = await confirm({
      title: "Proses jadi penjualan sekarang?",
      description: `${ringkasan}\n\nLanjut → proses jadi PENJUALAN (stok berkurang, status: selesai)\nBatal → hanya tandai siap, jangan proses dulu`,
      confirmText: "Lanjut",
    });
    if (pilihan) {
      const ok = await konversiKePenjualan(o, true);
      if (ok && it) {
        toast.success("✅ Pesanan diproses jadi penjualan", {
          description: `${ringkasan}\nPelanggan: ${labelPelanggan}\nStatus: menunggu → selesai · Stok dikurangi ${fmtItemQty(qBase, it)}`,
        });
      }
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
    if (error) toast.error(friendlyError(error)); else { toast.success("Dihapus"); onChanged(); }
  }

  function fmtQty(o: OrderRequest) {
    const it = itemMap[o.item_id];
    if (!it) return `${o.qty}`;
    if (o.qty_mode === "base") return `${o.qty} ${it.base_unit}`;
    return `${o.qty} ${it.package_type}${it.package_type !== "pcs" ? ` (≈${Number(o.qty) * it.package_size} ${it.base_unit})` : ""}`;
  }

  if (items.length === 0) {
    return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada barang. Tambah di tab <b>Beli</b> dulu.</div>;
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-3 rounded-lg border bg-card p-3">
        <div className="text-xs font-semibold">📝 Tambah Pesanan</div>

        <label className="block">
          <span className="text-[11px] text-muted-foreground">Pelanggan (opsional)</span>
          <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— Tanpa pelanggan —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__new__">+ Pelanggan baru…</option>
          </select>
        </label>

        {customerId === "__new__" && (
          <div className="grid grid-cols-1 gap-2 rounded-md border border-dashed bg-muted/30 p-2">
            <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Nama pelanggan baru *" value={newCustName} onChange={(e) => setNewCustName(e.target.value)} maxLength={100} required />
            <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="No. MCM / HP (cth: 0812xxxxx)" inputMode="tel" value={newCustWa} onChange={(e) => setNewCustWa(e.target.value)} maxLength={50} />
            <div className="text-[11px] text-muted-foreground">Pelanggan & nomor MCM akan otomatis tersimpan ke daftar pelanggan.</div>
          </div>
        )}

        {customerId && customerId !== "__new__" && (() => {
          const c = customers.find((x) => x.id === customerId);
          if (!c) return null;
          return (
            <div className="rounded-md border border-dashed bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
              No. MCM pelanggan: {c.contact ? <span className="font-medium text-foreground">📞 {c.contact}</span> : <span className="italic">belum ada — tambahkan di menu Pelanggan</span>}
            </div>
          );
        })()}

        <label className="block">
          <span className="text-[11px] text-muted-foreground">Barang</span>
          <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} · stok {fmtQtyDual(i.stock_base, i.base_unit, i.package_type, i.package_size, i.package_type !== "pcs" ? "package" : "base", i.name)}
              </option>
            ))}
          </select>
        </label>

        {item && (
          <>
            <div className="flex gap-1 text-xs">
              <button type="button" onClick={() => setQtyMode("base")} className={`flex-1 rounded border px-2 py-1 ${qtyMode === "base" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                Per {item.base_unit}
              </button>
              {item.package_type !== "pcs" && (
                <button type="button" onClick={() => setQtyMode("package")} className={`flex-1 rounded border px-2 py-1 ${qtyMode === "package" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                  Per {item.package_type}
                </button>
              )}
              {item.package_type === "botol" && (
                <button type="button" onClick={() => setQtyMode("karton")} className={`flex-1 rounded border px-2 py-1 ${qtyMode === "karton" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                  Per karton
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">
                  Jumlah ({qtyMode === "base" ? item.base_unit : qtyMode === "karton" ? "karton" : item.package_type})
                </span>
                <input type="number" step="0.01" min="0.01" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={qty} onChange={(e) => setQty(e.target.value)} required />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">
                  Harga / {qtyMode === "base" ? item.base_unit : qtyMode === "karton" ? "karton" : item.package_type} (opsional)
                </span>
                <input type="number" step="1" min="0" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={price} onChange={(e) => setPrice(e.target.value)} />
              </label>
            </div>

            <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Catatan (mis. dijemput sore)" value={note} onChange={(e) => setNote(e.target.value)} />

            <div className={`rounded-md p-2 text-[11px] space-y-0.5 ${enough ? "bg-muted/50" : "bg-destructive/10 text-destructive"}`}>
              <div>Butuh siapkan: <b>{fmtQtyDual(qtyBase, item.base_unit, item.package_type, item.package_size, qtyMode === "base" ? "base" : "package", item.name)}</b></div>
              <div>Stok tersedia: <b>{fmtQtyDual(item.stock_base, item.base_unit, item.package_type, item.package_size, qtyMode === "base" ? "base" : "package", item.name)}</b></div>
              {!enough && <div className="font-semibold">Kurang {fmtBase(qtyBase - item.stock_base, item.base_unit)}</div>}
            </div>
          </>
        )}

        <button className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Simpan pesanan</button>
      </form>

      <div className="flex gap-1 text-xs">
        <button onClick={() => setFilter("aktif")} className={`flex-1 rounded border px-2 py-1 ${filter === "aktif" ? "bg-primary text-primary-foreground border-primary" : ""}`}>Aktif</button>
        <button onClick={() => setFilter("semua")} className={`flex-1 rounded border px-2 py-1 ${filter === "semua" ? "bg-primary text-primary-foreground border-primary" : ""}`}>Semua</button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Tidak ada pesanan.</div>
      ) : (
        <ul className="space-y-2">
          {visible.map((o) => {
            const it = itemMap[o.item_id];
            const cust = o.customer_id ? custMap[o.customer_id] : null;
            return (
              <li key={o.id} className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold" title={it?.name ?? "?"}>{it?.name ?? "?"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {cust?.name ?? "Tanpa pelanggan"} · {new Date(o.created_at).toLocaleString("id-ID")}
                    </div>
                    <div className="mt-1 text-[11px]">
                      Jumlah: <b>{fmtQty(o)}</b>
                      {o.price_per_unit != null && <> · {rupiah(Number(o.price_per_unit))}/{o.qty_mode === "base" ? it?.base_unit : it?.package_type}</>}
                    </div>
                    {o.note && <div className="text-[11px] text-muted-foreground">📌 {o.note}</div>}
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="flex flex-wrap gap-1">
                  {o.status === "menunggu" && (
                    <button onClick={() => tandaiSiap(o)} className="rounded border px-2 py-1 text-[11px] hover:bg-accent">✅ Tandai Siap</button>
                  )}
                  {o.status === "siap" && (
                    <button onClick={() => setStatus(o.id, "menunggu")} className="rounded border px-2 py-1 text-[11px] hover:bg-accent">↩️ Batal Siap</button>
                  )}
                  {o.status !== "selesai" && (
                    <button onClick={() => konversiKePenjualan(o)} className="rounded border px-2 py-1 text-[11px] hover:bg-accent">💰 Jadikan Penjualan</button>
                  )}
                  <Link to="/gudang/pesanan/$id" params={{ id: o.id }} className="ml-auto rounded border px-2 py-1 text-[11px] hover:bg-accent">🔍 Detail</Link>
                  <button onClick={() => hapus(o.id)} className="rounded border px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10">Hapus</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
