import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { notifyError } from "@/lib/friendly-error";

/**
 * Detail transaksi Kios — /kios/riwayat/$kind/$id
 * $kind = "terima" (purchases) atau "jual" (sales).
 *
 * Menampilkan:
 *  - Info item (nama, satuan) & tautan ke Gudang
 *  - Perubahan stok: stok sebelum → sesudah transaksi, delta ±qty
 *  - Ringkasan pembayaran: metode, total, dibayar, sisa (jual-hutang)
 *  - Riwayat cicilan (customer_payments) untuk jual-hutang
 *  - Catatan / supplier / pelanggan
 */

export const Route = createFileRoute("/_authenticated/kios/riwayat/$kind/$id")({
  head: () => ({
    meta: [
      { title: "Detail Transaksi Kios — MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DetailPage,
});

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

function fmtQty(n: number, u: string | null) {
  const v = Number(n) || 0;
  const unit = u ?? "";
  return unit === "g"
    ? `${v.toLocaleString("id-ID", { maximumFractionDigits: 2 })} g`
    : `${v.toLocaleString("id-ID")} ${unit || "pcs"}`;
}

function fmtWaktu(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ItemInfo = {
  id: string;
  name: string;
  base_unit: string | null;
  stock_base: number;
};

type TerimaDetail = {
  kind: "terima";
  id: string;
  created_at: string;
  item: ItemInfo | null;
  qty_base: number;
  total: number;
  price_per_package: number;
  package_qty: number;
  package_size: number;
  payment_method: "kas" | "hutang";
  supplier_name: string | null;
  stock_before: number | null;
  stock_after: number | null;
};

type Cicilan = { id: string; amount: number; created_at: string; note: string | null };

type JualDetail = {
  kind: "jual";
  id: string;
  created_at: string;
  item: ItemInfo | null;
  qty_base: number;
  total: number;
  price_per_base: number;
  cost_at_sale: number;
  payment_method: "kas" | "hutang";
  customer_id: string | null;
  customer_name: string | null;
  note: string | null;
  paid_amount: number;
  payments: Cicilan[];
  stock_before: number | null;
  stock_after: number | null;
};

type Detail = TerimaDetail | JualDetail;

function DetailPage() {
  const { kind, id } = useParams({ from: "/_authenticated/kios/riwayat/$kind/$id" });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        if (kind !== "terima" && kind !== "jual") {
          setNotFound(true);
          return;
        }

        if (kind === "terima") {
          const { data: p, error } = await supabase
            .from("purchases")
            .select(
              "id,created_at,item_id,base_added,total_cost,price_per_package,package_qty,package_size_snapshot,payment_method,supplier_id",
            )
            .eq("id", id)
            .maybeSingle();
          if (error) throw error;
          if (!p) {
            if (on) setNotFound(true);
            return;
          }

          const [itemRes, supRes, laterPurRes, laterSaleRes] = await Promise.all([
            supabase
              .from("warehouse_items")
              .select("id,name,base_unit,stock_base")
              .eq("id", p.item_id as string)
              .maybeSingle(),
            p.supplier_id
              ? supabase
                  .from("suppliers")
                  .select("name")
                  .eq("id", p.supplier_id as string)
                  .maybeSingle()
              : Promise.resolve({ data: null, error: null } as const),
            supabase
              .from("purchases")
              .select("base_added")
              .eq("item_id", p.item_id as string)
              .gt("created_at", p.created_at as string),
            supabase
              .from("sales")
              .select("qty_base")
              .eq("item_id", p.item_id as string)
              .gt("created_at", p.created_at as string),
          ]);

          const item = itemRes.data
            ? {
                id: itemRes.data.id as string,
                name: itemRes.data.name as string,
                base_unit: (itemRes.data.base_unit as string | null) ?? null,
                stock_base: Number(itemRes.data.stock_base || 0),
              }
            : null;

          let stock_after: number | null = null;
          let stock_before: number | null = null;
          if (item) {
            const laterPur = (laterPurRes.data ?? []).reduce(
              (s, r) => s + Number(r.base_added || 0),
              0,
            );
            const laterSale = (laterSaleRes.data ?? []).reduce(
              (s, r) => s + Number(r.qty_base || 0),
              0,
            );
            stock_after = item.stock_base - laterPur + laterSale;
            stock_before = stock_after - Number(p.base_added || 0);
          }

          if (!on) return;
          setDetail({
            kind: "terima",
            id: p.id as string,
            created_at: p.created_at as string,
            item,
            qty_base: Number(p.base_added || 0),
            total: Number(p.total_cost || 0),
            price_per_package: Number(p.price_per_package || 0),
            package_qty: Number(p.package_qty || 0),
            package_size: Number(p.package_size_snapshot || 0),
            payment_method: (p.payment_method as "kas" | "hutang") ?? "kas",
            supplier_name: (supRes.data as { name?: string } | null)?.name ?? null,
            stock_before,
            stock_after,
          });
        } else {
          const { data: s, error } = await supabase
            .from("sales")
            .select(
              "id,created_at,item_id,qty_base,total_revenue,price_per_base,cost_at_sale,payment_method,customer_id,note",
            )
            .eq("id", id)
            .maybeSingle();
          if (error) throw error;
          if (!s) {
            if (on) setNotFound(true);
            return;
          }

          const [itemRes, custRes, payRes, laterPurRes, laterSaleRes] = await Promise.all([
            supabase
              .from("warehouse_items")
              .select("id,name,base_unit,stock_base")
              .eq("id", s.item_id as string)
              .maybeSingle(),
            s.customer_id
              ? supabase
                  .from("customers")
                  .select("name")
                  .eq("id", s.customer_id as string)
                  .maybeSingle()
              : Promise.resolve({ data: null, error: null } as const),
            supabase
              .from("customer_payments")
              .select("id,amount,created_at,note")
              .eq("sale_id", s.id as string)
              .order("created_at", { ascending: true }),
            supabase
              .from("purchases")
              .select("base_added")
              .eq("item_id", s.item_id as string)
              .gt("created_at", s.created_at as string),
            supabase
              .from("sales")
              .select("qty_base")
              .eq("item_id", s.item_id as string)
              .gt("created_at", s.created_at as string),
          ]);

          const item = itemRes.data
            ? {
                id: itemRes.data.id as string,
                name: itemRes.data.name as string,
                base_unit: (itemRes.data.base_unit as string | null) ?? null,
                stock_base: Number(itemRes.data.stock_base || 0),
              }
            : null;

          let stock_after: number | null = null;
          let stock_before: number | null = null;
          if (item) {
            const laterPur = (laterPurRes.data ?? []).reduce(
              (s2, r) => s2 + Number(r.base_added || 0),
              0,
            );
            const laterSale = (laterSaleRes.data ?? []).reduce(
              (s2, r) => s2 + Number(r.qty_base || 0),
              0,
            );
            stock_after = item.stock_base - laterPur + laterSale;
            stock_before = stock_after + Number(s.qty_base || 0);
          }

          const method = (s.payment_method as "kas" | "hutang") ?? "kas";
          const total = Number(s.total_revenue || 0);
          const payments = ((payRes.data ?? []) as Array<{
            id: string;
            amount: number;
            created_at: string;
            note: string | null;
          }>).map((r) => ({
            id: r.id,
            amount: Number(r.amount || 0),
            created_at: r.created_at,
            note: r.note,
          }));
          const paid =
            method === "kas"
              ? total
              : payments.reduce((sum, r) => sum + r.amount, 0);

          if (!on) return;
          setDetail({
            kind: "jual",
            id: s.id as string,
            created_at: s.created_at as string,
            item,
            qty_base: Number(s.qty_base || 0),
            total,
            price_per_base: Number(s.price_per_base || 0),
            cost_at_sale: Number(s.cost_at_sale || 0),
            payment_method: method,
            customer_id: (s.customer_id as string | null) ?? null,
            customer_name: (custRes.data as { name?: string } | null)?.name ?? null,
            note: (s.note as string | null) ?? null,
            paid_amount: paid,
            payments,
            stock_before,
            stock_after,
          });
        }
      } catch (e) {
        notifyError(e, { fallback: "Gagal memuat detail transaksi" });
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [kind, id]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-3">
          <Link
            to="/kios/riwayat"
            className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
          >
            ← Riwayat
          </Link>
          <h1 className="text-base font-bold">
            {kind === "terima" ? "📥 Detail Terima" : "💰 Detail Jual"}
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 p-3 pb-24">
        {loading ? (
          <div className="text-sm text-muted-foreground">Memuat…</div>
        ) : notFound || !detail ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Transaksi tidak ditemukan atau bukan milik akun ini.{" "}
            <Link to="/kios/riwayat" className="text-primary underline">
              Kembali ke Riwayat
            </Link>
            .
          </div>
        ) : detail.kind === "terima" ? (
          <TerimaView d={detail} />
        ) : (
          <JualView d={detail} />
        )}
      </main>
    </div>
  );
}

function ItemCard({ item }: { item: ItemInfo | null }) {
  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase text-muted-foreground">Barang</div>
      {item ? (
        <Link
          to="/gudang"
          className="mt-0.5 block text-base font-semibold hover:underline"
        >
          {item.name}
        </Link>
      ) : (
        <div className="mt-0.5 text-base font-semibold text-muted-foreground">
          (barang dihapus)
        </div>
      )}
      {item ? (
        <div className="mt-1 text-xs text-muted-foreground">
          Satuan dasar: {item.base_unit || "pcs"} · Stok kini{" "}
          <span className="tabular-nums">{fmtQty(item.stock_base, item.base_unit)}</span>
        </div>
      ) : null}
    </section>
  );
}

function StockCard({
  before,
  after,
  delta,
  unit,
  positive,
}: {
  before: number | null;
  after: number | null;
  delta: number;
  unit: string | null;
  positive: boolean;
}) {
  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase text-muted-foreground">Perubahan stok</div>
      {before === null || after === null ? (
        <div className="mt-1 text-xs text-muted-foreground">
          Barang sudah tidak ada — perubahan stok tidak bisa dihitung.
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <span className="tabular-nums text-sm">{fmtQty(before, unit)}</span>
          <span className="text-muted-foreground">→</span>
          <span className="tabular-nums text-sm font-semibold">
            {fmtQty(after, unit)}
          </span>
          <span
            className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
              positive
                ? "bg-success/15 text-success"
                : "bg-destructive/15 text-destructive"
            }`}
          >
            {positive ? "+" : "−"} {fmtQty(Math.abs(delta), unit)}
          </span>
        </div>
      )}
      <div className="mt-1 text-[11px] text-muted-foreground">
        Dihitung mundur dari stok kini dikurangi transaksi setelah ini.
      </div>
    </section>
  );
}

function KeyRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 text-sm">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className="text-right tabular-nums">{v}</span>
    </div>
  );
}

function TerimaView({ d }: { d: TerimaDetail }) {
  const unit = d.item?.base_unit ?? null;
  return (
    <>
      <div className="text-xs text-muted-foreground">{fmtWaktu(d.created_at)}</div>
      <ItemCard item={d.item} />
      <StockCard
        before={d.stock_before}
        after={d.stock_after}
        delta={d.qty_base}
        unit={unit}
        positive
      />
      <section className="rounded-lg border bg-card p-3">
        <div className="text-[10px] uppercase text-muted-foreground">Pembelian</div>
        <div className="mt-1 divide-y">
          <KeyRow k="Jumlah paket" v={`${d.package_qty.toLocaleString("id-ID")}×`} />
          <KeyRow
            k="Isi per paket"
            v={`${d.package_size.toLocaleString("id-ID")} ${unit || "pcs"}`}
          />
          <KeyRow k="Harga per paket" v={rupiah(d.price_per_package)} />
          <KeyRow
            k="Total barang masuk"
            v={fmtQty(d.qty_base, unit)}
          />
        </div>
      </section>
      <section className="rounded-lg border bg-card p-3">
        <div className="text-[10px] uppercase text-muted-foreground">Pembayaran</div>
        <div className="mt-1 divide-y">
          <KeyRow
            k="Metode"
            v={
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  d.payment_method === "kas"
                    ? "bg-success/15 text-success"
                    : "bg-warning/15 text-warning"
                }`}
              >
                {d.payment_method === "kas" ? "Lunas kas" : "Hutang supplier"}
              </span>
            }
          />
          <KeyRow k="Total biaya" v={rupiah(d.total)} />
          {d.supplier_name ? (
            <KeyRow k="Supplier" v={d.supplier_name} />
          ) : null}
        </div>
        {d.payment_method === "hutang" ? (
          <div className="mt-2">
            <Link
              to="/hutang-piutang"
              className="inline-block rounded-md border px-3 py-1 text-xs hover:bg-accent"
            >
              Lihat di Hutang-Piutang →
            </Link>
          </div>
        ) : null}
      </section>
    </>
  );
}

function JualView({ d }: { d: JualDetail }) {
  const unit = d.item?.base_unit ?? null;
  const sisa = Math.max(0, d.total - d.paid_amount);
  const isPaid = d.payment_method === "kas" || sisa === 0;
  const margin = d.total - d.cost_at_sale;
  return (
    <>
      <div className="text-xs text-muted-foreground">{fmtWaktu(d.created_at)}</div>
      <ItemCard item={d.item} />
      <StockCard
        before={d.stock_before}
        after={d.stock_after}
        delta={d.qty_base}
        unit={unit}
        positive={false}
      />
      <section className="rounded-lg border bg-card p-3">
        <div className="text-[10px] uppercase text-muted-foreground">Penjualan</div>
        <div className="mt-1 divide-y">
          <KeyRow k="Jumlah keluar" v={fmtQty(d.qty_base, unit)} />
          <KeyRow
            k={`Harga per ${unit || "pcs"}`}
            v={rupiah(d.price_per_base)}
          />
          <KeyRow k="Total penjualan" v={rupiah(d.total)} />
          <KeyRow k="HPP saat itu" v={rupiah(d.cost_at_sale)} />
          <KeyRow
            k="Margin"
            v={
              <span className={margin >= 0 ? "text-success" : "text-destructive"}>
                {margin >= 0 ? "+" : "−"} {rupiah(Math.abs(margin))}
              </span>
            }
          />
          {d.customer_name ? (
            <KeyRow
              k="Pelanggan"
              v={
                <Link to="/buku-alamat" className="hover:underline">
                  {d.customer_name}
                </Link>
              }
            />
          ) : null}
          {d.note ? (
            <KeyRow k="Catatan" v={<span className="italic">“{d.note}”</span>} />
          ) : null}
        </div>
      </section>
      <section className="rounded-lg border bg-card p-3">
        <div className="text-[10px] uppercase text-muted-foreground">Pembayaran</div>
        <div className="mt-1 divide-y">
          <KeyRow
            k="Metode"
            v={
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  isPaid
                    ? "bg-success/15 text-success"
                    : "bg-warning/15 text-warning"
                }`}
              >
                {d.payment_method === "kas"
                  ? "Lunas kas"
                  : isPaid
                    ? "Hutang — lunas"
                    : "Hutang berjalan"}
              </span>
            }
          />
          <KeyRow k="Total tagihan" v={rupiah(d.total)} />
          <KeyRow k="Sudah dibayar" v={rupiah(d.paid_amount)} />
          <KeyRow
            k="Sisa"
            v={
              <span className={sisa > 0 ? "text-warning" : ""}>{rupiah(sisa)}</span>
            }
          />
        </div>
        {d.payment_method === "hutang" && d.payments.length > 0 ? (
          <div className="mt-3">
            <div className="text-[10px] uppercase text-muted-foreground">
              Cicilan ({d.payments.length})
            </div>
            <ul className="mt-1 space-y-1">
              {d.payments.map((p) => (
                <li
                  key={p.id}
                  className="flex items-baseline justify-between gap-2 rounded-md border px-2 py-1 text-xs"
                >
                  <span className="text-muted-foreground">
                    {fmtWaktu(p.created_at)}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                  <span className="tabular-nums font-semibold">
                    {rupiah(p.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {d.payment_method === "hutang" ? (
          <div className="mt-2">
            <Link
              to="/hutang-piutang"
              className="inline-block rounded-md border px-3 py-1 text-xs hover:bg-accent"
            >
              Kelola di Hutang-Piutang →
            </Link>
          </div>
        ) : null}
      </section>
    </>
  );
}