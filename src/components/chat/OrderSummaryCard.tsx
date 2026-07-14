import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  User as UserIcon,
  ClipboardList,
  Package,
  Wallet,
  History as HistoryIcon,
  UserSquare,
  Hash,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/StatusBadge";
import {
  deriveEcerStatus,
  deriveRequestStatus,
  type LifecycleStatus,
  type PrepLifecycleInput,
  type TaskLifecycleInput,
} from "@/lib/prep-status";
import { cn } from "@/lib/utils";

/**
 * Slice B — Order Summary Card + Quick Actions.
 *
 * Kartu ringkasan yang muncul di atas transkrip chat bila conversation
 * sudah ditautkan ke business object (customer / request prep / ecer
 * prep / prep task). Bertindak sebagai identitas utama percakapan
 * (Nomor Order) sesuai master workflow MCM Storage.
 *
 * - Tidak mengubah RLS/data lain. Hanya membaca kolom link yang sudah
 *   ditambahkan pada Slice A.
 * - Bila tidak ada link sama sekali → komponen tidak render (silent).
 * - Status dihitung via SSOT `deriveRequestStatus` / `deriveEcerStatus`
 *   sehingga konsisten dengan surface /request dan /ecer.
 */

type Links = {
  linked_customer_id?: string | null;
  linked_request_prep_id?: string | null;
  linked_ecer_prep_id?: string | null;
  linked_task_id?: string | null;
  linked_product_id?: string | null;
};

function shortId(id: string | null | undefined): string {
  if (!id) return "";
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function paymentBadge(prep: PrepLifecycleInput | null | undefined) {
  if (!prep?.sold_at) return null;
  const pm = (prep.sold_payment_method ?? "").toLowerCase();
  if (pm === "kas") return <StatusBadge lifecycle="paid" />;
  if (pm === "partial") return <StatusBadge lifecycle="dp" />;
  if (pm === "hutang") return <StatusBadge lifecycle="credit" />;
  return <StatusBadge lifecycle="sent" />;
}

export function OrderSummaryCard({
  links,
  className,
}: {
  links: Links;
  className?: string;
}) {
  const hasAnyLink = Boolean(
    links.linked_customer_id ||
      links.linked_request_prep_id ||
      links.linked_ecer_prep_id ||
      links.linked_task_id ||
      links.linked_product_id,
  );

  const customer = useQuery({
    queryKey: ["chat-summary", "customer", links.linked_customer_id],
    enabled: Boolean(links.linked_customer_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, contact")
        .eq("id", links.linked_customer_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  const requestPrep = useQuery({
    queryKey: ["chat-summary", "request-prep", links.linked_request_prep_id],
    enabled: Boolean(links.linked_request_prep_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("request_preparations")
        .select(
          "id, actual_grams, sold_at, sold_total, sold_paid_amount, sold_payment_method, verification_status, rejection_reason, ready_at, archived_at, warehouse_item_id",
        )
        .eq("id", links.linked_request_prep_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  const ecerPrep = useQuery({
    queryKey: ["chat-summary", "ecer-prep", links.linked_ecer_prep_id],
    enabled: Boolean(links.linked_ecer_prep_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ecer_preparations")
        .select(
          "id, sold_at, sold_total, sold_paid_amount, sold_payment_method, verification_status, rejection_reason, ready_at, archived_at, title_id",
        )
        .eq("id", links.linked_ecer_prep_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  const task = useQuery({
    queryKey: ["chat-summary", "task", links.linked_task_id],
    enabled: Boolean(links.linked_task_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prep_tasks")
        .select("id, title, status, employee_id, completed_at")
        .eq("id", links.linked_task_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  const product = useQuery({
    queryKey: ["chat-summary", "product", links.linked_product_id],
    enabled: Boolean(links.linked_product_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_items")
        .select("id, name")
        .eq("id", links.linked_product_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const derived = useMemo<{
    orderLabel: string;
    lifecycle: LifecycleStatus | null;
    scope: "request" | "ecer" | "task" | "customer" | "none";
  }>(() => {
    if (links.linked_request_prep_id) {
      const prep = (requestPrep.data ?? null) as PrepLifecycleInput | null;
      const t = (task.data ?? null) as TaskLifecycleInput | null;
      return {
        orderLabel: `REQ-${shortId(links.linked_request_prep_id)}`,
        lifecycle: deriveRequestStatus(prep, t),
        scope: "request",
      };
    }
    if (links.linked_ecer_prep_id) {
      const prep = (ecerPrep.data ?? null) as PrepLifecycleInput | null;
      const t = (task.data ?? null) as TaskLifecycleInput | null;
      return {
        orderLabel: `ECER-${shortId(links.linked_ecer_prep_id)}`,
        lifecycle: deriveEcerStatus(prep, t),
        scope: "ecer",
      };
    }
    if (links.linked_task_id) {
      const t = (task.data ?? null) as TaskLifecycleInput | null;
      return {
        orderLabel: `TASK-${shortId(links.linked_task_id)}`,
        lifecycle: deriveRequestStatus(null, t),
        scope: "task",
      };
    }
    if (links.linked_customer_id) {
      return {
        orderLabel: `CUST-${shortId(links.linked_customer_id)}`,
        lifecycle: null,
        scope: "customer",
      };
    }
    return { orderLabel: "", lifecycle: null, scope: "none" };
  }, [
    links.linked_request_prep_id,
    links.linked_ecer_prep_id,
    links.linked_task_id,
    links.linked_customer_id,
    requestPrep.data,
    ecerPrep.data,
    task.data,
  ]);

  if (!hasAnyLink) return null;

  const prepForPayment =
    (requestPrep.data as PrepLifecycleInput | null) ??
    (ecerPrep.data as PrepLifecycleInput | null) ??
    null;
  const payBadge = paymentBadge(prepForPayment);
  const customerName = customer.data?.name ?? null;
  const productName = product.data?.name ?? null;
  const grams =
    (requestPrep.data as { actual_grams?: number | null } | null | undefined)
      ?.actual_grams ?? null;
  const soldTotal = prepForPayment?.sold_total ?? null;
  const soldPaid = prepForPayment?.sold_paid_amount ?? null;
  const sisa =
    typeof soldTotal === "number" && typeof soldPaid === "number"
      ? Math.max(0, soldTotal - soldPaid)
      : null;

  return (
    <section
      className={cn(
        "mx-2 my-2 rounded-lg border bg-card px-ms-3 py-ms-2 text-ms-sm shadow-sm",
        className,
      )}
      aria-label="Ringkasan pesanan"
    >
      <div className="flex flex-wrap items-center gap-ms-2">
        <span className="inline-flex items-center gap-ms-1 rounded-md bg-muted px-1.5 py-0.5 text-ms-2xs font-medium text-muted-foreground">
          <Hash className="h-3 w-3" aria-hidden />
          {derived.orderLabel || "Chat"}
        </span>
        {derived.lifecycle ? <StatusBadge lifecycle={derived.lifecycle} /> : null}
        {payBadge}
      </div>

      <div className="mt-1.5 grid gap-0.5 text-ms-xs text-muted-foreground">
        {customerName ? (
          <div className="flex items-center gap-ms-1.5">
            <UserIcon className="h-3.5 w-3.5" aria-hidden />
            <span className="truncate">
              <span className="text-foreground">{customerName}</span>
              {customer.data?.contact ? ` · ${customer.data.contact}` : ""}
            </span>
          </div>
        ) : null}
        {productName || grams ? (
          <div className="flex items-center gap-ms-1.5">
            <Package className="h-3.5 w-3.5" aria-hidden />
            <span className="truncate">
              {productName ? (
                <span className="text-foreground">{productName}</span>
              ) : null}
              {grams != null ? ` · ${grams} g` : ""}
            </span>
          </div>
        ) : null}
        {typeof soldTotal === "number" ? (
          <div className="flex items-center gap-ms-1.5">
            <Wallet className="h-3.5 w-3.5" aria-hidden />
            <span className="truncate">
              Total Rp {soldTotal.toLocaleString("id-ID")}
              {sisa != null && sisa > 0 ? (
                <span className="text-amber-600 dark:text-amber-400">
                  {" "}
                  · Sisa Rp {sisa.toLocaleString("id-ID")}
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-ms-1.5">
        {links.linked_customer_id ? (
          <QuickLink
            to="/kontak"
            icon={<UserSquare className="h-3.5 w-3.5" aria-hidden />}
            label="Customer"
          />
        ) : null}
        {links.linked_request_prep_id || derived.scope === "request" ? (
          <QuickLink
            to="/request"
            icon={<ClipboardList className="h-3.5 w-3.5" aria-hidden />}
            label="Request Order"
          />
        ) : null}
        {links.linked_ecer_prep_id ? (
          <QuickLink
            to="/ecer"
            icon={<Package className="h-3.5 w-3.5" aria-hidden />}
            label="Ecer"
          />
        ) : null}
        {links.linked_task_id ? (
          <QuickLink
            to="/tugas"
            icon={<ClipboardList className="h-3.5 w-3.5" aria-hidden />}
            label="Tugas"
          />
        ) : null}
        {prepForPayment ? (
          <QuickLink
            to="/hutang-piutang"
            icon={<Wallet className="h-3.5 w-3.5" aria-hidden />}
            label="Pembayaran"
          />
        ) : null}
        <QuickLink
          to="/audit"
          icon={<HistoryIcon className="h-3.5 w-3.5" aria-hidden />}
          label="Riwayat"
        />
      </div>
    </section>
  );
}

function QuickLink({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-ms-1 rounded-full border bg-background px-ms-2 py-1 text-ms-2xs font-medium text-foreground hover:bg-muted"
    >
      {icon}
      {label}
    </Link>
  );
}