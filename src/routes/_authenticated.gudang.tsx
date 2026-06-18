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

/* ----------------- Photo helpers ----------------- */
async function uploadItemPhoto(file: File, uid: string): Promise<string | null> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("item-photos").upload(path, file, {
    cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg",
  });
  if (error) { toast.error("Gagal upload foto: " + error.message); return null; }
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
          <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed text-[10px] text-muted-foreground">Tidak ada</div>
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
    supabase.storage.from("item-photos").createSignedUrl(path, 3600).then(({ data }) => {
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
            ["pesanan", "Pesanan"],
            ["hutang", "Hutang"],
            ["pelanggan", "Pelanggan"],
            ["piutang", "Piutang"],
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
          <StokTab items={items} uid={uid} onChanged={reloadAll} />
        )}
        {tab === "supplier" && (
          <SupplierTab suppliers={suppliers} uid={uid} onChanged={reloadAll} />
        )}
        {tab === "beli" && (
          <BeliTab suppliers={suppliers} items={items} uid={uid} onChanged={reloadAll} />
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
  );
}

/* ----------------- CUSTOMER ----------------- */
function CustomerTab({ customers, uid, onChanged }: { customers: Customer[]; uid: string | null; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

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
      if (error) { toast.error(error.message); return; }
      toast.success("Pelanggan diperbarui");
    } else {
      const { error } = await supabase.from("customers").insert({ user_id: uid, ...payload });
      if (error) { toast.error(error.message); return; }
      toast.success("Pelanggan ditambahkan");
    }
    resetForm(); onChanged();
  }
  async function remove(id: string, n: string) {
    if (!confirm(`Hapus pelanggan "${n}"? Pembayaran terkait juga dihapus.`)) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Pelanggan dihapus"); if (editingId === id) resetForm(); onChanged(); }
  }
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-2 rounded-lg border bg-card p-3">
        <div className="text-xs font-semibold">{editingId ? "Edit Pelanggan" : "Tambah Pelanggan"}</div>
        <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Nama pelanggan *" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="No. WA / kontak (opsional)" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={50} />
        <input className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Catatan (opsional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
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
                <div className="truncate text-sm font-semibold">{c.name}</div>
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
                <div className="truncate text-sm font-semibold">{g.customer.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  Hutang {rupiah(g.totalHutang)} · Bayar {rupiah(g.totalBayar)}
                </div>
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${
                status === "hutang" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : status === "kelebihan" ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
                : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              }`}>
                {status === "hutang" ? `Sisa ${rupiah(g.balance)}`
                  : status === "kelebihan" ? `Kelebihan ${rupiah(-g.balance)}`
                  : "✓ Lunas"}
              </span>
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
                          <div className="truncate font-semibold">{it?.name || "(barang dihapus)"}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {new Date(s.created_at).toLocaleDateString("id-ID")} · {fmtBase(Number(s.qty_base), it?.base_unit || "pcs")}
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
                        if (!confirm("Hapus pembayaran ini?")) return;
                        onLocalRemovePayment(pay.id);
                        const { error } = await supabase.from("customer_payments").delete().eq("id", pay.id);
                        if (error) { toast.error(error.message); onChanged(); }
                        else { toast.success("Pembayaran dihapus"); onChanged(); }
                      }}
                      className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/10"
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
    if (error) { toast.error(error.message); return; }
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

  const links = [
    { label: "WhatsApp", emoji: "💬", href: waPhone ? `https://wa.me/${waPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`, cls: "border-emerald-500 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400" },
    { label: "WA Business", emoji: "🏪", href: waPhone ? `whatsapp://send?phone=${waPhone}&text=${encoded}` : `whatsapp://send?text=${encoded}`, cls: "border-emerald-700 text-emerald-700 hover:bg-emerald-700/10 dark:text-emerald-400" },
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
          </div>
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
      label: "WhatsApp",
      emoji: "💬",
      href: waPhone ? `https://wa.me/${waPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`,
      cls: "border-emerald-500 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400",
    },
    {
      label: "WA Business",
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
    <>
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.id} className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 gap-2">
              {i.image_path ? (
                <SignedImg path={i.image_path} className="h-12 w-12 shrink-0 rounded-md border object-cover bg-muted" />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-dashed text-[10px] text-muted-foreground">📷</div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{i.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {i.category || "—"} · per {i.package_type}
                  {i.package_type !== "pcs" && ` (${i.package_size}${i.base_unit === "g" ? "g" : ""}/kemasan)`}
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
    {editing && (
      <EditItemDialog
        item={editing}
        uid={uid}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); onChanged(); }}
      />
    )}
    </>
  );
}

function EditItemDialog({ item, uid, onClose, onSaved }: { item: WItem; uid: string | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category ?? "");
  const [packageType, setPackageType] = useState<PackageType>(item.package_type as PackageType);
  const [packageSize, setPackageSize] = useState(String(item.package_size));
  const [stockBase, setStockBase] = useState(String(item.stock_base));
  const [avgCost, setAvgCost] = useState(String(item.avg_cost_per_base));
  const [imagePath, setImagePath] = useState<string | null>(item.image_path);
  const [saving, setSaving] = useState(false);
  const baseUnit = defaultBase(packageType);
  const effectiveSize = packageType === "pcs" ? 1 : Number(packageSize) || 0;

  async function save() {
    if (!name.trim()) { toast.error("Nama wajib"); return; }
    if (packageType !== "pcs" && effectiveSize <= 0) { toast.error("Ukuran kemasan > 0"); return; }
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
    if (error) { toast.error(error.message); return; }
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
        <div className="flex gap-2 pt-1">
          <button disabled={saving} onClick={save} className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {saving ? "Menyimpan..." : "Simpan"}
          </button>
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm hover:bg-accent">Batal</button>
        </div>
      </div>
    </div>
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
  const [newImagePath, setNewImagePath] = useState<string | null>(null);
  // purchase
  const [packageQty, setPackageQty] = useState("1");
  const [pricePerPackage, setPricePerPackage] = useState("");
  const [priceMode, setPriceMode] = useState<"package" | "base">("package");
  const [pricePerBase, setPricePerBase] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"kas" | "hutang">("kas");

  useEffect(() => {
    if (mode === "existing" && !itemId && items[0]) setItemId(items[0].id);
  }, [mode, items, itemId]);

  const baseUnit = defaultBase(packageType);
  const effectivePkgSize = packageType === "pcs" ? 1 : Number(packageSize) || 0;
  const pkgQ = Number(packageQty) || 0;
  const price = priceMode === "package"
    ? Number(pricePerPackage) || 0
    : (Number(pricePerBase) || 0) * effectivePkgSize;
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
        image_path: newImagePath,
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
        {priceMode === "package" ? (
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Harga beli / {packageType} (Rp)</span>
            <input type="number" step="1" min="0" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={pricePerPackage} onChange={(e) => setPricePerPackage(e.target.value)} required />
          </label>
        ) : (
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Harga beli / {baseUnit} (Rp)</span>
            <input type="number" step="0.01" min="0" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={pricePerBase} onChange={(e) => setPricePerBase(e.target.value)} required />
          </label>
        )}
      </div>

      {packageType !== "pcs" && (
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => setPriceMode("package")} className={`flex-1 rounded border px-2 py-1 ${priceMode === "package" ? "bg-primary text-primary-foreground border-primary" : ""}`}>
            Harga per {packageType}
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
        <div>Total tambahan stok: <b>{fmtBase(baseAdded, baseUnit)}</b></div>
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
  const [sellMode, setSellMode] = useState<"base" | "package">("base");
  const [qty, setQty] = useState("");
  const [pricePerBase, setPricePerBase] = useState("");
  const [pricePerPackage, setPricePerPackage] = useState("");
  const [note, setNote] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"kas" | "hutang">("kas");

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
    if (paymentMethod === "hutang" && !customerId) {
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
      customer_id: customerId || null,
      payment_method: paymentMethod,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Penjualan dicatat (${paymentMethod === "hutang" ? "hutang" : "kas"}), stok berkurang`);
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

          <label className="block">
            <span className="text-[11px] text-muted-foreground">Pelanggan {paymentMethod === "hutang" && <span className="text-destructive">*</span>}</span>
            <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Tanpa pelanggan —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>

          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Cara bayar</div>
            <div className="flex gap-1 text-xs">
              <button type="button" onClick={() => setPaymentMethod("kas")} className={`flex-1 rounded border px-2 py-1.5 ${paymentMethod === "kas" ? "bg-primary text-primary-foreground border-primary" : ""}`}>💵 Kas (lunas)</button>
              <button type="button" onClick={() => setPaymentMethod("hutang")} className={`flex-1 rounded border px-2 py-1.5 ${paymentMethod === "hutang" ? "bg-amber-500 text-white border-amber-500" : ""}`}>📝 Hutang pelanggan</button>
            </div>
          </div>

          <div className="rounded-md bg-muted/50 p-2 text-[11px] space-y-0.5">
            <div>Akan kurangi stok: <b>{fmtBase(qtyBase, item.base_unit)}</b> (sisa {fmtBase(Math.max(0, item.stock_base - qtyBase), item.base_unit)})</div>
            <div>Total pendapatan: <b>{rupiah(total)}</b> ({paymentMethod === "hutang" ? "piutang ke pelanggan" : "lunas tunai"})</div>
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

/* ----------------- HUTANG ----------------- */
function HutangTab({
  purchases, payments, suppliers, itemMap, uid, onChanged, onLocalPayment, onLocalRemovePayment,
}: {
  purchases: Purchase[];
  payments: Payment[];
  suppliers: Supplier[];
  itemMap: Record<string, WItem>;
  uid: string | null;
  onChanged: () => void;
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
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Tidak ada hutang ke supplier. Pembelian dengan cara bayar <b>Hutang</b> akan muncul di sini.
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
                      <div className="truncate font-semibold">{it?.name || "(barang dihapus)"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(d.created_at).toLocaleDateString("id-ID")} · {Number(d.package_qty)} × {rupiah(Number(d.price_per_package))}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${isPaid ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
                      {isPaid ? "✓ Lunas" : "Hutang"}
                    </span>
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
                              if (!confirm("Hapus pembayaran ini?")) return;
                              onLocalRemovePayment(pay.id);
                              const { error } = await supabase.from("supplier_payments").delete().eq("id", pay.id);
                              if (error) { toast.error(error.message); onChanged(); }
                              else { toast.success("Pembayaran dihapus"); onChanged(); }
                            }}
                            className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/10"
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
    if (error) { toast.error(error.message); return; }
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