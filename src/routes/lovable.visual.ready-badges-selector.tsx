/**
 * Harness publik (no-auth) untuk e2e konsistensi badge Aktif/Terkirim.
 *
 * Merender dua "surface" (Request + Ecer) yang meniru cara
 * `ReadyRequestSection` / `ReadyEcerSection` menghitung angka badge:
 * SATU-SATUNYA sumber adalah `countActiveByTitle` + `filterSentPreps`
 * dari `@/lib/prep-active-selector`. Tidak ada network — data ada di
 * state React lokal supaya spec Playwright bisa memicu transisi
 * Tandai/Batalkan Terkirim tanpa Supabase.
 *
 * Marker DOM untuk spec (stabil, jangan diubah tanpa memperbarui spec):
 *   [data-testid="badge-active-request-<titleId>"]  → angka Aktif
 *   [data-testid="badge-sent-request-<titleId>"]    → angka Terkirim
 *   [data-testid="badge-active-ecer-<titleId>"]     → angka Aktif
 *   [data-testid="badge-sent-ecer-<titleId>"]       → angka Terkirim
 *   [data-testid="mark-sent-<prepId>"]              → tombol Tandai
 *   [data-testid="cancel-sent-<prepId>"]            → tombol Batalkan
 *   [data-oracle="preps"]                           → JSON preps saat ini
 *
 * Invariant yang di-e2e-kan: setelah tiap klik Tandai/Batalkan Terkirim,
 * angka pada tiap badge di kedua surface WAJIB sama dengan output helper
 * selector yang dihitung ulang di sisi spec dari `data-oracle`.
 *
 * URL: /lovable/visual/ready-badges-selector (noindex, no-auth).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  countActiveByTitle,
  filterSentPreps,
  isActivePrep,
  isSentPrep,
} from "@/lib/prep-active-selector";

export const Route = createFileRoute(
  "/lovable/visual/ready-badges-selector",
)({
  head: () => ({
    meta: [
      { title: "Harness · Ready badges selector" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Harness,
});

type Title = { id: string; name: string };
type Prep = {
  id: string;
  title_id: string;
  sold_at: string | null;
  paid_amount?: number | null;
  customer?: string;
};

// Total tagihan tetap per prep di harness (Rp). Dipakai untuk validasi
// pembayaran "Sebagian": nominal harus > 0 dan < TOTAL_PER_PREP.
const TOTAL_PER_PREP = 10_000;

const REQUEST_TITLES: Title[] = [
  { id: "r-A", name: "Paket Alpha" },
  { id: "r-B", name: "Paket Beta" },
  { id: "r-C", name: "Paket Gamma" },
];
const ECER_TITLES: Title[] = [
  { id: "e-X", name: "Kotak X" },
  { id: "e-Y", name: "Kotak Y" },
];

// Seed: campuran aktif & terkirim supaya angka awal ≠ 0 di semua badge yang
// diuji. Spec akan menoggle status lalu memverifikasi konsistensi ulang.
const SEED_REQUEST: Prep[] = [
  { id: "rp1", title_id: "r-A", sold_at: null, customer: "Budi Santoso" },
  { id: "rp2", title_id: "r-A", sold_at: null, customer: "Citra Dewi" },
  { id: "rp3", title_id: "r-A", sold_at: "2026-07-01T00:00:00Z", customer: "Andi" },
  { id: "rp4", title_id: "r-B", sold_at: null, customer: "Dewi" },
  { id: "rp5", title_id: "r-B", sold_at: "2026-07-02T00:00:00Z", customer: "Eka" },
  { id: "rp6", title_id: "r-B", sold_at: "2026-07-03T00:00:00Z", customer: "Fajar" },
  // r-C sengaja tanpa prep — badge harus 0/0.
];
const SEED_ECER: Prep[] = [
  { id: "ep1", title_id: "e-X", sold_at: null, customer: "Ibu Sari" },
  { id: "ep2", title_id: "e-X", sold_at: null, customer: "Pak Joko" },
  { id: "ep3", title_id: "e-X", sold_at: "2026-07-01T00:00:00Z", customer: "Rina" },
  { id: "ep4", title_id: "e-Y", sold_at: null, customer: "Tuti" },
  { id: "ep5", title_id: "e-Y", sold_at: "2026-07-02T00:00:00Z", customer: "Wati" },
];

// Formatter WA message — SSOT untuk isi pesan yang "dikirim" ke pelanggan.
// Spec E2E membaca hasilnya dari DOM (`data-testid="last-wa-message-<scope>"`)
// dan memverifikasi bahwa ringkasan pelanggan, total, dan jenis pembayaran
// yang tampil di dialog konfirmasi tercermin di pesan yang dikirim.
function formatWaMessage(input: {
  customer: string;
  titleName: string;
  total: number;
  method: "kas" | "hutang" | "partial";
  partialAmount: number | null;
  note: string;
}): string {
  const rp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
  const methodLabel =
    input.method === "kas"
      ? "Lunas"
      : input.method === "hutang"
        ? "Hutang"
        : "Bayar sebagian";
  const lines = [
    `Halo ${input.customer},`,
    `Paket: ${input.titleName}`,
    `Total: ${rp(input.total)}`,
    `Pembayaran: ${methodLabel}`,
  ];
  if (input.method === "partial" && input.partialAmount !== null) {
    lines.push(`Dibayar: ${rp(input.partialAmount)}`);
    lines.push(`Sisa: ${rp(input.total - input.partialAmount)}`);
  }
  const trimmedNote = input.note.trim();
  if (trimmedNote) {
    lines.push(`Catatan: ${trimmedNote}`);
  }
  lines.push("Terima kasih.");
  return lines.join("\n");
}

function useSurface(seed: Prep[]) {
  const [preps, setPreps] = useState<Prep[]>(seed);

  const activeByTitle = useMemo(() => countActiveByTitle(preps), [preps]);
  const sentByTitle = useMemo(() => {
    // SSOT untuk "sent" — jangan tulis literal predikat sold_at di luar helper.
    const m = new Map<string, number>();
    for (const p of filterSentPreps(preps)) {
      if (!p.title_id) continue;
      m.set(p.title_id, (m.get(p.title_id) ?? 0) + 1);
    }
    return m;
  }, [preps]);

  function markSent(id: string) {
    setPreps((prev) =>
      prev.map((p) =>
        p.id === id && isActivePrep(p)
          ? { ...p, sold_at: new Date().toISOString() }
          : p,
      ),
    );
  }
  function cancelSent(id: string) {
    setPreps((prev) =>
      prev.map((p) => (p.id === id ? { ...p, sold_at: null } : p)),
    );
  }

  return { preps, activeByTitle, sentByTitle, markSent, cancelSent, setPreps };
}

function Surface({
  scope,
  titles,
  seed,
}: {
  scope: "request" | "ecer";
  titles: Title[];
  seed: Prep[];
}) {
  const { preps, activeByTitle, sentByTitle, markSent, cancelSent, setPreps } =
    useSurface(seed);

  // Simulasi dialog konfirmasi pembayaran (Lunas/Hutang/Partial) + tombol
  // "Kirim WA". Setelah "Kirim WA" ditekan → sold_at diisi via setPreps
  // seketika (tanpa reload) supaya spec dapat memverifikasi badge menyegar
  // & item pindah ke section "Riwayat Terkirim" pada render yang sama.
  const [payment, setPayment] = useState<null | {
    prepId: string;
    method: "kas" | "hutang" | "partial";
    partialAmount: string;
    note: string;
  }>(null);

  // Pesan WA terakhir yang "dikirim" dari surface ini. Spec E2E membaca
  // string mentahnya dari `data-testid="last-wa-message-<scope>"` untuk
  // memverifikasi ringkasan pelanggan, total, dan jenis pembayaran.
  const [lastWa, setLastWa] = useState<string>("");

  const paymentPrep = payment
    ? preps.find((p) => p.id === payment.prepId) ?? null
    : null;
  const paymentTitle = paymentPrep
    ? titles.find((t) => t.id === paymentPrep.title_id) ?? null
    : null;
  const paymentCustomer = paymentPrep?.customer ?? "Pelanggan";
  const paymentTitleName = paymentTitle?.name ?? paymentPrep?.title_id ?? "-";

  const partialAmountNum = payment ? Number(payment.partialAmount) : NaN;
  const partialValid =
    payment?.method !== "partial" ||
    (Number.isFinite(partialAmountNum) &&
      partialAmountNum > 0 &&
      partialAmountNum < TOTAL_PER_PREP);
  const partialSisa =
    payment?.method === "partial" && Number.isFinite(partialAmountNum)
      ? TOTAL_PER_PREP - partialAmountNum
      : null;

  const active = preps.filter((p) => isActivePrep(p));
  const sent = preps.filter((p) => isSentPrep(p));

  return (
    <section
      className="space-y-2 rounded-md border bg-card p-2"
      data-surface={scope}
    >
      <h2 className="text-sm font-semibold capitalize">{scope}</h2>

      <div className="grid grid-cols-1 gap-1">
        {titles.map((t) => {
          const active = activeByTitle.get(t.id) ?? 0;
          const sent = sentByTitle.get(t.id) ?? 0;
          return (
            <div
              key={t.id}
              className="flex items-center justify-between rounded border px-2 py-1 text-xs"
              data-title-row={t.id}
            >
              <span className="truncate font-medium">{t.name}</span>
              <span className="flex items-center gap-1 tabular-nums">
                <span
                  data-testid={`badge-active-${scope}-${t.id}`}
                  className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300"
                >
                  {active}
                </span>
                <span
                  data-testid={`badge-sent-${scope}-${t.id}`}
                  className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300"
                >
                  {sent}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 space-y-1">
        {preps.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px]"
            data-prep-row={p.id}
          >
            <span className="font-mono text-muted-foreground">
              {p.id} · {p.title_id} · {isSentPrep(p) ? "sent" : "active"}
            </span>
            <span className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-1.5 text-[10px]"
                data-testid={`mark-sent-${p.id}`}
                disabled={isSentPrep(p)}
                onClick={() => markSent(p.id)}
              >
                Tandai
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-1.5 text-[10px]"
                data-testid={`cancel-sent-${p.id}`}
                disabled={!isSentPrep(p)}
                onClick={() => cancelSent(p.id)}
              >
                Batalkan
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-1.5 text-[10px]"
                data-testid={`send-wa-${p.id}`}
                disabled={isSentPrep(p)}
                onClick={() =>
                  setPayment({ prepId: p.id, method: "kas", partialAmount: "" })
                }
              >
                Kirim WA
              </Button>
            </span>
          </div>
        ))}
      </div>

      {/* Section "Riwayat Terkirim" — daftar prep yang sold_at !== null.
          Spec memverifikasi item pindah kesini seketika setelah dialog
          pembayaran dikonfirmasi (tanpa reload). */}
      <div
        className="mt-2 rounded border border-emerald-500/40 bg-emerald-500/5 p-1.5"
        data-testid={`riwayat-${scope}`}
      >
        <div className="mb-1 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
          Riwayat Terkirim ({sent.length})
        </div>
        <div className="space-y-1">
          {sent.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded border bg-card px-1.5 py-0.5 text-[10px]"
              data-testid={`riwayat-item-${scope}-${p.id}`}
            >
              <span className="font-mono text-muted-foreground">
                {p.id} · {p.title_id}
              </span>
              <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                {typeof p.paid_amount === "number" ? (
                  <span
                    data-testid={`riwayat-paid-${scope}-${p.id}`}
                    className="rounded bg-emerald-500/10 px-1 py-0.5 tabular-nums"
                  >
                    Rp{p.paid_amount.toLocaleString("id-ID")}
                  </span>
                ) : null}
                <span>Terkirim</span>
              </span>
            </div>
          ))}
          {sent.length === 0 && (
            <div className="text-[10px] text-muted-foreground">Belum ada.</div>
          )}
        </div>
      </div>

      {/* Dialog konfirmasi pembayaran. Bukan komponen ui/dialog agar spec
          dapat menyeleksi elemen tanpa portal/animation glitch. */}
      {payment && payment.prepId && active.some((p) => p.id === payment.prepId) && (
        <div
          role="dialog"
          aria-label="Konfirmasi pembayaran"
          data-testid={`payment-dialog-${scope}`}
          className="mt-2 space-y-1 rounded-md border bg-background p-2 text-[11px]"
        >
          <div className="font-semibold">Konfirmasi pembayaran — {payment.prepId}</div>
          {/* Ringkasan yang ditampilkan sebelum tombol Kirim — SSOT
              tampilan; spec memverifikasi bahwa pesan WA yang dikirim
              memuat elemen-elemen ini. */}
          <div
            className="rounded border bg-muted/30 p-1.5"
            data-testid={`payment-summary-${scope}`}
          >
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pelanggan</span>
              <span
                className="font-medium"
                data-testid={`payment-summary-customer-${scope}`}
              >
                {paymentCustomer}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paket</span>
              <span data-testid={`payment-summary-title-${scope}`}>
                {paymentTitleName}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span
                className="tabular-nums"
                data-testid={`payment-summary-total-${scope}`}
              >
                Rp{TOTAL_PER_PREP.toLocaleString("id-ID")}
              </span>
            </div>
          </div>
          <div className="flex gap-1">
            {(["kas", "hutang", "partial"] as const).map((m) => (
              <button
                key={m}
                type="button"
                data-testid={`payment-method-${m}`}
                onClick={() => setPayment((prev) => (prev ? { ...prev, method: m } : prev))}
                className={`rounded border px-1.5 py-0.5 ${
                  payment.method === m ? "border-primary bg-primary/10 font-semibold" : ""
                }`}
              >
                {m === "kas" ? "Lunas" : m === "hutang" ? "Hutang" : "Sebagian"}
              </button>
            ))}
          </div>
          {payment.method === "partial" && (
            <div
              className="space-y-1 rounded border border-dashed p-1.5"
              data-testid={`payment-partial-panel-${scope}`}
            >
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] text-muted-foreground">
                  Total tagihan
                </label>
                <span
                  className="tabular-nums"
                  data-testid={`payment-partial-total-${scope}`}
                >
                  Rp{TOTAL_PER_PREP.toLocaleString("id-ID")}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <label
                  className="text-[10px] text-muted-foreground"
                  htmlFor={`payment-partial-amount-${scope}`}
                >
                  Bayar sebagian
                </label>
                <input
                  id={`payment-partial-amount-${scope}`}
                  data-testid={`payment-partial-amount-${scope}`}
                  type="number"
                  min={1}
                  max={TOTAL_PER_PREP - 1}
                  value={payment.partialAmount}
                  onChange={(e) =>
                    setPayment((prev) =>
                      prev ? { ...prev, partialAmount: e.target.value } : prev,
                    )
                  }
                  className="w-24 rounded border px-1.5 py-0.5 text-right tabular-nums"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">Sisa</span>
                <span
                  className="tabular-nums"
                  data-testid={`payment-partial-sisa-${scope}`}
                >
                  {partialSisa === null
                    ? "—"
                    : `Rp${partialSisa.toLocaleString("id-ID")}`}
                </span>
              </div>
              {!partialValid && (
                <div
                  className="text-[10px] text-destructive"
                  data-testid={`payment-partial-error-${scope}`}
                >
                  Nominal harus di antara 1 dan {TOTAL_PER_PREP - 1}.
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-1 pt-1">
            <button
              type="button"
              data-testid="payment-cancel"
              onClick={() => setPayment(null)}
              className="rounded border px-1.5 py-0.5"
            >
              Batal
            </button>
            <button
              type="button"
              data-testid="payment-send-wa"
              disabled={!partialValid}
              onClick={() => {
                // Update sinkron: ubah sold_at seketika, tutup dialog.
                // Tanpa reload, tanpa await — badge & Riwayat menyegar di
                // render berikutnya.
                const id = payment.prepId;
                const method = payment.method;
                const paid =
                  method === "kas"
                    ? TOTAL_PER_PREP
                    : method === "hutang"
                      ? 0
                      : Number(payment.partialAmount);
                // Bangun pesan WA berdasarkan konten yang dilihat user di
                // dialog konfirmasi — inilah invarian yang di-e2e-kan.
                const message = formatWaMessage({
                  customer: paymentCustomer,
                  titleName: paymentTitleName,
                  total: TOTAL_PER_PREP,
                  method,
                  partialAmount: method === "partial" ? paid : null,
                });
                setLastWa(message);
                setPreps((prev) =>
                  prev.map((p) =>
                    p.id === id && isActivePrep(p)
                      ? {
                          ...p,
                          sold_at: new Date().toISOString(),
                          paid_amount: paid,
                        }
                      : p,
                  ),
                );
                setPayment(null);
              }}
              className="rounded border border-primary bg-primary px-1.5 py-0.5 font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              Kirim WA
            </button>
          </div>
        </div>
      )}

      {/* Oracle: sumber kebenaran untuk spec — spec akan menghitung ulang
          expected numbers dari sini pakai helper yang sama, lalu
          membandingkan dengan angka pada badge. */}
      <div
        data-oracle={`preps-${scope}`}
        data-json={JSON.stringify(preps)}
        hidden
      />
      {/* Pesan WA terakhir yang "dikirim" dari surface ini. Elemen
          `<pre>` mempertahankan whitespace/newlines apa adanya sehingga
          spec dapat menyocokkan baris tertentu. Awalnya kosong. */}
      <pre
        data-testid={`last-wa-message-${scope}`}
        className="mt-2 whitespace-pre-wrap rounded border bg-muted/30 p-1.5 text-[10px]"
      >
        {lastWa}
      </pre>
    </section>
  );
}

function Harness() {
  return (
    <main className="mx-auto max-w-md space-y-3 p-3 text-sm">
      <header>
        <h1 className="text-base font-bold">Ready Badges — Selector E2E</h1>
        <p className="text-[11px] text-muted-foreground">
          Harness no-auth: badge Aktif/Terkirim di dua surface dihidrasi
          hanya dari <code>countActiveByTitle</code>/<code>filterSentPreps</code>.
          Tombol Tandai/Batalkan memicu transisi state supaya spec bisa
          memverifikasi konsistensi ulang.
        </p>
      </header>
      <Surface scope="request" titles={REQUEST_TITLES} seed={SEED_REQUEST} />
      <Surface scope="ecer" titles={ECER_TITLES} seed={SEED_ECER} />
    </main>
  );
}