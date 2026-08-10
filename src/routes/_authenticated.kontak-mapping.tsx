import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RefreshCw, UserPlus, Truck, CheckCircle2, Search, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useConversations } from "@/lib/chat";
import { normalizeParty } from "@/lib/chat-debt-sync";
import {
  findDuplicates,
  kindLabel,
  normalizeName,
  type DupMatch,
  type PartyCandidate,
} from "@/lib/contact-dup";
import { getCurrentUserId } from "@/lib/current-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { goBackOr } from "@/lib/back-nav";

export const Route = createFileRoute("/_authenticated/kontak-mapping")({
  head: () => ({
    meta: [
      { title: "Mapping Kontak Chat — Ace Storage" },
      {
        name: "description",
        content:
          "Daftar kontak chat yang belum terdaftar sebagai pelanggan atau supplier, lengkap dengan tombol mapping cepat.",
      },
      { property: "og:title", content: "Mapping Kontak Chat — Ace Storage" },
      {
        property: "og:description",
        content: "Petakan kontak chat menjadi pelanggan atau supplier dalam satu ketukan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KontakMappingPage,
});

type PartyRow = { id: string; name: string; contact?: string | null };

function usePartyDirectory() {
  return useQuery({
    queryKey: ["kontak-mapping", "parties"],
    staleTime: 30_000,
    queryFn: async () => {
      const [sup, cus, deb] = await Promise.all([
        supabase.from("suppliers").select("id,name,contact").limit(2000),
        supabase.from("customers").select("id,name,contact").limit(2000),
        supabase.from("debts").select("party_name").limit(2000),
      ]);
      const suppliers = (sup.data ?? []) as PartyRow[];
      const customers = (cus.data ?? []) as PartyRow[];
      const debtNames = ((deb.data ?? []) as { party_name: string }[]).map((d) => d.party_name);
      const supplierKeys = new Set(suppliers.map((s) => normalizeParty(s.name)));
      const customerKeys = new Set(customers.map((c) => normalizeParty(c.name)));
      const debtKeys = new Set(debtNames.map((n) => normalizeParty(n)));
      const candidates: PartyCandidate[] = [
        ...customers.map((c) => ({ id: c.id, name: c.name, contact: c.contact, kind: "customer" as const })),
        ...suppliers.map((s) => ({ id: s.id, name: s.name, contact: s.contact, kind: "supplier" as const })),
        ...Array.from(new Set(debtNames.filter(Boolean))).map((n) => ({
          id: `debt:${n}`,
          name: n,
          contact: null,
          kind: "debt" as const,
        })),
      ];
      return { supplierKeys, customerKeys, debtKeys, candidates };
    },
  });
}

function KontakMappingPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: conversations, isLoading: convLoading, refetch: refetchConv } = useConversations();
  const { data: dir, isLoading: dirLoading, refetch: refetchDir, isFetching } = usePartyDirectory();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Record<string, "customer" | "supplier">>({});
  const [confirm, setConfirm] = useState<{
    row: { id: string; title: string };
    kind: "customer" | "supplier";
    dups: DupMatch[];
  } | null>(null);

  const unmapped = useMemo(() => {
    if (!dir) return [];
    const seen = new Set<string>();
    const out: { id: string; title: string; key: string; last_at: string | null }[] = [];
    for (const c of conversations ?? []) {
      if (c.kind === "group") continue; // grup bukan kontak dagang tunggal
      const key = normalizeParty(c.display_title);
      if (!key || seen.has(key)) continue;
      if (dir.supplierKeys.has(key) || dir.customerKeys.has(key) || dir.debtKeys.has(key)) continue;
      seen.add(key);
      out.push({ id: c.id, title: c.display_title, key, last_at: c.last_at });
    }
    out.sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? ""));
    return out;
  }, [conversations, dir]);

  /** Kandidat duplikat per kontak (nama mirip / nomor sama). */
  const dupByRow = useMemo(() => {
    const m = new Map<string, DupMatch[]>();
    if (!dir) return m;
    for (const row of unmapped) {
      const dups = findDuplicates(row.title, dir.candidates);
      if (dups.length) m.set(row.id, dups);
    }
    return m;
  }, [unmapped, dir]);

  const filtered = useMemo(() => {
    const needle = normalizeParty(q);
    if (!needle) return unmapped;
    const loose = normalizeName(q);
    const digits = q.replace(/\D+/g, "");
    return unmapped.filter((u) => {
      if (u.key.includes(needle)) return true;
      if (loose && normalizeName(u.title).includes(loose)) return true;
      if (digits.length >= 3 && u.title.replace(/\D+/g, "").includes(digits)) return true;
      // cocokkan juga lewat nama kandidat mirip, agar "budi" menemukan "Pak Budi".
      return (dupByRow.get(u.id) ?? []).some((d) => normalizeName(d.candidate.name).includes(loose));
    });
  }, [unmapped, q, dupByRow]);

  const dupCount = useMemo(
    () => filtered.filter((r) => (dupByRow.get(r.id) ?? []).length > 0).length,
    [filtered, dupByRow],
  );

  const requestMap = (row: { id: string; title: string }, kind: "customer" | "supplier") => {
    const dups = dupByRow.get(row.id) ?? [];
    if (dups.length > 0) {
      setConfirm({ row, kind, dups });
      return;
    }
    void mapAs(row, kind);
  };

  const mapAs = async (row: { id: string; title: string }, kind: "customer" | "supplier") => {
    setBusy(`${row.id}:${kind}`);
    try {
      const uid = await getCurrentUserId();
      if (!uid) throw new Error("Sesi berakhir, silakan masuk lagi.");
      const table = kind === "customer" ? "customers" : "suppliers";
      const { error } = await supabase.from(table).insert({ user_id: uid, name: row.title.trim() });
      if (error) throw error;
      setDoneIds((p) => ({ ...p, [row.id]: kind }));
      toast.success(
        kind === "customer" ? `"${row.title}" jadi pelanggan` : `"${row.title}" jadi supplier`,
      );
      void qc.invalidateQueries({ queryKey: ["chat", "debt-sync"] });
      void refetchDir();
    } catch (err) {
      toast.error("Gagal memetakan kontak", {
        description: err instanceof Error ? err.message : "Coba lagi saat koneksi stabil.",
      });
    } finally {
      setBusy(null);
    }
  };

  const loading = convLoading || dirLoading;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="wa-header sticky top-0 z-10 flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full"
            aria-label="Kembali"
            onClick={() => goBackOr(router, { to: "/chat" })}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="truncate text-base font-semibold tracking-tight">Mapping kontak chat</h1>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          aria-label="Muat ulang"
          onClick={() => {
            void refetchConv();
            void refetchDir();
          }}
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <div className="flex-1 space-y-3 px-3 py-3">
        <p className="text-xs text-muted-foreground">
          Kontak chat berikut belum ada di daftar pelanggan/supplier maupun buku Hutang &amp; Piutang.
          Petakan sekali, lalu status sinkron di daftar chat ikut terbarui.
        </p>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama kontak…"
            className="pl-8 pr-8"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Hapus kata kunci"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat kontak…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
            {unmapped.length === 0 ? (
              <>
                Semua kontak chat sudah terpetakan.{" "}
                <Link to="/hutang-piutang" className="text-primary underline">
                  Buka Hutang &amp; Piutang
                </Link>
              </>
            ) : (
              <>Tidak ada kontak cocok dengan “{q}”.</>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {filtered.length} kontak belum terpetakan
              {q ? ` (dari ${unmapped.length})` : ""}
              {dupCount > 0 ? (
                <span className="ml-1 text-amber-500">· {dupCount} berpotensi duplikat</span>
              ) : null}
            </p>
            <ul className="divide-y rounded-lg border">
              {filtered.map((row) => {
                const done = doneIds[row.id];
                const dups = dupByRow.get(row.id) ?? [];
                return (
                  <li key={row.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{row.title}</span>
                      {dups.length > 0 ? (
                        <span className="mt-0.5 inline-flex items-start gap-1 text-[11px] leading-snug text-amber-500">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="truncate">
                            Mirip: {dups
                              .slice(0, 2)
                              .map((d) => `${d.candidate.name} (${kindLabel(d.candidate.kind)})`)
                              .join(", ")}
                            {dups.length > 2 ? ` +${dups.length - 2}` : ""}
                          </span>
                        </span>
                      ) : null}
                    </span>
                    {done ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-500">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {done === "customer" ? "Pelanggan" : "Supplier"}
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 px-2 text-xs"
                          disabled={busy !== null}
                          onClick={() => requestMap(row, "customer")}
                        >
                          {busy === `${row.id}:customer` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <UserPlus className="h-3.5 w-3.5" />
                          )}
                          Pelanggan
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 px-2 text-xs"
                          disabled={busy !== null}
                          onClick={() => requestMap(row, "supplier")}
                        >
                          {busy === `${row.id}:supplier` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Truck className="h-3.5 w-3.5" />
                          )}
                          Supplier
                        </Button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Kemungkinan kontak duplikat
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>
                  “{confirm?.row.title}” mirip dengan kontak yang sudah ada. Lanjutkan hanya jika
                  ini benar-benar orang/toko berbeda.
                </p>
                <ul className="space-y-1 rounded-md border p-2 text-xs">
                  {(confirm?.dups ?? []).map((d) => (
                    <li key={`${d.candidate.kind}:${d.candidate.id}`} className="flex justify-between gap-2">
                      <span className="truncate">{d.candidate.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {kindLabel(d.candidate.kind)} ·{" "}
                        {d.reason === "phone" ? "nomor sama" : `${Math.round(d.score * 100)}% mirip`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirm) return;
                const { row, kind } = confirm;
                setConfirm(null);
                void mapAs(row, kind);
              }}
            >
              Tetap petakan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
