/**
 * Harness publik (no-auth) untuk e2e reaktivitas `markSent`.
 *
 * Meniru alur di `WorkerSubmissionsCard` (halaman /ecer):
 *   - Grid "Kiriman aktif" di-filter dengan `useSentShots` — kartu hilang
 *     begitu id-nya ada di sent map.
 *   - Panel "Riwayat Terkirim" menampilkan kartu yang sudah ditandai
 *     terkirim.
 *   - Tombol Kirim WA / Kirim Chat memanggil `markSent` (sama seperti
 *     handler asli sesudah `shareToWhatsApp` / `shareToChat` sukses),
 *     tanpa membuka WhatsApp/Chat sungguhan.
 *
 * Tidak ada network. State asli — `wa-sent-history` — yang menggerakkan
 * transisi. Spec menegaskan invariant: sesudah klik WA/Chat kartu HARUS
 * pindah ke Riwayat tanpa reload/refetch.
 *
 * Marker DOM (stabil, jangan diubah tanpa memperbarui spec):
 *   [data-testid="active-shot-<id>"]           → kartu di grid aktif
 *   [data-testid="riwayat-shot-<id>"]          → kartu di Riwayat
 *   [data-testid="send-wa-<id>"]               → tombol Kirim WA
 *   [data-testid="send-chat-<id>"]             → tombol Kirim Chat
 *   [data-testid="active-count"]               → jumlah aktif
 *   [data-testid="sent-count"]                 → jumlah terkirim
 *   [data-testid="channel-<id>"]               → kanal terakhir (wa|chat)
 *
 * URL: /lovable/visual/worker-shot-marksent (noindex, no-auth).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  markSent,
  unmarkSent,
  useSentDetails,
  useSentShots,
} from "@/lib/wa-sent-history";

export const Route = createFileRoute(
  "/lovable/visual/worker-shot-marksent",
)({
  head: () => ({
    meta: [
      { title: "Harness · Worker shot markSent" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Harness,
});

type Shot = { id: string; label: string };

const SHOTS: Shot[] = [
  { id: "ws-1", label: "Kiriman #1" },
  { id: "ws-2", label: "Kiriman #2" },
  { id: "ws-3", label: "Kiriman #3" },
];

function Harness() {
  const sentMap = useSentShots();
  const sentDetails = useSentDetails();

  // Reset registry saat harness mount agar setiap test run mulai bersih.
  useEffect(() => {
    unmarkSent(SHOTS.map((s) => s.id));
    return () => {
      unmarkSent(SHOTS.map((s) => s.id));
    };
  }, []);

  const active = SHOTS.filter((s) => !sentMap.has(s.id));
  const sent = SHOTS.filter((s) => sentMap.has(s.id));

  function sendWa(id: string) {
    markSent([id], {
      channel: "wa",
      status: "success",
      idemKey: `harness-wa-${id}-${Date.now()}`,
    });
  }
  function sendChat(id: string) {
    markSent([id], {
      channel: "chat",
      status: "success",
      idemKey: `harness-chat-${id}-${Date.now()}`,
    });
  }

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Harness · Worker shot markSent</h1>
      <section aria-label="Kiriman aktif" style={{ marginTop: 12 }}>
        <h2>
          Kiriman aktif · <span data-testid="active-count">{active.length}</span>
        </h2>
        <ul>
          {active.map((s) => (
            <li key={s.id} data-testid={`active-shot-${s.id}`}>
              <span>{s.label}</span>{" "}
              <button
                type="button"
                data-testid={`send-wa-${s.id}`}
                onClick={() => sendWa(s.id)}
              >
                Kirim WA
              </button>{" "}
              <button
                type="button"
                data-testid={`send-chat-${s.id}`}
                onClick={() => sendChat(s.id)}
              >
                Kirim Chat
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Riwayat terkirim" style={{ marginTop: 20 }}>
        <h2>
          Riwayat Terkirim ·{" "}
          <span data-testid="sent-count">{sent.length}</span>
        </h2>
        <ul>
          {sent.map((s) => {
            const entry = sentDetails.get(s.id);
            return (
              <li key={s.id} data-testid={`riwayat-shot-${s.id}`}>
                <span>{s.label}</span>{" "}
                <span data-testid={`channel-${s.id}`}>
                  {entry?.channel ?? ""}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}