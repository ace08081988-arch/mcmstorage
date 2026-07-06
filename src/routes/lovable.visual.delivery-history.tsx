/**
 * Visual harness untuk DeliveryHistoryDialog — render ulang markup kartu
 * riwayat pengiriman dengan string ekstrem (nama panjang tanpa spasi,
 * label channel panjang) supaya audit truncate + min-w-0 bisa
 * diverifikasi di viewport HP tanpa auth atau network.
 *
 * URL: /lovable/visual/delivery-history
 */
import { createFileRoute } from "@tanstack/react-router";
import { History, AlertTriangle } from "lucide-react";
import { useEffect } from "react";

export const Route = createFileRoute("/lovable/visual/delivery-history")({
  head: () => ({
    meta: [
      { title: "Delivery History Audit — MCM" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    theme: s.theme === "dark" ? "dark" : "light",
  }),
  component: Harness,
});

type Row = {
  key: string;
  worker_name: string;
  title_name: string;
  status: { label: string; tone: string };
  firstSent: string;
  lastSent: string;
  completed?: string;
  entries: { id: string; label: string }[];
};

const ROWS: Row[] = [
  {
    key: "1",
    worker_name: "PegawaiDenganNamaSangatPanjangTanpaSpasiUntukUjiTruncateDiMobile",
    title_name: "PaketRequestPromoAkhirBulanDenganLabelSuperPanjangTanpaSpasi",
    status: { label: "Menunggu diambil", tone: "border-amber-500/40 bg-amber-500/10 text-amber-800" },
    firstSent: "06/07/2026 09:12:34",
    lastSent: "06/07/2026 10:45:00",
    entries: [
      { id: "a1", label: "WhatsApp · 06/07/2026 09:12" },
      { id: "a2", label: "WhatsAppBusinessAPIKanalPanjang · 06/07/2026 10:45" },
    ],
  },
  {
    key: "2",
    worker_name: "Ali",
    title_name: "Paket Mie Instan",
    status: { label: "Selesai", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" },
    firstSent: "05/07/2026 14:00",
    lastSent: "05/07/2026 14:00",
    completed: "05/07/2026 15:20",
    entries: [{ id: "b1", label: "WA · 05/07/2026 14:00" }],
  },
  {
    key: "3",
    worker_name: "Budi Setiawan Prakoso",
    title_name: "RequestKhususToko Cabang Sukajadi Ekspress Kurir Motor",
    status: { label: "Kadaluarsa", tone: "border-slate-500/40 bg-slate-500/10 text-slate-700" },
    firstSent: "04/07/2026 08:00",
    lastSent: "04/07/2026 08:00",
    entries: [
      { id: "c1", label: "WA · 04/07/2026 08:00" },
      { id: "c2", label: "SMS · 04/07/2026 08:05" },
      { id: "c3", label: "Telegram · 04/07/2026 08:10" },
    ],
  },
];

function Harness() {
  const { theme } = Route.useSearch();
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    return () => {
      if (had) root.classList.add("dark");
      else root.classList.remove("dark");
    };
  }, [theme]);
  const headerLabel = "PaketRequestDenganJudulSangatPanjangTanpaSpasiUntukMengujiTruncateDiHeaderDialogMobile";
  return (
    <div className="min-h-dvh bg-background p-3" data-visual-root data-theme={theme}>
      {/* Wadah mock DialogContent: max-w-lg + padding dialog. */}
      <div data-visual-dialog className="mx-auto w-full max-w-lg rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3">
          <div className="flex items-center gap-2 font-semibold">
            <History className="h-4 w-4 text-primary" /> Riwayat pengiriman link
          </div>
          <div className="min-w-0 text-sm text-muted-foreground">
            Daftar pengiriman link tugas ke pegawai untuk{" "}
            <b className="inline-block min-w-0 max-w-full truncate align-bottom">{headerLabel}</b>
            . Status diambil dari tugas terkait.
          </div>
        </div>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {ROWS.map((g) => (
            <div key={g.key} data-history-card className="rounded-lg border bg-card p-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-sm">{g.worker_name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{g.title_name}</div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${g.status.tone}`}>
                  {g.status.label}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-1 gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                <div className="min-w-0">
                  <span className="text-[10px] uppercase tracking-wide">Kirim pertama</span>
                  <br />
                  <span className="truncate">{g.firstSent}</span>
                </div>
                {g.lastSent !== g.firstSent && (
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase tracking-wide">Kirim terakhir</span>
                    <br />
                    <span className="truncate">{g.lastSent}</span>
                  </div>
                )}
                {g.completed && (
                  <div className="min-w-0 sm:col-span-2">
                    <span className="text-[10px] uppercase tracking-wide">Selesai</span>
                    <br />
                    <span className="truncate">{g.completed}</span>
                  </div>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {g.entries.map((e) => (
                  <span
                    key={e.id}
                    className="min-w-0 max-w-full truncate rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground"
                    title={e.label}
                  >
                    {e.label}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {/* Error mock */}
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <div className="flex items-center gap-1 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" /> Gagal memuat
            </div>
            <div className="mt-1 break-words">
              Error: PesanErrorPanjangTanpaSpasiUntukMengujiBreakWordsDiKontainerErrorMobile
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}