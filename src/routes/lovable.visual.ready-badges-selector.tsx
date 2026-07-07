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
type Prep = { id: string; title_id: string; sold_at: string | null };

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
  { id: "rp1", title_id: "r-A", sold_at: null },
  { id: "rp2", title_id: "r-A", sold_at: null },
  { id: "rp3", title_id: "r-A", sold_at: "2026-07-01T00:00:00Z" },
  { id: "rp4", title_id: "r-B", sold_at: null },
  { id: "rp5", title_id: "r-B", sold_at: "2026-07-02T00:00:00Z" },
  { id: "rp6", title_id: "r-B", sold_at: "2026-07-03T00:00:00Z" },
  // r-C sengaja tanpa prep — badge harus 0/0.
];
const SEED_ECER: Prep[] = [
  { id: "ep1", title_id: "e-X", sold_at: null },
  { id: "ep2", title_id: "e-X", sold_at: null },
  { id: "ep3", title_id: "e-X", sold_at: "2026-07-01T00:00:00Z" },
  { id: "ep4", title_id: "e-Y", sold_at: null },
  { id: "ep5", title_id: "e-Y", sold_at: "2026-07-02T00:00:00Z" },
];

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
  }>(null);

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
                onClick={() => setPayment({ prepId: p.id, method: "kas" })}
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
              <span className="text-emerald-700 dark:text-emerald-300">Terkirim</span>
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
              onClick={() => {
                // Update sinkron: ubah sold_at seketika, tutup dialog.
                // Tanpa reload, tanpa await — badge & Riwayat menyegar di
                // render berikutnya.
                const id = payment.prepId;
                setPreps((prev) =>
                  prev.map((p) =>
                    p.id === id && isActivePrep(p)
                      ? { ...p, sold_at: new Date().toISOString() }
                      : p,
                  ),
                );
                setPayment(null);
              }}
              className="rounded border border-primary bg-primary px-1.5 py-0.5 font-semibold text-primary-foreground"
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