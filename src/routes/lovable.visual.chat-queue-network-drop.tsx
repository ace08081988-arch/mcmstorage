/**
 * Harness publik (no-auth) untuk e2e kontrak queue produk pada
 * composer chat saat jaringan drop di tengah pengiriman.
 *
 * Invariant yang di-e2e-kan (mirror langsung dari loop kirim di
 * `_authenticated.chat.$conversationId.tsx`):
 *
 *   1. Kalau `sendProductRow` gagal (throw / return false), item
 *      TIDAK dibuang dari queue — status di-set "failed" dan chip
 *      tetap terlihat di composer.
 *   2. Isi queue di-mirror ke `localStorage` pada envelope v2:
 *      `{ v: PENDING_PRODUCTS_VERSION, items: [...] }` dengan key
 *      `mcm.chat.pendingProducts.<convId>`. Kalau queue kosong,
 *      key ini dihapus.
 *   3. Setelah reconnect, tekan Kirim lagi harus mengulang loop
 *      terhadap SISA item (yang statusnya "failed") — begitu semua
 *      sukses, queue dikosongkan & key localStorage terhapus.
 *
 * Non-tautologi:
 *   - Import `PENDING_PRODUCTS_VERSION` dari route produksi supaya
 *     bump versi envelope memecah harness (dan test).
 *   - Loop kirim berbentuk sama persis dgn produksi: `for` sekuensial,
 *     hapus dari daftar hanya kalau `ok === true`, tandai "failed"
 *     saat return false / throw.
 *   - Kondisi kegagalan bertumpu pada `navigator.onLine` — Playwright
 *     `context.setOffline(true)` men-trigger event `offline` yang
 *     me-flip flag ini di window utama.
 *
 * URL: /lovable/visual/chat-queue-network-drop (noindex, no-auth).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PENDING_PRODUCTS_VERSION } from "@/routes/_authenticated.chat.$conversationId";

export const Route = createFileRoute("/lovable/visual/chat-queue-network-drop")({
  head: () => ({
    meta: [
      { title: "Harness · Queue produk saat network drop" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Harness,
});

type Row = {
  id: string;
  source: "ready" | "self" | "catalog";
  bucket: "ready-packages" | "self-prep-photos" | "item-photos";
  productName: string;
  photoPaths: string[];
  baseUnit: null | "g" | "pcs";
  qty: number | null;
};

type Status = "idle" | "pending" | "sending" | "failed";

const CONV_ID = "harness-net-drop";
const KEY = `mcm.chat.pendingProducts.${CONV_ID}`;

const SEED: Row[] = [
  { id: "row-1", source: "ready", bucket: "ready-packages", productName: "Beras Premium 5kg", photoPaths: [], baseUnit: "pcs", qty: 1 },
  { id: "row-2", source: "ready", bucket: "ready-packages", productName: "Minyak Goreng 2L", photoPaths: [], baseUnit: "pcs", qty: 2 },
  { id: "row-3", source: "ready", bucket: "ready-packages", productName: "Gula Pasir 1kg", photoPaths: [], baseUnit: "pcs", qty: 3 },
];

/**
 * Stub `sendProductRow` — non-tautological dgn implementasi asli:
 * asli memanggil Supabase RPC & wa.me; di harness kita simulasikan
 * kegagalan jaringan sederhana lewat `navigator.onLine`. Yang penting
 * adalah SEKELILING loop (persist + status transition), bukan mekanik
 * transport-nya.
 */
async function stubSendProductRow(_row: Row): Promise<boolean> {
  // Beri sedikit tick asinkron supaya spec sempat memotret status
  // "sending" per item.
  await new Promise((r) => setTimeout(r, 15));
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("offline: fetch aborted");
  }
  return true;
}

function persist(items: Row[]) {
  try {
    if (items.length === 0) {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ v: PENDING_PRODUCTS_VERSION, items }),
      );
    }
  } catch { /* ignore */ }
}

function Harness() {
  const [rows, setRows] = useState<Row[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Bersihkan storage saat mount pertama agar test deterministik.
  useEffect(() => {
    try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
  }, []);

  const seed = useCallback(() => {
    setRows(SEED);
    setStatuses(Object.fromEntries(SEED.map((r) => [r.id, "idle" as Status])));
    persist(SEED);
  }, []);

  const clear = useCallback(() => {
    setRows([]);
    setStatuses({});
    persist([]);
  }, []);

  const kirim = useCallback(async () => {
    if (busy) return;
    if (rows.length === 0) return;
    setBusy(true);
    const queue = rows.slice();
    setStatuses((prev) => {
      const next: Record<string, Status> = { ...prev };
      for (const r of queue) next[r.id] = "pending";
      return next;
    });
    try {
      for (const row of queue) {
        setStatuses((prev) => ({ ...prev, [row.id]: "sending" }));
        try {
          const ok = await stubSendProductRow(row);
          if (ok) {
            setRows((prev) => {
              const next = prev.filter((p) => p.id !== row.id);
              persist(next);
              return next;
            });
            setStatuses((prev) => {
              const { [row.id]: _drop, ...rest } = prev;
              return rest;
            });
          } else {
            setStatuses((prev) => ({ ...prev, [row.id]: "failed" }));
          }
        } catch {
          setStatuses((prev) => ({ ...prev, [row.id]: "failed" }));
        }
      }
    } finally {
      setBusy(false);
    }
  }, [busy, rows]);

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-lg font-semibold">Harness · Queue produk (network drop)</h1>

      <section className="rounded border p-3 text-sm">
        <div>
          Online:{" "}
          <span data-testid="online-state" data-online={online ? "1" : "0"}>
            {online ? "true" : "false"}
          </span>
        </div>
        <div>
          Busy:{" "}
          <span data-testid="busy-state" data-busy={busy ? "1" : "0"}>
            {busy ? "true" : "false"}
          </span>
        </div>
        <div>
          Queue length:{" "}
          <span data-testid="queue-length">{rows.length}</span>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="btn-seed"
          className="rounded bg-blue-600 px-3 py-2 text-white"
          onClick={seed}
        >
          Isi Queue (3)
        </button>
        <button
          type="button"
          data-testid="btn-kirim"
          className="rounded bg-green-600 px-3 py-2 text-white disabled:opacity-50"
          disabled={busy || rows.length === 0}
          onClick={() => { void kirim(); }}
        >
          Kirim
        </button>
        <button
          type="button"
          data-testid="btn-clear"
          className="rounded bg-gray-600 px-3 py-2 text-white"
          onClick={clear}
        >
          Reset
        </button>
      </div>

      <ul data-testid="queue-list" className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            data-testid={`queue-item-${r.id}`}
            data-status={statuses[r.id] ?? "idle"}
            className="rounded border p-2 text-sm"
          >
            <div className="font-medium">{r.productName}</div>
            <div className="text-xs text-gray-500">
              status:{" "}
              <span data-testid={`queue-status-${r.id}`}>
                {statuses[r.id] ?? "idle"}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* Sensor localStorage — spec membaca `data-ls` untuk memverifikasi
          envelope v2 tetap konsisten dgn `PENDING_PRODUCTS_VERSION`. */}
      <LsSensor rows={rows} />
    </main>
  );
}

function LsSensor({ rows }: { rows: Row[] }) {
  // Baca ulang setiap kali `rows` berubah supaya event `input` deteksi.
  const [snapshot, setSnapshot] = useState<string>("");
  useEffect(() => {
    try {
      setSnapshot(window.localStorage.getItem(KEY) ?? "");
    } catch {
      setSnapshot("");
    }
  }, [rows]);
  return (
    <div
      data-testid="ls-snapshot"
      data-key={KEY}
      data-version={String(PENDING_PRODUCTS_VERSION)}
      data-empty={snapshot === "" ? "1" : "0"}
      className="hidden"
    >
      {snapshot}
    </div>
  );
}