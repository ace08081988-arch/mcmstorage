import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ensureFreshSession } from "@/lib/ensure-session";
import { NumericDraftInput } from "@/components/NumericDraftInput";
import { notifyError } from "@/lib/friendly-error";
import { PageHeader } from "@/components/shell/PageHeader";
import { PageContainer } from "@/components/shell/PageContainer";
import {
  Store,
  History,
  Wallet,
  PackagePlus,
  HandCoins,
  AlertTriangle,
  Phone,
  Sparkles,
} from "lucide-react";

/**
 * Kios Terpadu — satu layar untuk:
 *  1) Terima barang dari pegawai (masuk stok via `purchases` → trigger apply_purchase).
 *  2) Jual ke pelanggan (keluar stok via `sales` → trigger apply_sale),
 *     dengan opsi bayar sebagian: sisa otomatis jadi piutang lewat
 *     `payment_method='hutang'` + `customer_payments` untuk jumlah yang
 *     sudah dibayar. Pelanggan baru otomatis dibuat di tabel `customers`
 *     (buku alamat) sehingga bisa dipakai lagi lain kali.
 *
 * Piutang otomatis ikut terhitung di `piutang_summary_v1` (SSOT) karena
 * kanal `sales hutang - customer_payments` dimasukkan di sana.
 */

export const Route = createFileRoute("/_authenticated/kios")({
  head: () => ({
    meta: [
      { title: "Kios Terpadu — Ace Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: KiosPage,
});

type Item = {
  id: string;
  name: string;
  base_unit: "g" | "pcs";
  stock_base: number;
  package_type: string;
  package_size: number;
  avg_cost_per_base: number;
};

type Customer = { id: string; name: string; contact: string | null };

function rupiah(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function fmtQty(n: number, u: "g" | "pcs") {
  const v = Number(n) || 0;
  return u === "g"
    ? `${v.toLocaleString("id-ID", { maximumFractionDigits: 2 })} g`
    : `${v.toLocaleString("id-ID")} pcs`;
}

function KiosPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  async function refreshItems() {
    const { data } = await supabase
      .from("warehouse_items")
      .select("id,name,base_unit,stock_base,package_type,package_size,avg_cost_per_base")
      .order("name", { ascending: true });
    setItems((data as Item[]) ?? []);
  }
  async function refreshCustomers() {
    const { data } = await supabase
      .from("customers")
      .select("id,name,contact")
      .order("name", { ascending: true });
    setCustomers((data as Customer[]) ?? []);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([refreshItems(), refreshCustomers()]);
      setLoading(false);
    })();
  }, []);

  // ============ TERIMA DARI PEGAWAI ============
  const [rxItemId, setRxItemId] = useState<string>("");
  const [rxQty, setRxQty] = useState<number>(0);
  const [rxCost, setRxCost] = useState<number>(0);
  const [rxNote, setRxNote] = useState<string>("");
  const [rxBusy, setRxBusy] = useState(false);
  const rxItem = useMemo(() => items.find((i) => i.id === rxItemId) ?? null, [items, rxItemId]);

  async function submitTerima() {
    if (!rxItem) return toast.error("Pilih barang dulu");
    if (rxQty <= 0) return toast.error("Jumlah harus > 0");
    setRxBusy(true);
    try {
      const { userId } = await ensureFreshSession();
      // Model `purchases`: package_qty & package_size_snapshot dipakai trigger
      // apply_purchase untuk menghitung base_added. Untuk kios kita kirim dalam
      // satuan base langsung → package_qty=qty, package_size_snapshot=1,
      // base_added=qty. total_cost = qty × cost.
      const totalCost = rxQty * (rxCost || 0);
      const { error } = await supabase.from("purchases").insert({
        user_id: userId,
        item_id: rxItem.id,
        supplier_id: null,
        package_qty: rxQty,
        package_size_snapshot: 1,
        base_added: rxQty,
        price_per_package: rxCost || 0,
        total_cost: totalCost,
        payment_method: "kas",
      });
      if (error) throw error;
      toast.success(`Diterima: ${fmtQty(rxQty, rxItem.base_unit)} ${rxItem.name}`);
      setRxQty(0);
      setRxCost(0);
      setRxNote("");
      await refreshItems();
    } catch (e) {
      notifyError(e, { fallback: "Gagal mencatat penerimaan" });
    } finally {
      setRxBusy(false);
    }
  }

  // ============ JUAL KE PELANGGAN ============
  const [sxItemId, setSxItemId] = useState<string>("");
  const [sxQty, setSxQty] = useState<number>(0);
  const [sxPrice, setSxPrice] = useState<number>(0);
  const [sxCustName, setSxCustName] = useState<string>("");
  const [sxCustContact, setSxCustContact] = useState<string>("");
  const [sxPaid, setSxPaid] = useState<number>(0);
  const [paidTouched, setPaidTouched] = useState(false);
  const [sxBusy, setSxBusy] = useState(false);
  const sxItem = useMemo(() => items.find((i) => i.id === sxItemId) ?? null, [items, sxItemId]);
  const subtotal = sxQty * sxPrice;

  // Default: dibayar = subtotal (Lunas) bila user belum menyentuh field.
  useEffect(() => {
    if (!paidTouched) setSxPaid(subtotal);
  }, [subtotal, paidTouched]);

  const matchedCustomer = useMemo<Customer | null>(() => {
    const q = sxCustName.trim().toLowerCase();
    if (!q) return null;
    return customers.find((c) => c.name.trim().toLowerCase() === q) ?? null;
  }, [customers, sxCustName]);

  const suggestions = useMemo<Customer[]>(() => {
    const q = sxCustName.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 5);
  }, [customers, sxCustName]);

  const remaining = Math.max(0, subtotal - (sxPaid || 0));
  const overpay = (sxPaid || 0) > subtotal;

  async function submitJual() {
    if (!sxItem) return toast.error("Pilih barang dulu");
    if (sxQty <= 0) return toast.error("Jumlah harus > 0");
    if (sxPrice <= 0) return toast.error("Harga jual harus > 0");
    if (sxQty > sxItem.stock_base) return toast.error("Stok kurang");
    const custName = sxCustName.trim();
    if (!custName) return toast.error("Isi nama pelanggan");
    if (custName.length > 100) return toast.error("Nama pelanggan terlalu panjang");
    if (sxCustContact && sxCustContact.length > 60) return toast.error("Kontak terlalu panjang");
    if (overpay) return toast.error("Dibayar melebihi total");

    setSxBusy(true);
    try {
      const { userId } = await ensureFreshSession();

      // 1) Ensure customer (upsert-by-name di scope user).
      let customerId = matchedCustomer?.id ?? null;
      if (!customerId) {
        const { data: newCust, error: custErr } = await supabase
          .from("customers")
          .insert({
            user_id: userId,
            name: custName,
            contact: sxCustContact.trim() || null,
          })
          .select("id,name,contact")
          .single();
        if (custErr) throw custErr;
        customerId = newCust.id;
      } else if (sxCustContact.trim() && sxCustContact.trim() !== (matchedCustomer?.contact ?? "")) {
        // Update kontak kalau user isi kontak baru untuk pelanggan lama.
        await supabase
          .from("customers")
          .update({ contact: sxCustContact.trim() })
          .eq("id", customerId);
      }

      // 2) Tulis sales. payment_method='kas' bila lunas penuh, else 'hutang'
      //    (piutang muncul otomatis di Gudang/Dashboard via piutang_summary_v1).
      const paid = Math.max(0, Math.min(sxPaid || 0, subtotal));
      const lunas = paid >= subtotal;
      const { data: saleRow, error: saleErr } = await supabase
        .from("sales")
        .insert({
          user_id: userId,
          item_id: sxItem.id,
          qty_base: sxQty,
          price_per_base: sxPrice,
          total_revenue: 0, // dihitung ulang oleh trigger apply_sale
          note: "Kios Terpadu",
          customer_id: customerId,
          payment_method: lunas ? "kas" : "hutang",
        })
        .select("id")
        .single();
      if (saleErr) throw saleErr;

      // 3) Bayar sebagian → catat pembayaran (customer_payments) yang
      //    mengurangi outstanding di piutang_summary_v1.
      if (!lunas && paid > 0 && customerId) {
        const { error: payErr } = await supabase.from("customer_payments").insert({
          user_id: userId,
          customer_id: customerId,
          sale_id: saleRow.id,
          amount: paid,
          note: "Bayar sebagian di Kios",
        });
        if (payErr) throw payErr;
      }

      const status = lunas
        ? "Lunas"
        : paid > 0
          ? `Bayar ${rupiah(paid)}, sisa piutang ${rupiah(remaining)}`
          : `Piutang ${rupiah(subtotal)}`;
      toast.success(`Terjual ke ${custName} — ${status}`);

      // Reset form transaksi (nama pelanggan dikosongkan agar tidak salah reuse).
      setSxItemId("");
      setSxQty(0);
      setSxPrice(0);
      setSxCustName("");
      setSxCustContact("");
      setSxPaid(0);
      setPaidTouched(false);

      await Promise.all([refreshItems(), refreshCustomers()]);
    } catch (e) {
      notifyError(e, { fallback: "Gagal menyimpan penjualan" });
    } finally {
      setSxBusy(false);
    }
  }

  return (
    <div data-press-scope="on">
      <PageHeader
        icon={Store}
        title="Kios Terpadu"
        subtitle="Terima stok · jual langsung"
      />

      <PageContainer ariaLabel="Kios Terpadu">
        {/* Aksi cepat — konsisten dengan halaman lain: pill, bukan tombol
            kotak kecil yang menempel di header. */}
        <div className="flex flex-wrap items-center gap-ms-2">
          <Link
            to="/kios/riwayat"
            className="inline-flex min-h-9 items-center gap-ms-1.5 rounded-full border border-border/70 bg-card px-ms-3 text-ms-xs font-medium text-foreground hover:border-primary/50"
          >
            <History className="h-4 w-4 text-primary" />
            Riwayat
          </Link>
          <Link
            to="/hutang-piutang"
            className="inline-flex min-h-9 items-center gap-ms-1.5 rounded-full border border-border/70 bg-card px-ms-3 text-ms-xs font-medium text-foreground hover:border-primary/50"
          >
            <Wallet className="h-4 w-4 text-primary" />
            Piutang
          </Link>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Memuat…</div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
            Belum ada barang di gudang.{" "}
            <Link to="/gudang" className="text-primary underline">
              Tambah barang dulu
            </Link>
            .
          </div>
        ) : (
          <>
            {/* ================ TERIMA DARI PEGAWAI ================ */}
            <section className="rounded-2xl border border-border/70 bg-card p-ms-4 space-ms-3 shadow-sm">
              <div className="flex min-w-0 items-start gap-ms-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/35 bg-primary/12 text-primary">
                  <PackagePlus className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-ms-sm font-semibold text-foreground">Terima dari Pegawai</h2>
                  <p className="text-ms-xs text-muted-foreground">
                    Barang yang diserahkan pegawai langsung masuk stok.
                  </p>
                </div>
              </div>


              <label className="block space-y-1">
                <span className="text-xs font-medium">Barang</span>
                <select
                  value={rxItemId}
                  onChange={(e) => setRxItemId(e.target.value)}
                  className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                >
                  <option value="">— pilih barang —</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} · stok {fmtQty(it.stock_base, it.base_unit)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium">
                    Jumlah {rxItem ? `(${rxItem.base_unit})` : ""}
                  </span>
                  <NumericDraftInput
                    value={rxQty}
                    min={0}
                    max={9_999_999}
                    step={rxItem?.base_unit === "g" ? 0.1 : 1}
                    onCommit={setRxQty}
                    className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                    ariaLabel="Jumlah diterima"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">Harga beli / satuan</span>
                  <NumericDraftInput
                    value={rxCost}
                    min={0}
                    max={999_999_999}
                    step={1}
                    onCommit={setRxCost}
                    className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                    ariaLabel="Harga beli per satuan"
                    placeholder="0 (opsional)"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium">Catatan</span>
                <input
                  type="text"
                  value={rxNote}
                  onChange={(e) => setRxNote(e.target.value.slice(0, 200))}
                  className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                  placeholder="opsional (mis. nama pegawai)"
                />
              </label>

              {rxItem && rxQty > 0 && (
                <div className="rounded bg-muted/50 p-2 text-xs">
                  Stok setelah:{" "}
                  <b>{fmtQty(rxItem.stock_base + rxQty, rxItem.base_unit)}</b>
                  {rxCost > 0 && (
                    <>
                      {" · "}Total nilai: <b>{rupiah(rxQty * rxCost)}</b>
                    </>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={submitTerima}
                disabled={rxBusy || !rxItem || rxQty <= 0}
                className="min-h-11 w-full rounded-xl bg-primary px-ms-3 text-ms-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:opacity-50"
              >
                {rxBusy ? "Menyimpan…" : "Terima & Tambah Stok"}
              </button>
            </section>

            {/* ================ JUAL KE PELANGGAN ================ */}
            <section className="rounded-2xl border border-border/70 bg-card p-ms-4 space-ms-3 shadow-sm">
              <div className="flex min-w-0 items-start gap-ms-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/35 bg-primary/12 text-primary">
                  <HandCoins className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-ms-sm font-semibold text-foreground">Jual ke Pelanggan</h2>
                  <p className="text-ms-xs text-muted-foreground">
                    Stok berkurang otomatis. Sisa yang belum dibayar otomatis jadi piutang.
                  </p>
                </div>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium">Barang</span>
                <select
                  value={sxItemId}
                  onChange={(e) => {
                    setSxItemId(e.target.value);
                    const it = items.find((i) => i.id === e.target.value);
                    if (it && sxPrice === 0 && it.avg_cost_per_base > 0) {
                      // Saran harga awal = modal rata-rata (user boleh ganti).
                      setSxPrice(Math.round(it.avg_cost_per_base));
                    }
                  }}
                  className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                >
                  <option value="">— pilih barang —</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id} disabled={it.stock_base <= 0}>
                      {it.name} · stok {fmtQty(it.stock_base, it.base_unit)}
                      {it.stock_base <= 0 ? " (habis)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium">
                    Jumlah {sxItem ? `(${sxItem.base_unit})` : ""}
                  </span>
                  <NumericDraftInput
                    value={sxQty}
                    min={0}
                    max={sxItem?.stock_base ?? 9_999_999}
                    step={sxItem?.base_unit === "g" ? 0.1 : 1}
                    onCommit={setSxQty}
                    className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                    ariaLabel="Jumlah jual"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">Harga jual / satuan</span>
                  <NumericDraftInput
                    value={sxPrice}
                    min={0}
                    max={999_999_999}
                    step={1}
                    onCommit={setSxPrice}
                    className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                    ariaLabel="Harga jual per satuan"
                  />
                </label>
              </div>

              {sxItem && sxQty > sxItem.stock_base && (
                <div className="flex items-center gap-ms-1.5 rounded-xl bg-destructive/10 p-ms-2 text-ms-xs text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> Stok kurang. Tersedia {fmtQty(sxItem.stock_base, sxItem.base_unit)}.
                </div>
              )}

              <div className="relative space-y-1">
                <label className="block space-y-1">
                  <span className="text-xs font-medium">Nama pelanggan</span>
                  <input
                    type="text"
                    value={sxCustName}
                    onChange={(e) => setSxCustName(e.target.value.slice(0, 100))}
                    className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                    placeholder="ketik nama, pilih dari daftar atau buat baru"
                    autoComplete="off"
                  />
                </label>
                {suggestions.length > 0 && !matchedCustomer && (
                  <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-md border bg-popover shadow-lg">
                    {suggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSxCustName(c.name);
                          setSxCustContact(c.contact ?? "");
                        }}
                        className="block w-full px-2 py-1.5 text-left text-xs hover:bg-accent"
                      >
                        <div className="font-medium">{c.name}</div>
                        {c.contact && (
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Phone className="h-3 w-3" />{c.contact}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {sxCustName.trim() && !matchedCustomer && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Sparkles className="h-3 w-3 text-primary" /> Pelanggan baru — akan disimpan otomatis ke buku alamat.
                  </div>
                )}
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium">Kontak / no. HP</span>
                <input
                  type="text"
                  value={sxCustContact}
                  onChange={(e) => setSxCustContact(e.target.value.slice(0, 60))}
                  className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                  placeholder="opsional"
                  inputMode="tel"
                  autoComplete="off"
                />
              </label>

              <div className="rounded-md bg-muted/50 p-2 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total</span>
                  <b className="tabular-nums">{rupiah(subtotal)}</b>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Dibayar sekarang</span>
                  <div className="flex items-center gap-1">
                    <NumericDraftInput
                      value={sxPaid}
                      min={0}
                      max={subtotal || 999_999_999}
                      step={1}
                      onCommit={(n) => {
                        setSxPaid(n);
                        setPaidTouched(true);
                      }}
                      onFocus={() => setPaidTouched(true)}
                      className="w-32 rounded border bg-background px-2 py-1 text-right text-xs tabular-nums"
                      ariaLabel="Jumlah dibayar sekarang"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSxPaid(subtotal);
                        setPaidTouched(true);
                      }}
                      className="rounded border px-1.5 py-1 text-[10px] hover:bg-accent"
                    >
                      Lunas
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSxPaid(0);
                        setPaidTouched(true);
                      }}
                      className="rounded border px-1.5 py-1 text-[10px] hover:bg-accent"
                    >
                      0
                    </button>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sisa piutang</span>
                  <b
                    className={`tabular-nums ${remaining > 0 ? "text-warning" : "text-success"}`}
                  >
                    {rupiah(remaining)}
                  </b>
                </div>
                {overpay && (
                  <div className="text-[10px] text-destructive">
                    Dibayar melebihi total — kurangi dulu.
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={submitJual}
                disabled={
                  sxBusy ||
                  !sxItem ||
                  sxQty <= 0 ||
                  sxPrice <= 0 ||
                  !sxCustName.trim() ||
                  overpay ||
                  (sxItem ? sxQty > sxItem.stock_base : false)
                }
                className="min-h-11 w-full rounded-xl bg-primary px-ms-3 text-ms-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:opacity-50"
              >
                {sxBusy
                  ? "Menyimpan…"
                  : remaining > 0
                    ? `Simpan (Piutang ${rupiah(remaining)})`
                    : "Simpan (Lunas)"}
              </button>
            </section>
          </>
        )}
      </PageContainer>
    </div>
  );
}
