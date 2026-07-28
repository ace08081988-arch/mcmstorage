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
    </div>
  );
}