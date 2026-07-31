/**
 * Verifikasi pembayaran transfer bank (khusus admin).
 *
 * Persetujuan memanggil RPC `admin_approve_payment` yang memperpanjang masa
 * aktif langganan dari sisa periode yang ada (tidak menghanguskan sisa hari).
 * Bukti transfer dibaca lewat signed URL karena bucket bersifat privat.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatIdr } from "@/lib/paddle";

export const Route = createFileRoute("/_authenticated/admin/verifikasi-pembayaran")({
  head: () => ({
    meta: [
      { title: "Verifikasi Pembayaran · MCM Storage" },
      {
        name: "description",
        content:
          "Tinjau bukti transfer bank pelanggan dan aktifkan langganan Pro secara manual.",
      },
      { property: "og:title", content: "Verifikasi Pembayaran · MCM Storage" },
      {
        property: "og:description",
        content: "Panel admin untuk menyetujui atau menolak pembayaran transfer bank.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VerifikasiPembayaranPage,
});

type Row = {
  id: string;
  user_id: string;
  amount_idr: number;
  billing_cycle: string;
  sender_name: string;
  sender_bank: string | null;
  transfer_date: string;
  proof_path: string;
  status: string;
  admin_note: string | null;
  created_at: string;
};

function VerifikasiPembayaranPage() {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-subscription-payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_payments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const openProof = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("payment-proofs")
      .createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      toast.error("Gagal membuka bukti transfer");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const review = async (row: Row, approve: boolean) => {
    setBusyId(row.id);
    const t = toast.loading(approve ? "Menyetujui…" : "Menolak…");
    try {
      const { data, error } = await supabase.rpc(
        approve ? "admin_approve_payment" : "admin_reject_payment",
        { _payment_id: row.id, _note: notes[row.id]?.trim() || "" },
      );
      if (error) throw new Error(error.message);
      const res = data as { ok?: boolean; error?: string } | null;
      if (res && res.ok === false) throw new Error(res.error ?? "Gagal memproses");
      toast.success(approve ? "Langganan diaktifkan" : "Pembayaran ditolak", { id: t });
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses", { id: t });
    } finally {
      setBusyId(null);
    }
  };

  const rows = data ?? [];
  const pending = rows.filter((r) => r.status === "pending");
  const reviewed = rows.filter((r) => r.status !== "pending");

  return (
    <PageContainer width="lg" bottomSafe>
      <header className="flex items-start gap-ms-2">
        <div className="space-ms-1">
          <h1 className="text-ms-xl font-semibold tracking-tight">
            Verifikasi pembayaran
          </h1>
          <p className="text-ms-sm text-muted-foreground">
            Bukti transfer bank dari pelanggan. Menyetujui akan langsung
            memperpanjang masa aktif Pro.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Segarkan
        </Button>
      </header>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : pending.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-ms-base">Tidak ada antrean</CardTitle>
            <CardDescription>Semua bukti transfer sudah ditinjau.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-ms-3">
          {pending.map((row) => (
            <Card key={row.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-ms-2">
                  <CardTitle className="text-ms-base">
                    {formatIdr(row.amount_idr)}
                  </CardTitle>
                  <Badge variant="secondary">
                    {row.billing_cycle === "yearly" ? "Tahunan" : "Bulanan"}
                  </Badge>
                  <Badge variant="outline" className="ml-auto">
                    Menunggu
                  </Badge>
                </div>
                <CardDescription>
                  {row.sender_name}
                  {row.sender_bank ? ` · ${row.sender_bank}` : ""} · transfer{" "}
                  {new Date(row.transfer_date).toLocaleDateString("id-ID")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-ms-2">
                <Button variant="secondary" size="sm" onClick={() => openProof(row.proof_path)}>
                  Lihat bukti transfer
                </Button>
                <Input
                  placeholder="Catatan admin (opsional)"
                  value={notes[row.id] ?? ""}
                  maxLength={200}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))
                  }
                />
                <div className="flex flex-wrap gap-ms-2">
                  <Button
                    size="sm"
                    onClick={() => review(row, true)}
                    disabled={busyId === row.id}
                    data-testid={`approve-${row.id}`}
                  >
                    {busyId === row.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    Setujui & aktifkan
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => review(row, false)}
                    disabled={busyId === row.id}
                  >
                    <X className="mr-2 h-4 w-4" aria-hidden="true" />
                    Tolak
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-ms-base">Sudah ditinjau</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-ms-sm">
              {reviewed.slice(0, 20).map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-ms-2 py-2">
                  <span>
                    {formatIdr(row.amount_idr)} · {row.sender_name}
                  </span>
                  <Badge variant={row.status === "approved" ? "default" : "destructive"}>
                    {row.status === "approved" ? "Disetujui" : "Ditolak"}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}