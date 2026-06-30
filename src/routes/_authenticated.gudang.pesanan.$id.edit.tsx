import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmtItemQty } from "@/lib/stock-format";

export const Route = createFileRoute("/_authenticated/gudang/pesanan/$id/edit")({
  component: PesananEditPage,
});

type Order = {
  id: string;
  customer_id: string | null;
  item_id: string;
  qty: number;
  qty_mode: "base" | "package";
  price_per_unit: number | null;
  note: string | null;
  status: string;
};
type Item = {
  id: string; name: string; package_type: string; package_size: number;
  base_unit: "g" | "pcs"; stock_base: number;
};
type Customer = { id: string; name: string };

function PesananEditPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // form
  const [customerId, setCustomerId] = useState<string>("");
  const [itemId, setItemId] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [qtyMode, setQtyMode] = useState<"base" | "package">("base");
  const [price, setPrice] = useState<string>("");
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [o, its, cs] = await Promise.all([
        supabase.from("order_requests").select("*").eq("id", id).maybeSingle(),
        supabase.from("warehouse_items").select("id,name,package_type,package_size,base_unit,stock_base").order("name"),
        supabase.from("customers").select("id,name").order("name"),
      ]);
      const ord = (o.data as Order) ?? null;
      setOrder(ord);
      setItems((its.data as Item[]) ?? []);
      setCustomers((cs.data as Customer[]) ?? []);
      if (ord) {
        setCustomerId(ord.customer_id ?? "");
        setItemId(ord.item_id);
        setQty(String(ord.qty ?? ""));
        setQtyMode(ord.qty_mode);
        setPrice(ord.price_per_unit != null ? String(ord.price_per_unit) : "");
        setNote(ord.note ?? "");
      }
      setLoading(false);
    })();
  }, [id]);

  const selectedItem = items.find((i) => i.id === itemId);
  const modeLabel = qtyMode === "base"
    ? (selectedItem?.base_unit === "g" ? "per gram" : "per pcs")
    : `per ${selectedItem?.package_type ?? "botol"}`;
  const unitLabel = qtyMode === "base"
    ? (selectedItem?.base_unit ?? "")
    : (selectedItem?.package_type ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    if (!itemId) { toast.error("Pilih barang"); return; }
    const qtyNum = Number(qty);
    if (!qtyNum || qtyNum <= 0) { toast.error("Jumlah tidak valid"); return; }
    setSaving(true);
    const { error } = await supabase.from("order_requests").update({
      customer_id: customerId || null,
      item_id: itemId,
      qty: qtyNum,
      qty_mode: qtyMode,
      price_per_unit: price ? Number(price) : null,
      note: note.trim() || null,
    }).eq("id", order.id);
    setSaving(false);
    if (error) { toast.error("Gagal menyimpan perubahan"); return; }
    toast.success("Pesanan diperbarui");
    navigate({ to: "/gudang/pesanan/$id", params: { id: order.id } });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-3">
          <button onClick={() => navigate({ to: "/gudang/pesanan/$id", params: { id } })} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">← Kembali</button>
          <h1 className="text-base font-bold">✏️ Edit Pesanan</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-3 p-3">
        {loading ? (
          <div className="text-sm text-muted-foreground">Memuat…</div>
        ) : !order ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Pesanan tidak ditemukan.<br />
            <Link to="/gudang" className="text-primary underline">Kembali ke Gudang</Link>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-3 rounded-lg border bg-card p-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Pelanggan</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full rounded border bg-background px-2 py-2 text-sm">
                <option value="">— Tanpa pelanggan —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold">Barang</label>
              <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="w-full rounded border bg-background px-2 py-2 text-sm" required>
                <option value="">— Pilih barang —</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.package_type} · {i.package_size}{i.base_unit})
                  </option>
                ))}
              </select>
              {selectedItem && (
                <div className="text-[11px] text-muted-foreground">Stok: {fmtItemQty(selectedItem.stock_base, selectedItem)}</div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold">Satuan pesanan</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setQtyMode("base")}
                  className={`flex-1 rounded border px-3 py-2 text-xs ${qtyMode === "base" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                  Per {selectedItem?.base_unit ?? "gram"}
                </button>
                <button type="button" onClick={() => setQtyMode("package")}
                  className={`flex-1 rounded border px-3 py-2 text-xs ${qtyMode === "package" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                  Per {selectedItem?.package_type ?? "botol"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold">Jumlah ({unitLabel || "—"})</label>
                <input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} className="w-full rounded border bg-background px-2 py-2 text-sm" required />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold">Harga {modeLabel}</label>
                <input type="number" step="any" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full rounded border bg-background px-2 py-2 text-sm" placeholder="Opsional" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold">Catatan</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full rounded border bg-background px-2 py-2 text-sm" placeholder="Catatan untuk pesanan ini…" />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving} className="flex-1 rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {saving ? "Menyimpan…" : "💾 Simpan perubahan"}
              </button>
              <button type="button" onClick={() => navigate({ to: "/gudang/pesanan/$id", params: { id } })} className="rounded border px-3 py-2 text-sm hover:bg-accent">Batal</button>
            </div>
            <div className="text-[11px] text-muted-foreground">Status saat ini: <b>{order.status}</b> (ubah status dari halaman detail).</div>
          </form>
        )}
      </main>
    </div>
  );
}