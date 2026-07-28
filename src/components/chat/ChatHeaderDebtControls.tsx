import { useMemo, useState } from "react";
import { NumericTextField } from "@/components/NumericDraftInput";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Loader2, ArrowRight, Equal, Pencil, X, Search, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { rupiah } from "@/lib/stock-format";
import { assertDebtSource } from "@/lib/debt-source";
import { DebtChip, debtChipTone } from "@/components/chat/DebtChip";
import {
  debtSyncStatus,
  normalizeParty,
  useDebtSyncMap,
  usePartyLinks,
} from "@/lib/chat-debt-sync";

type Kind = "hutang" | "piutang";

type DebtRow = {
  id: string;
  kind: Kind;
  amount: number;
  party_name: string;
  supplier_id: string | null;
  customer_id: string | null;
  created_at: string;
};
type PaymentRow = {
  id: string;
  debt_id: string;
  amount: number;
  paid_at: string | null;
  note: string | null;
  created_at: string;
};

type HistoryEntry = {
  id: string;
  at: string;
  kind: Kind;
  type: "tagihan" | "pembayaran";
  amount: number;
  note: string | null;
};

/**
 * Panel kontrol hutang/piutang ringkas di header chat.
 *
 * - Cari kontak peer di daftar customers/suppliers (via account_user_id atau
 *   nomor telepon) milik pemilik akun (myId).
 * - Jika ditemukan minimal satu debt aktif, tampilkan chip saldo + kontrol
 *   [-] (catat pembayaran) & [+] (tambah tagihan) untuk masing2 kind.
 * - Semua tulisan sinkron langsung ke tabel debts/debt_payments MCM Storage.
 */
export function ChatHeaderDebtControls({
  myId,
  peerUserId,
  peerPhone,
  peerName,
}: {
  myId: string;
  peerUserId: string | null;
  peerPhone: string | null;
  peerName: string;
}) {
  const qc = useQueryClient();
  // Tautan manual nama chat → nama pihak di buku hutang/piutang, supaya
  // header memakai kontak yang sama dengan chip di daftar chat.
  const { data: partyLinks } = usePartyLinks();
  // SSOT saldo: sama persis dengan chip di daftar chat & halaman
  // Hutang & Piutang (debts + penjualan/pembelian hutang − pembayaran).
  const { data: debtSyncMap } = useDebtSyncMap();
  const ssot = debtSyncStatus(peerName, debtSyncMap, partyLinks);
  const ssotEntry = ssot.state === "unlinked" ? null : ssot.entry;
  const linkedPartyKey = partyLinks?.get(normalizeParty(peerName)) ?? null;
  const queryKey = [
    "chat-debts",
    myId,
    peerUserId ?? "",
    peerPhone ?? "",
    linkedPartyKey ?? "",
    normalizeParty(peerName),
  ];

  const debtsQ = useQuery({
    queryKey,
    queryFn: async () => {
      // 1) Cari customer & supplier milik myId yang cocok dengan peer.
      const phoneNorm = (peerPhone ?? "").replace(/\D+/g, "");
      const findParty = async (table: "customers" | "suppliers") => {
        let q = supabase
          .from(table)
          .select("id, name, contact, account_user_id")
          .eq("user_id", myId);
        // Prioritas: account_user_id sama.
        if (peerUserId) q = q.or(`account_user_id.eq.${peerUserId}`);
        const { data } = await q;
        const rows = (data ?? []) as Array<{
          id: string;
          name: string;
          contact: string | null;
          account_user_id: string | null;
        }>;
        const matches = rows.filter((r) => {
          if (peerUserId && r.account_user_id === peerUserId) return true;
          // Cocokkan juga lewat nama: persis, atau lewat tautan manual
          // (mis. chat "PANGAT" ditautkan ke catatan "PWNGAT").
          const rowKey = normalizeParty(r.name);
          if (rowKey && (rowKey === normalizeParty(peerName) || rowKey === linkedPartyKey)) {
            return true;
          }
          if (phoneNorm) {
            const c = (r.contact ?? "").replace(/\D+/g, "");
            if (c && (c === phoneNorm || c.endsWith(phoneNorm) || phoneNorm.endsWith(c))) {
              return true;
            }
          }
          return false;
        });
        return matches;
      };
      const [customers, suppliers] = await Promise.all([
        findParty("customers"),
        findParty("suppliers"),
      ]);
      const customerIds = customers.map((c) => c.id);
      const supplierIds = suppliers.map((s) => s.id);
      if (customerIds.length === 0 && supplierIds.length === 0) {
        return {
          debts: [] as DebtRow[],
          payments: [] as PaymentRow[],
          customers,
          suppliers,
        };
      }
      // 2) Ambil semua debts terkait milik myId.
      const orParts: string[] = [];
      if (customerIds.length) orParts.push(`customer_id.in.(${customerIds.join(",")})`);
      if (supplierIds.length) orParts.push(`supplier_id.in.(${supplierIds.join(",")})`);
      const { data: debts } = await supabase
        .from("debts")
        .select("id, kind, amount, party_name, supplier_id, customer_id, created_at")
        .eq("user_id", myId)
        .or(orParts.join(","));
      const debtRows = ((debts ?? []) as DebtRow[]).filter(
        (d) => d.kind === "hutang" || d.kind === "piutang",
      );
      let payments: PaymentRow[] = [];
      if (debtRows.length > 0) {
        const { data: pays } = await supabase
          .from("debt_payments")
          .select("id, debt_id, amount, paid_at, note, created_at")
          .in("debt_id", debtRows.map((d) => d.id));
        payments = (pays ?? []) as PaymentRow[];
      }
      return { debts: debtRows, payments, customers, suppliers };
    },
    enabled: !!myId && (!!peerUserId || !!peerPhone),
    staleTime: 15_000,
  });

  const summary = useMemo(() => {
    const d = debtsQ.data;
    if (!d) return null;
    const paidByDebt = new Map<string, number>();
    for (const p of d.payments) {
      paidByDebt.set(p.debt_id, (paidByDebt.get(p.debt_id) ?? 0) + Number(p.amount));
    }
    let hutang = 0;
    let piutang = 0;
    for (const row of d.debts) {
      const sisa = Math.max(0, Number(row.amount) - (paidByDebt.get(row.id) ?? 0));
      if (row.kind === "hutang") hutang += sisa;
      else piutang += sisa;
    }
    return {
      hutang,
      piutang,
      hasAny: d.debts.length > 0,
      debts: d.debts,
      paidByDebt,
      customerId: d.customers[0]?.id ?? null,
      customerName: d.customers[0]?.name ?? null,
      supplierId: d.suppliers[0]?.id ?? null,
      supplierName: d.suppliers[0]?.name ?? null,
    };
  }, [debtsQ.data]);

  // Chip selalu tampil agar konsisten di semua percakapan & lokasi kartu.
  // Angka yang ditampilkan WAJIB dari SSOT bila kontak dikenali, supaya
  // header tidak pernah beda dengan daftar chat / halaman hutang piutang.
  const linked = !!ssotEntry || (!!summary && summary.hasAny);
  const hutang = ssotEntry ? ssotEntry.hutang : (summary?.hutang ?? 0);
  const piutang = ssotEntry ? ssotEntry.piutang : (summary?.piutang ?? 0);
  const safeSummary = summary ?? {
    debts: [] as DebtRow[],
    paidByDebt: new Map<string, number>(),
    customerId: null,
    customerName: null,
    supplierId: null,
    supplierName: null,
  };
  const tone = debtChipTone(hutang, piutang, linked);
  const dominantValue = tone === "hutang" ? hutang : piutang;

  // Peringatan selisih: bandingkan angka SSOT (dipakai chip & daftar chat)
  // dengan angka hasil hitung lokal dari catatan manual (tabel debts).
  const mismatch = useMemo(() => {
    if (!ssotEntry || !summary) return null;
    const dh = Math.round(ssotEntry.hutang - summary.hutang);
    const dp = Math.round(ssotEntry.piutang - summary.piutang);
    if (Math.abs(dh) < 1 && Math.abs(dp) < 1) return null;
    return { dh, dp };
  }, [ssotEntry, summary]);

  // Riwayat perubahan: gabungan entri tagihan (debts) & pembayaran
  // (debt_payments) untuk peer ini, terbaru di atas.
  const history = useMemo<HistoryEntry[]>(() => {
    const d = debtsQ.data;
    if (!d) return [];
    const kindByDebt = new Map(d.debts.map((x) => [x.id, x.kind]));
    const items: HistoryEntry[] = [
      ...d.debts.map((x) => ({
        id: `d-${x.id}`,
        at: x.created_at,
        kind: x.kind,
        type: "tagihan" as const,
        amount: Number(x.amount),
        note: null,
      })),
      ...d.payments.map((p) => ({
        id: `p-${p.id}`,
        at: p.created_at ?? `${p.paid_at ?? ""}T00:00:00Z`,
        kind: (kindByDebt.get(p.debt_id) ?? "piutang") as Kind,
        type: "pembayaran" as const,
        amount: Number(p.amount),
        note: p.note,
      })),
    ];
    return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [debtsQ.data]);

  const [historyQuery, setHistoryQuery] = useState("");
  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => {
      const amount = String(h.amount);
      const note = (h.note ?? "").toLowerCase();
      const type = (h.type === "tagihan" ? "tagihan" : "pembayaran").toLowerCase();
      const kind = (h.kind === "hutang" ? "hutang" : "piutang").toLowerCase();
      return (
        amount.includes(q) ||
        rupiah(h.amount).toLowerCase().includes(q) ||
        note.includes(q) ||
        type.includes(q) ||
        kind.includes(q)
      );
    });
  }, [history, historyQuery]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <DebtChip
          tone={tone}
          amount={dominantValue}
          aria-label={
            tone === "empty"
              ? `Belum ada catatan hutang/piutang dengan ${peerName}`
              : tone === "settled"
                ? `Catatan dengan ${peerName} lunas`
                : tone === "piutang"
                  ? `Piutang dari ${peerName}: ${rupiah(dominantValue)}`
                  : `Hutang kepada ${peerName}: ${rupiah(dominantValue)}`
          }
          title={
            tone === "empty"
              ? "Belum ada catatan — ketuk untuk mencatat hutang/piutang"
              : tone === "settled"
                ? "Tidak ada sisa hutang/piutang"
                : tone === "piutang"
                  ? `Piutang (dia berhutang ke Anda): ${rupiah(dominantValue)}`
                  : `Hutang (Anda berhutang ke dia): ${rupiah(dominantValue)}`
          }
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-ms-3">
        <div className="mb-2 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tagihan dengan {peerName}
        </div>
        {mismatch && (
          <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-ms-2xs text-destructive">
            <div className="flex items-center gap-1 font-semibold">
              <AlertTriangle className="size-3.5" />
              Angka tidak sinkron
            </div>
            <div className="mt-1 space-y-0.5 text-foreground/80">
              {Math.abs(mismatch.dp) >= 1 && (
                <div>
                  Piutang: SSOT {rupiah(ssotEntry!.piutang)} vs catatan manual {rupiah(summary!.piutang)}
                  {" "}(selisih {rupiah(Math.abs(mismatch.dp))})
                </div>
              )}
              {Math.abs(mismatch.dh) >= 1 && (
                <div>
                  Hutang: SSOT {rupiah(ssotEntry!.hutang)} vs catatan manual {rupiah(summary!.hutang)}
                  {" "}(selisih {rupiah(Math.abs(mismatch.dh))})
                </div>
              )}
              <div className="text-muted-foreground">
                Selisih biasanya berasal dari penjualan berstatus hutang yang belum masuk catatan manual.
              </div>
            </div>
          </div>
        )}
        <div className="space-ms-2">
          <KindRow
            label="Piutang (dia berhutang)"
            balance={piutang}
            kind="piutang"
            onSubmit={(delta) =>
              applyDelta({
                delta,
                kind: "piutang",
                summary: safeSummary,
                myId,
                peerName,
                onDone: () => qc.invalidateQueries({ queryKey }),
              })
            }
          />
          <KindRow
            label="Hutang (Anda berhutang)"
            balance={hutang}
            kind="hutang"
            onSubmit={(delta) =>
              applyDelta({
                delta,
                kind: "hutang",
                summary: safeSummary,
                myId,
                peerName,
                onDone: () => qc.invalidateQueries({ queryKey }),
              })
            }
          />
        </div>
        <p className="mt-3 text-ms-2xs leading-snug text-muted-foreground">
          <ArrowRight className="mr-1 inline h-2.5 w-2.5" />
          Tersinkron langsung ke Hutang & Piutang MCM Storage.
        </p>
        <div className="mt-3 border-t pt-2">
          <div className="mb-1.5 flex items-center justify-between gap-ms-2">
            <span className="text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Riwayat perubahan
            </span>
            {!debtsQ.isLoading && history.length > 0 && (
              <span className="text-ms-2xs text-muted-foreground">
                {filteredHistory.length}/{history.length}
              </span>
            )}
          </div>
          {!debtsQ.isLoading && history.length > 0 && (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Cari nominal, catatan, jenis…"
                className="h-8 pl-7 pr-7 text-ms-xs"
              />
              {historyQuery && (
                <button
                  type="button"
                  onClick={() => setHistoryQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Hapus kata kunci"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {debtsQ.isLoading ? (
            <div className="flex items-center gap-ms-1.5 text-ms-2xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Memuat…
            </div>
          ) : history.length === 0 ? (
            <p className="text-ms-2xs text-muted-foreground">
              Belum ada perubahan tercatat.
            </p>
          ) : filteredHistory.length === 0 ? (
            <p className="text-ms-2xs text-muted-foreground">
              Tidak ada riwayat cocok dengan “{historyQuery}”.
            </p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
              {filteredHistory.slice(0, 30).map((h) => (
                <li
                  key={h.id}
                  className="flex items-start justify-between gap-ms-2 rounded-md bg-muted/40 px-2 py-1"
                >
                  <div className="min-w-0">
                    <div className="text-ms-2xs font-medium">
                      {highlight(
                        h.type === "tagihan" ? "Tambah tagihan" : "Pembayaran",
                        historyQuery,
                      )}
                      <span className="ml-1 font-normal text-muted-foreground">
                        {highlight(
                          h.kind === "hutang" ? "hutang" : "piutang",
                          historyQuery,
                        )}
                      </span>
                    </div>
                    <div className="truncate text-ms-2xs text-muted-foreground">
                      {formatWhen(h.at)}
                      {h.note ? (
                        <span>
                          {" · "}
                          {highlight(h.note, historyQuery)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 font-mono text-ms-2xs font-semibold ${
                      h.type === "tagihan" ? "text-warning" : "text-success"
                    }`}
                  >
                    {h.type === "tagihan" ? "+" : "−"}
                    {rupiah(h.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function highlight(text: string, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-primary/20 px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function KindRow({
  label,
  balance,
  kind,
  onSubmit,
}: {
  label: string;
  balance: number;
  kind: Kind;
  onSubmit: (delta: number) => Promise<void>;
}) {
  const [raw, setRaw] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState(false);
  const [target, setTarget] = useState<string>("");
  const parsed = Number(raw.replace(/\D+/g, ""));
  const hasAmount = Number.isFinite(parsed) && parsed > 0;
  const targetParsed = Number(target.replace(/\D+/g, ""));
  const hasTarget = target.trim() !== "" && Number.isFinite(targetParsed);
  const delta = hasTarget ? targetParsed - balance : 0;

  const submit = async (sign: 1 | -1) => {
    if (!hasAmount) {
      toast.error("Isi jumlah dulu.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(sign * parsed);
      setRaw("");
    } finally {
      setBusy(false);
    }
  };

  const submitTarget = async () => {
    if (!hasTarget) {
      toast.error("Isi nominal baru dulu.");
      return;
    }
    if (delta === 0) {
      toast.info("Nominal sudah sama.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(delta);
      setTarget("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border p-ms-2">
      <div className="mb-1.5 flex items-center justify-between gap-ms-2 text-ms-2xs">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center gap-ms-1.5">
          <span
            className={`font-mono font-semibold ${
              kind === "piutang"
                ? "text-success dark:text-success"
                : "text-warning dark:text-warning"
            }`}
          >
            {rupiah(balance)}
          </span>
          <button
            type="button"
            onClick={() => {
              setQuick((v) => !v);
              setTarget(quick ? "" : String(balance));
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={quick ? "Tutup edit cepat" : "Edit cepat nominal"}
            title={quick ? "Tutup edit cepat" : "Edit cepat nominal"}
          >
            {quick ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
          </button>
        </div>
      </div>
      {quick ? (
        <div className="mb-1.5 rounded-md bg-muted/50 p-ms-1.5">
          <div className="flex items-center gap-ms-1.5">
            <NumericTextField
              value={target}
              onValueChange={setTarget}
              decimal={false}
              placeholder="Nominal baru"
              className="flex h-8 flex-1 rounded-md border border-input bg-background px-3 py-2 text-right font-mono text-ms-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
            />
            <Button
              type="button"
              size="icon"
              className="h-8 w-8 shrink-0"
              disabled={busy || !hasTarget || delta === 0}
              onClick={submitTarget}
              aria-label="Simpan nominal baru"
              title="Simpan nominal baru"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Equal className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="mt-1 text-ms-2xs leading-snug text-muted-foreground">
            {hasTarget && delta !== 0
              ? delta > 0
                ? `Tambah tagihan ${rupiah(delta)}`
                : `Catat pembayaran ${rupiah(Math.abs(delta))}`
              : "Isi saldo akhir yang benar — selisihnya dicatat otomatis."}
          </p>
        </div>
      ) : null}
      <div className="flex items-center gap-ms-1.5">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          disabled={busy || balance <= 0 || !hasAmount}
          onClick={() => submit(-1)}
          aria-label="Kurangi (catat pembayaran)"
          title="Catat pembayaran"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Minus className="h-3.5 w-3.5" />}
        </Button>
        <NumericTextField
          value={raw}
          onValueChange={setRaw}
          decimal={false}
          placeholder="0"
          className="flex h-8 flex-1 rounded-md border border-input bg-background px-3 py-2 text-right font-mono text-ms-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          disabled={busy || !hasAmount}
          onClick={() => submit(1)}
          aria-label="Tambah tagihan"
          title="Tambah tagihan"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

async function applyDelta({
  delta,
  kind,
  summary,
  myId,
  peerName,
  onDone,
}: {
  delta: number;
  kind: Kind;
  summary: {
    debts: DebtRow[];
    paidByDebt: Map<string, number>;
    customerId: string | null;
    customerName: string | null;
    supplierId: string | null;
    supplierName: string | null;
  };
  myId: string;
  peerName: string;
  onDone: () => void;
}) {
  try {
    if (delta > 0) {
      // Tambah tagihan → insert baris debts baru.
      const partyId =
        kind === "hutang" ? summary.supplierId : summary.customerId;
      const partyName =
        (kind === "hutang" ? summary.supplierName : summary.customerName) ??
        peerName;
      if (!partyId) {
        toast.error(
          kind === "hutang"
            ? "Peer belum terdaftar sebagai supplier."
            : "Peer belum terdaftar sebagai pelanggan.",
        );
        return;
      }
      const insert: {
        user_id: string;
        kind: Kind;
        party_name: string;
        amount: number;
        source: string;
        supplier_id?: string;
        customer_id?: string;
      } = {
        user_id: myId,
        kind,
        party_name: partyName,
        amount: delta,
        // Sumber "manual" — satu-satunya nilai valid untuk entri dari UI chat
        // menurut constraint `debts_source_check`. Jangan ubah tanpa
        // memperluas allowlist di `src/lib/debt-source.ts` DAN migrasi
        // constraint database.
        source: assertDebtSource("manual"),
      };
      if (kind === "hutang") insert.supplier_id = partyId;
      else insert.customer_id = partyId;
      const { error } = await supabase.from("debts").insert(insert);
      if (error) throw error;
      toast.success(
        `${kind === "hutang" ? "Hutang" : "Piutang"} baru ${rupiah(delta)} dicatat.`,
      );
    } else {
      // Catat pembayaran → alokasi terhadap debts terlama yang masih bersaldo.
      const remaining = Math.abs(delta);
      const openDebts = summary.debts
        .filter((d) => d.kind === kind)
        .map((d) => ({
          id: d.id,
          sisa: Math.max(0, Number(d.amount) - (summary.paidByDebt.get(d.id) ?? 0)),
        }))
        .filter((d) => d.sisa > 0)
        .sort((a, b) => a.sisa - b.sisa === 0 ? 0 : 0); // urutan apa adanya (created_at desc dari query)
      let left = remaining;
      const rows: Array<{
        user_id: string;
        debt_id: string;
        amount: number;
        paid_at: string;
        note: string;
      }> = [];
      const today = new Date().toISOString().slice(0, 10);
      for (const d of openDebts) {
        if (left <= 0) break;
        const take = Math.min(left, d.sisa);
        rows.push({
          user_id: myId,
          debt_id: d.id,
          amount: take,
          paid_at: today,
          note: "Dicatat dari chat",
        });
        left -= take;
      }
      if (rows.length === 0) {
        toast.error("Tidak ada saldo untuk dibayar.");
        return;
      }
      const { error } = await supabase.from("debt_payments").insert(rows);
      if (error) throw error;
      const applied = remaining - left;
      toast.success(
        `Pembayaran ${rupiah(applied)} dicatat${left > 0 ? ` (sisa input ${rupiah(left)} tidak dipakai).` : "."}`,
      );
    }
    onDone();
  } catch (e) {
    toast.error(
      (e as { message?: string })?.message ?? "Gagal menyimpan perubahan.",
    );
  }
}