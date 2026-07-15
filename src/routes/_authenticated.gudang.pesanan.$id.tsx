import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { confirm } from "@/lib/confirm";
import { fmtItemQty } from "@/lib/stock-format";
import { StatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/_authenticated/gudang/pesanan/$id")({
  component: PesananDetailPage,
});

type Order = {
  id: string;
  user_id: string;
  customer_id: string | null;
  item_id: string;
  qty: number;
  qty_mode: "base" | "package";
  price_per_unit: number | null;
  note: string | null;
  status: "menunggu" | "siap" | "selesai";
  created_at: string;
  updated_at: string;
};
type Item = {
  id: string; name: string; package_type: string; package_size: number;
  base_unit: "g" | "pcs"; stock_base: number; avg_cost_per_base: number;
};
type Customer = { id: string; name: string; contact: string | null };
type Event = {
  id: string; from_status: string | null; to_status: string;
  note: string | null; created_at: string;
};

function rupiah(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}
function fmtBase(n: number, u: "g" | "pcs") {
  const v = Number(n) || 0;
  return u === "g" ? `${v.toLocaleString("id-ID", { maximumFractionDigits: 2 })} g` : `${v.toLocaleString("id-ID")} pcs`;
}

function PesananDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const { data: o } = await supabase.from("order_requests").select("*").eq("id", id).maybeSingle();
    if (!o) { setOrder(null); setLoading(false); return; }
    const ord = o as Order;
    setOrder(ord);
    const [it, c, ev] = await Promise.all([
      supabase.from("warehouse_items").select("*").eq("id", ord.item_id).maybeSingle(),
      ord.customer_id ? supabase.from("customers").select("*").eq("id", ord.customer_id).maybeSingle() : Promise.resolve({ data: null } as any),
      supabase.from("order_request_events").select("*").eq("order_id", ord.id).order("created_at", { ascending: true }),
    ]);
    setItem((it.data as Item) ?? null);
    setCustomer((c.data as Customer) ?? null);
    setEvents((ev.data as Event[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [id]);

  const qtyBase = item && order ? (order.qty_mode === "base" ? Number(order.qty) : Number(order.qty) * item.package_size) : 0;
  const cukup = item ? qtyBase <= item.stock_base : false;
  const perUnitLabel = order ? (order.qty_mode === "base" ? item?.base_unit : item?.package_type) : "";

  async function setStatus(to: Order["status"]) {
    if (!order) return;
    setBusy(true);
    const { error } = await supabase.from("order_requests").update({ status: to }).eq("id", order.id);
    setBusy(false);
    if (error) { toast.error("Gagal ubah status"); return; }
    toast.success(`Status diubah → ${to}`);
    load();
  }

  async function proses() {
    if (!order || !item) return;
    // C3: cegah double-decrement stok kalau pesanan sudah selesai.
    if (order.status === "selesai") {
      toast.error("Pesanan sudah selesai — tidak bisa diproses ulang.");
      return;
    }
    if (qtyBase > item.stock_base) { toast.error("Stok kurang"); return; }
    const perBase = order.price_per_unit
      ? (order.qty_mode === "base" ? Number(order.price_per_unit) : Number(order.price_per_unit) / item.package_size)
      : 0;
    if (!(await confirm({
      title: "Catat penjualan?",
      description: `${fmtBase(qtyBase, item.base_unit)} × ${rupiah(perBase)}/${item.base_unit}`,
      confirmText: "Catat",
    }))) return;
    setBusy(true);
    // H3: total_revenue & cost_at_sale diisi otomatis oleh trigger apply_sale
    // (SSOT harga & modal). Klien hanya menyerahkan qty & harga per unit
    // supaya tidak ada risiko drift kalau ke depan formula berubah.
    const { error } = await supabase.from("sales").insert({
      user_id: order.user_id, item_id: item.id, qty_base: qtyBase,
      price_per_base: perBase, total_revenue: 0,
      note: `Pesanan: ${order.note ?? "-"}`, customer_id: order.customer_id, payment_method: "kas",
    });
    if (error) { setBusy(false); toast.error("Gagal catat penjualan"); return; }
    await supabase.from("order_requests").update({ status: "selesai" }).eq("id", order.id);
    setBusy(false);
    toast.success("Pesanan diproses jadi penjualan");
    load();
  }

  // Badge status pakai komponen bersama agar konsisten & tidak overflow.

  return (
    <div className="min-h-screen bg-background text-foreground" data-press-scope="on">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-ms-2 px-ms-3 py-ms-3">
          <button onClick={() => navigate({ to: "/gudang" })} className="rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent">← Kembali</button>
          <h1 className="text-ms-base font-bold">📝 Detail Pesanan</h1>
          <Link to="/gudang/pesanan/$id/edit" params={{ id }} className="ml-auto rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent">✏️ Edit</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-ms-3 p-ms-3">
        {loading ? (
          <div className="text-ms-sm text-muted-foreground">Memuat…</div>
        ) : !order ? (
          <div className="rounded-lg border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">
            Pesanan tidak ditemukan.<br />
            <Link to="/gudang" className="text-primary underline">Kembali ke Gudang</Link>
          </div>
        ) : (
          <>
            <div className="rounded-lg border bg-card p-ms-3 space-ms-2">
              <div className="flex items-start justify-between gap-ms-2">
                <div>
                  <div className="text-ms-sm font-semibold">{item?.name ?? "(barang dihapus)"}</div>
                  <div className="text-ms-2xs text-muted-foreground">
                    {customer?.name ?? "Tanpa pelanggan"}
                    {customer?.contact && ` · 📞 ${customer.contact}`}
                  </div>
                </div>
                <StatusBadge status={order.status} />
              </div>
              <div className="grid grid-cols-2 gap-ms-2 text-ms-2xs">
                <div className="rounded bg-muted/50 p-ms-2">
                  <div className="text-muted-foreground">Jumlah pesanan</div>
                  <div className="font-semibold">{order.qty} {perUnitLabel}</div>
                  {item && order.qty_mode === "package" && (
                    <div className="text-ms-2xs text-muted-foreground">≈ {fmtBase(qtyBase, item.base_unit)}</div>
                  )}
                </div>
                <div className="rounded bg-muted/50 p-ms-2">
                  <div className="text-muted-foreground">Harga</div>
                  <div className="font-semibold">
                    {order.price_per_unit != null ? `${rupiah(Number(order.price_per_unit))}/${perUnitLabel}` : "—"}
                  </div>
                  {order.price_per_unit != null && item && (
                    <div className="text-ms-2xs text-muted-foreground">Total ≈ {rupiah(qtyBase * (order.qty_mode === "base" ? Number(order.price_per_unit) : Number(order.price_per_unit) / item.package_size))}</div>
                  )}
                </div>
              </div>
              {order.note && <div className="text-ms-2xs text-muted-foreground">📌 {order.note}</div>}
              <div className="text-ms-2xs text-muted-foreground">
                Dibuat: {new Date(order.created_at).toLocaleString("id-ID")} · Diperbarui: {new Date(order.updated_at).toLocaleString("id-ID")}
              </div>
            </div>

            <div className="rounded-lg border bg-card p-ms-3 space-ms-2">
              <div className="text-ms-xs font-semibold">📦 Ringkasan Stok</div>
              {item ? (
                <div className="grid grid-cols-3 gap-ms-2 text-ms-2xs">
                  <div className="rounded bg-muted/50 p-ms-2">
                    <div className="text-muted-foreground">Stok saat ini</div>
                    <div className="font-semibold">{fmtItemQty(item.stock_base, item)}</div>
                  </div>
                  <div className="rounded bg-muted/50 p-ms-2">
                    <div className="text-muted-foreground">Dibutuhkan</div>
                    <div className="font-semibold">{fmtItemQty(qtyBase, item)}</div>
                  </div>
                  <div className={`rounded p-ms-2 ${cukup ? "bg-success/10" : "bg-destructive/10"}`}>
                    <div className="text-muted-foreground">Sisa setelah</div>
                    <div className={`font-semibold ${cukup ? "" : "text-destructive"}`}>
                      {cukup ? fmtItemQty(item.stock_base - qtyBase, item) : "KURANG"}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-ms-2xs text-muted-foreground">Barang tidak ditemukan.</div>
              )}
            </div>

            <div className="rounded-lg border bg-card p-ms-3 space-ms-2">
              <div className="text-ms-xs font-semibold">🕒 Riwayat Perubahan Status</div>
              {events.length === 0 ? (
                <div className="text-ms-2xs text-muted-foreground">Belum ada riwayat.</div>
              ) : (
                <ol className="space-ms-2">
                  {events.map((e) => (
                    <li key={e.id} className="flex items-start gap-ms-2 text-ms-2xs">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0 flex-1">
                        <div>
                          {e.from_status ? <><span className="text-muted-foreground">{e.from_status}</span> → </> : null}
                          <StatusBadge status={e.to_status} size="xs" />
                        </div>
                        <div className="text-ms-2xs text-muted-foreground">
                          {new Date(e.created_at).toLocaleString("id-ID")}
                          {e.note && ` · ${e.note}`}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="rounded-lg border bg-card p-ms-3 space-ms-2">
              <div className="text-ms-xs font-semibold">⚙️ Aksi</div>
              <div className="flex flex-wrap gap-ms-2">
                {order.status !== "menunggu" && (
                  <button disabled={busy} onClick={() => setStatus("menunggu")} className="rounded border px-ms-3 py-1.5 text-ms-xs hover:bg-accent disabled:opacity-50">↩️ Kembalikan ke Menunggu</button>
                )}
                {order.status !== "siap" && (
                  <button disabled={busy} onClick={() => setStatus("siap")} className="rounded border px-ms-3 py-1.5 text-ms-xs hover:bg-accent disabled:opacity-50">📦 Tandai Siap</button>
                )}
                <button disabled={busy || !item || !cukup || order.status === "selesai"} onClick={proses} className="rounded bg-primary px-ms-3 py-1.5 text-ms-xs font-semibold text-primary-foreground disabled:opacity-50">
                  💰 Proses Jadi Penjualan
                </button>
                {order.status === "selesai" && (
                  <span className="self-center text-ms-2xs text-muted-foreground">Pesanan sudah selesai — sudah tercatat sebagai penjualan.</span>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
