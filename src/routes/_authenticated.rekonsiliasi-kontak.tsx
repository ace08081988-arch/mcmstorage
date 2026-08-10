/**
 * Rekonsiliasi Kontak.
 *
 * Mendeteksi transaksi lama yang belum "match" ke record SSOT yang benar:
 * nama pihak terpecah karena ejaan berbeda (mis. "GIMEN" vs "Pak Gimen"),
 * nama yang belum punya record pelanggan/supplier, dan catatan yang sudah
 * pakai nama resmi tapi belum tertaut ke record-nya. Setiap temuan bisa
 * dipetakan ulang ke satu nama kanonik — nominal & pembayaran tidak diubah.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Link2, Users, AlertTriangle, RefreshCw, Check } from "lucide-react";
import { rupiah } from "@/lib/stock-format";
import {
  applyPartyMapping,
  createContactForParty,
  detectIssues,
  fetchReconcileData,
  ISSUE_HINT,
  ISSUE_LABEL,
  type ContactRecord,
  type ReconcileIssue,
} from "@/lib/party-reconcile";

export const Route = createFileRoute("/_authenticated/rekonsiliasi-kontak")({
  head: () => ({
    meta: [
      { title: "Rekonsiliasi Kontak · Ace Storage" },
      {
        name: "description",
        content:
          "Deteksi transaksi lama dengan nama pihak yang belum cocok, lalu petakan ulang ke record kontak SSOT yang benar.",
      },
      { property: "og:title", content: "Rekonsiliasi Kontak · Ace Storage" },
      {
        property: "og:description",
        content:
          "Satukan nama pihak yang terpecah dan tautkan catatan hutang ke record pelanggan/supplier yang benar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RekonsiliasiKontakPage,
});

const RECON_KEY = ["party-reconcile"] as const;

function RekonsiliasiKontakPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "variant" | "unregistered" | "unlinked">("all");
  const [q, setQ] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: RECON_KEY,
    queryFn: fetchReconcileData,
    staleTime: 30_000,
  });

  const issues = useMemo(() => (data ? detectIssues(data) : []), [data]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return issues.filter(
      (i) =>
        (filter === "all" || i.kind === filter) &&
        (!needle || i.buckets.some((b) => b.name.toLowerCase().includes(needle))),
    );
  }, [issues, filter, q]);

  const counts = useMemo(
    () => ({
      all: issues.length,
      variant: issues.filter((i) => i.kind === "variant").length,
      unregistered: issues.filter((i) => i.kind === "unregistered").length,
      unlinked: issues.filter((i) => i.kind === "unlinked").length,
    }),
    [issues],
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-ms-4 py-ms-4 sm:px-ms-6 sm:py-ms-6 space-ms-4 sm:space-ms-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Rekonsiliasi Kontak</h1>
        <p className="text-sm text-muted-foreground">
          Transaksi lama yang nama pihaknya belum cocok dengan record SSOT{" "}
          <code className="rounded bg-muted px-1">party_balance_v1</code>. Mapping hanya
          menyamakan nama & tautan kontak — nominal dan pembayaran tidak diubah.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <Link to="/hutang-piutang" className="underline underline-offset-2">
            Hutang &amp; Piutang
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link to="/audit-saldo" className="underline underline-offset-2">
            Audit Saldo
          </Link>
          <button
            type="button"
            onClick={() => void refetch()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium hover:bg-muted"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Periksa ulang
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {(["all", "variant", "unregistered", "unlinked"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              filter === k ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
            }`}
          >
            {k === "all" ? "Semua" : ISSUE_LABEL[k]} ({counts[k]})
          </button>
        ))}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cari nama pihak (mis. GIMEN)"
        className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
      />

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Memeriksa transaksi lama…
        </div>
      ) : error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Gagal memuat data: {(error as Error).message}
        </p>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Check className="mx-auto mb-2 h-6 w-6 text-success" />
          Tidak ada temuan pada filter ini — semua nama pihak sudah cocok.
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              contacts={data?.contacts ?? []}
              onDone={() => {
                void qc.invalidateQueries({ queryKey: RECON_KEY });
                // Saldo & audit membaca SSOT yang sama — segarkan semuanya.
                void qc.invalidateQueries({ queryKey: ["party-balance"] });
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueCard({
  issue,
  contacts,
  onDone,
}: {
  issue: ReconcileIssue;
  contacts: ContactRecord[];
  onDone: () => void;
}) {
  const [canonical, setCanonical] = useState(issue.suggested.name);
  const [contactId, setContactId] = useState(issue.contact?.id ?? "");
  const [picked, setPicked] = useState<string[]>(issue.buckets.map((b) => b.key));

  const contact =
    contacts.find((c) => c.id === contactId) ?? (issue.contact?.id === contactId ? issue.contact : null);

  const debtIds = useMemo(
    () => issue.buckets.filter((b) => picked.includes(b.key)).flatMap((b) => b.debtIds),
    [issue.buckets, picked],
  );

  const apply = useMutation({
    mutationFn: async () => {
      let target = contact;
      if (!target && contactId.startsWith("new:")) {
        target = await createContactForParty(
          canonical,
          contactId === "new:supplier" ? "supplier" : "customer",
        );
      }
      return applyPartyMapping({ debtIds, canonicalName: canonical, contact: target });
    },
    onSuccess: (res) => {
      toast.success("Mapping diterapkan", {
        description: `${res.updated} catatan kini memakai nama "${canonical.trim()}".`,
      });
      onDone();
    },
    onError: (e) =>
      toast.error("Mapping gagal", { description: (e as Error).message, duration: 8000 }),
  });

  const Icon =
    issue.kind === "variant" ? Users : issue.kind === "unregistered" ? AlertTriangle : Link2;

  return (
    <li className="space-y-3 rounded-xl border bg-card p-3.5">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {ISSUE_LABEL[issue.kind]} · {issue.suggested.name}
          </p>
          <p className="text-xs text-muted-foreground">{ISSUE_HINT[issue.kind]}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{rupiah(issue.total)}</span>
      </div>

      <ul className="space-y-1.5">
        {issue.buckets.map((b) => (
          <li key={b.key} className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2">
            <input
              type="checkbox"
              checked={picked.includes(b.key)}
              onChange={(e) =>
                setPicked((prev) =>
                  e.target.checked ? [...prev, b.key] : prev.filter((k) => k !== b.key),
                )
              }
              className="h-4 w-4 shrink-0"
              aria-label={`Ikutkan ${b.name}`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{b.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {b.count} catatan · {b.unlinked} belum tertaut
                {b.contact ? ` · kontak: ${b.contact.kind === "customer" ? "pelanggan" : "supplier"}` : ""}
              </p>
            </div>
            <span className="shrink-0 text-xs tabular-nums">{rupiah(b.total)}</span>
            <button
              type="button"
              onClick={() => setCanonical(b.name)}
              className="shrink-0 rounded-md border px-2 py-1 text-[11px] hover:bg-muted"
            >
              Jadikan acuan
            </button>
          </li>
        ))}
      </ul>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Nama kanonik</span>
          <input
            value={canonical}
            onChange={(e) => setCanonical(e.target.value)}
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Tautkan ke record</span>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="h-10 w-full rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">Tanpa tautan record</option>
            <option value="new:customer">+ Buat pelanggan baru dari nama kanonik</option>
            <option value="new:supplier">+ Buat supplier baru dari nama kanonik</option>
            {contacts.map((c) => (
              <option key={`${c.kind}-${c.id}`} value={c.id}>
                {c.name} ({c.kind === "customer" ? "pelanggan" : "supplier"})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={apply.isPending || debtIds.length === 0 || !canonical.trim()}
          onClick={() => apply.mutate()}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {apply.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Petakan {debtIds.length} catatan
        </button>
        <p className="text-[11px] text-muted-foreground">
          Nominal & pembayaran tidak berubah.
        </p>
      </div>
    </li>
  );
}
