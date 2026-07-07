/**
 * Harness publik (no-auth) untuk e2e kontrak Batal auto-Kirim.
 *
 * Tujuan spec:
 *   Membuktikan tombol Batal (AutoSendConfirmDialog.onCancel) TIDAK
 *   PERNAH membuka dialog verifikasi pembayaran, dan TIDAK MEMICU
 *   request jaringan apa pun terkait pembayaran (sales, customer
 *   payments, WA send, dsb). Regresi guard: kalau seseorang men-wire
 *   `setSendOpen(true)` ke jalur cancel — spec langsung merah.
 *
 * Non-tautologi: harness mengimpor `AutoSendConfirmDialog` yang SAMA
 * dengan yang dipakai `/ecer` produksi. Tidak ada re-implementasi
 * dialog di sini. Stub "dialog pembayaran" hanya sensor visibilitas —
 * hanya mount kalau `paymentOpen === true`, dan `paymentOpen` HANYA
 * bisa dinaikkan lewat `onConfirm`. Kalau kontrak bocor, sensor akan
 * ikut menyala.
 *
 * Sensor request pembayaran:
 *   Pre-mount, harness memasang wrapper `window.fetch` + hook
 *   `XMLHttpRequest.open` yang mencatat setiap URL yang mengandung
 *   token pembayaran/penjualan ke `[data-testid="payment-fetch-log"]`.
 *   Spec membaca teks itu setelah menekan Batal dan mengharuskan
 *   panjangnya nol.
 *
 * URL: /lovable/visual/auto-send-cancel (noindex, no-auth).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  AutoSendConfirmDialog,
  AutoSendCancelReasonDialog,
  type AutoSendCancelState,
} from "@/components/ecer/AutoSendDialogs";
import type { EcerTitle, EcerPreparation } from "@/lib/ecer";

export const Route = createFileRoute("/lovable/visual/auto-send-cancel")({
  head: () => ({
    meta: [
      { title: "Harness · Auto-send cancel" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Harness,
});

// Token URL yang WAJIB kosong setelah Batal — mewakili endpoint
// pembayaran / pengiriman yang dipakai flow `SendEcerPrepsDialog`
// (RPC penjualan, insert customer_payments, share WA, dsb).
const PAYMENT_URL_TOKENS = [
  "sales",
  "customer_payment",
  "record_sale",
  "record_ecer_sale",
  "ecer_sale",
  "wa.me",
  "send",
  "pay",
];

function isPaymentUrl(url: string): boolean {
  const u = url.toLowerCase();
  return PAYMENT_URL_TOKENS.some((t) => u.includes(t));
}

function Harness() {
  const [confirmState, setConfirmState] = useState<{
    preps: EcerPreparation[];
  } | null>(null);
  const [cancelState, setCancelState] = useState<AutoSendCancelState | null>(
    null,
  );
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [fetchLog, setFetchLog] = useState<string[]>([]);
  const paymentEverOpened = useRef(false);

  // Pasang sensor jaringan SEBELUM interaksi apa pun. Kalau flow
  // Batal secara keliru memanggil fetch/XHR ke endpoint pembayaran,
  // wrapper ini akan mencatatnya ke DOM supaya spec bisa membacanya.
  useEffect(() => {
    const origFetch = window.fetch;
    const origOpen = window.XMLHttpRequest.prototype.open;
    const record = (url: string) => {
      if (!url || !isPaymentUrl(url)) return;
      setFetchLog((prev) => [...prev, url]);
    };
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        record(url);
      } catch {
        /* noop */
      }
      return origFetch(input as RequestInfo, init);
    }) as typeof window.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.XMLHttpRequest.prototype as any).open = function (
      method: string,
      url: string,
      ...rest: unknown[]
    ) {
      record(url);
      // eslint-disable-next-line prefer-spread
      return origOpen.apply(this, [method, url, ...rest] as unknown as [
        string,
        string,
      ]);
    };
    return () => {
      window.fetch = origFetch;
      window.XMLHttpRequest.prototype.open = origOpen;
    };
  }, []);

  const title: EcerTitle = {
    id: "t-harness",
    warehouse_item_id: "i-harness",
    name: "Bawang Merah 250g",
    target_grams: 250,
    unit_label: "g",
    created_at: new Date().toISOString(),
    // Field lain di EcerTitle tidak dipakai dialog — cast aman.
  } as unknown as EcerTitle;

  const preps: EcerPreparation[] = [
    {
      id: "prep-alpha-0001",
      title_id: title.id,
      warehouse_item_id: title.warehouse_item_id,
      actual_grams: 250,
      sold_at: null,
    },
    {
      id: "prep-beta-0002",
      title_id: title.id,
      warehouse_item_id: title.warehouse_item_id,
      actual_grams: 260,
      sold_at: null,
    },
    {
      id: "prep-gamma-0003",
      title_id: title.id,
      warehouse_item_id: title.warehouse_item_id,
      actual_grams: 240,
      sold_at: null,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as unknown as any;

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-lg font-semibold">Harness · Auto-send cancel</h1>
      <p className="text-xs text-muted-foreground">
        Membuka modal konfirmasi auto-send lalu memicu Batal — dialog
        pembayaran TIDAK BOLEH muncul dan tidak ada request pembayaran.
      </p>

      <button
        type="button"
        data-testid="open-auto-send-confirm"
        className="rounded-md border px-3 py-2 text-sm"
        onClick={() => setConfirmState({ preps })}
      >
        Buka modal konfirmasi auto-send
      </button>

      <div
        data-testid="payment-open-state"
        data-open={paymentOpen ? "1" : "0"}
        className="text-xs text-muted-foreground"
      >
        payment-open={paymentOpen ? "1" : "0"} · ever-opened=
        {paymentEverOpened.current ? "1" : "0"}
      </div>

      <div
        data-testid="payment-fetch-log"
        className="whitespace-pre rounded border bg-muted/30 p-2 text-[10px]"
      >
        {fetchLog.join("\n")}
      </div>

      {/* Stub dialog pembayaran — SATU-SATUNYA render terjadi ketika
          onConfirm dari AutoSendConfirmDialog dieksekusi. Bukan sekadar
          sensor: kalau muncul saat Batal, kontrak sudah pecah. */}
      {paymentOpen && (
        <div
          role="dialog"
          data-testid="payment-dialog-ecer"
          className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm"
        >
          Dialog verifikasi pembayaran (stub)
          <button
            type="button"
            data-testid="payment-dialog-close"
            className="ml-2 rounded border px-2 py-0.5"
            onClick={() => setPaymentOpen(false)}
          >
            Tutup
          </button>
        </div>
      )}

      <AutoSendConfirmDialog
        state={confirmState}
        title={title}
        itemName="Bawang Merah"
        onCancel={() => {
          // Jalur cancel: buka dialog alasan, TIDAK menyentuh paymentOpen.
          const st = confirmState;
          setConfirmState(null);
          if (st) {
            setCancelState({
              preps: st.preps,
              auditId: "audit-harness",
              source: "confirm_modal",
            });
          }
        }}
        onConfirm={() => {
          setConfirmState(null);
          paymentEverOpened.current = true;
          setPaymentOpen(true);
        }}
      />

      <AutoSendCancelReasonDialog
        state={cancelState}
        title={title}
        itemName="Bawang Merah"
        onSubmit={() => setCancelState(null)}
        onDismiss={() => setCancelState(null)}
      />
    </div>
  );
}