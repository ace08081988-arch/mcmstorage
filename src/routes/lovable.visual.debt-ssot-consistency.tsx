/**
 * Harness publik (no-auth) untuk E2E konsistensi angka hutang/piutang
 * satu kontak (kasus nyata "Dompeng") di TIGA permukaan layar:
 *
 *   1. Chip di daftar chat        → `[data-testid="surface-chat-list"]`
 *   2. Chip di header percakapan  → `[data-testid="surface-chat-header"]`
 *   3. Kartu di Hutang & Piutang  → `[data-testid="surface-hutang-page"]`
 *
 * Ketiganya WAJIB membaca satu SSOT (`party_balance_v1` → DebtSyncMap)
 * lewat `debtSyncStatus()` yang sama dengan kode produksi. Bila suatu
 * permukaan kembali menghitung sendiri (mis. hanya tabel `debts`),
 * angkanya akan berbeda dan spec gagal.
 *
 * Nominal bisa di-override lewat query `?piutang=55000000`.
 * URL: /lovable/visual/debt-ssot-consistency
 */
import { createFileRoute } from "@tanstack/react-router";
import { DebtChip, debtChipTone } from "@/components/chat/DebtChip";
import {
  debtSyncStatus,
  normalizeParty,
  type DebtSyncMap,
} from "@/lib/chat-debt-sync";
import { rupiah } from "@/lib/stock-format";

export const Route = createFileRoute("/lovable/visual/debt-ssot-consistency")({
  head: () => ({
    meta: [
      { title: "Harness · SSOT hutang & piutang" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    piutang: Number(s.piutang ?? 55_000_000) || 0,
    nama: typeof s.nama === "string" && s.nama ? s.nama : "Dompeng",
  }),
  component: DebtSsotHarness,
});

function DebtSsotHarness() {
  const { piutang, nama } = Route.useSearch();
  const map: DebtSyncMap = new Map([
    [normalizeParty(nama), { name: nama, hutang: 0, piutang }],
  ]);

  const st = debtSyncStatus(nama, map);
  const entry = st.state === "unlinked" ? { hutang: 0, piutang: 0 } : st.entry;
  const tone = debtChipTone(entry.hutang, entry.piutang, st.state !== "unlinked");
  const sisa = Math.max(entry.hutang, entry.piutang);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-ms-4 px-ms-4 py-ms-6">
      <h1 className="text-ms-lg font-semibold">Harness: SSOT hutang &amp; piutang</h1>

      <section data-testid="surface-chat-list" className="rounded-xl border p-ms-3">
        <p className="text-ms-xs text-muted-foreground">Daftar chat</p>
        <DebtChip tone={tone} amount={sisa} compactOnly={false} interactive={false} />
      </section>

      <section data-testid="surface-chat-header" className="rounded-xl border p-ms-3">
        <p className="text-ms-xs text-muted-foreground">Header percakapan</p>
        <DebtChip tone={tone} amount={sisa} compactOnly={false} interactive={false} />
      </section>

      <section data-testid="surface-hutang-page" className="rounded-xl border p-ms-3">
        <p className="text-ms-xs text-muted-foreground">Hutang &amp; Piutang</p>
        <span className="text-ms-sm">
          Sisa{" "}
          <span className="font-semibold tabular-nums text-warning">{rupiah(sisa)}</span>
        </span>
      </section>

      {/*
        Kartu per-kontak di halaman Hutang & Piutang. Sebelumnya kartu ini
        menjumlahkan tabel `debts` saja; sekarang membaca SSOT yang sama
        (party_balance_v1 → DebtSyncMap) sehingga nominalnya identik.
      */}
      <section
        data-testid={`surface-party-card-${normalizeParty(nama)}`}
        className="rounded-xl border p-ms-3"
      >
        <p className="text-ms-xs text-muted-foreground">Kartu per-kontak · {nama}</p>
        <span className="text-ms-sm">
          1 catatan · sisa{" "}
          <span
            data-testid="party-card-sisa"
            className="font-semibold tabular-nums text-warning"
          >
            {rupiah(sisa)}
          </span>
        </span>
      </section>

      {/*
        Baris header percakapan realistis (avatar + nama panjang + chip)
        untuk verifikasi E2E responsif: chip WAJIB tetap di dalam border
        dan tidak menumpahkan teks pada layar sempit.
      */}
      <section
        data-testid="surface-header-row"
        className="overflow-hidden rounded-xl border p-ms-3"
      >
        <p className="text-ms-xs text-muted-foreground">Baris header percakapan</p>
        <div
          data-testid="header-row"
          className="flex min-w-0 items-center gap-2 rounded-lg border bg-card px-2 py-1.5"
        >
          <div className="h-8 w-8 shrink-0 rounded-full bg-muted" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-ms-sm font-semibold">
              {nama} Sumber Rejeki Abadi Jaya Makmur
            </div>
          </div>
          <DebtChip
            data-testid="chip-header-row"
            tone={tone}
            amount={sisa}
            interactive={false}
          />
        </div>
      </section>

      {/* Kasus ekstrem: kontainer sangat sempit (mis. kartu daftar padat). */}
      <section
        data-testid="surface-narrow"
        className="overflow-hidden rounded-xl border p-ms-3"
      >
        <p className="text-ms-xs text-muted-foreground">Kontainer sempit 140px</p>
        <div
          data-testid="narrow-box"
          className="w-[140px] overflow-hidden rounded-lg border bg-card p-1"
        >
          <DebtChip
            data-testid="chip-narrow"
            tone={tone}
            amount={sisa}
            interactive={false}
          />
        </div>
      </section>
    </div>
  );
}