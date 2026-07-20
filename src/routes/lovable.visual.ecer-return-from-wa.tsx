/**
 * Harness publik (no-auth) untuk e2e "Kirim WA & catat lunas → balik ke app".
 *
 * Merender mini-versi alur `/ecer`:
 *   - Daftar prep aktif per-title.
 *   - Tombol "Kirim WA & catat lunas" hanya menandai prep terkirim SETELAH
 *     `document.visibilityState` kembali `visible` (kembali dari WA) atau
 *     4 detik fallback timer — persis kontrak `handleSend` di route Ecer.
 *   - Section "Riwayat Terkirim" untuk verifikasi daftar tidak kosong.
 *   - Input "Nama pegawai" per-title yang meniru `SendPrepLinkDialog`:
 *     state di-hidrasi dari localStorage[key(titleId)] via `loadedKeyRef`
 *     guard supaya draft antar-title tidak saling menimpa.
 *
 * Marker DOM (jangan diubah tanpa update spec):
 *   [data-testid="preps-count"]                     → jumlah prep aktif
 *   [data-testid="sent-count"]                      → jumlah Riwayat Terkirim
 *   [data-testid="preps-empty"]                     → banner "kosong"
 *   [data-testid="active-prep-<id>"]                → row prep aktif
 *   [data-testid="riwayat-prep-<id>"]               → row prep di Riwayat
 *   [data-testid="send-wa-<id>"]                    → tombol Kirim WA & lunas
 *   [data-testid="pending-<id>"]                    → penanda "menunggu balik"
 *   [data-testid="title-select-<id>"]               → pilih title aktif
 *   [data-testid="worker-name-input"]               → input nama pegawai
 *   [data-testid="worker-name-echo"]                → nilai nama saat ini
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute(
  "/lovable/visual/ecer-return-from-wa",
)({
  head: () => ({
    meta: [
      { title: "Harness · Ecer return-from-WA" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Harness,
});

type Prep = { id: string; title_id: string; customer: string; sold_at: string | null };
type Title = { id: string; name: string };

const TITLES: Title[] = [
  { id: "t-A", name: "Paket Alpha" },
  { id: "t-B", name: "Paket Beta" },
];

const SEED: Prep[] = [
  { id: "p1", title_id: "t-A", customer: "Ibu Sari", sold_at: null },
  { id: "p2", title_id: "t-A", customer: "Pak Joko", sold_at: null },
  { id: "p3", title_id: "t-B", customer: "Ibu Rina", sold_at: null },
];

const workerKey = (titleId: string | null) =>
  titleId ? `mcm:sendPrepLink:workerName:${titleId}` : null;

function Harness() {
  const [preps, setPreps] = useState<Prep[]>(SEED);
  const [pending, setPending] = useState<string | null>(null);
  const sentCalled = useRef(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // === Kirim WA & catat lunas ==========================================
  // Kontrak: setelah tombol ditekan, prep TIDAK langsung ditandai lunas.
  // Baru ditandai lunas ketika (a) visibilitychange → visible, atau
  // (b) 4 detik fallback timer. Hanya sekali via `sentCalled` guard.
  function beginSend(prepId: string) {
    if (pending) return;
    setPending(prepId);
    sentCalled.current = false;

    const finalize = () => {
      if (sentCalled.current) return;
      sentCalled.current = true;
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      setPreps((prev) =>
        prev.map((p) =>
          p.id === prepId ? { ...p, sold_at: new Date().toISOString() } : p,
        ),
      );
      setPending(null);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") finalize();
    };
    document.addEventListener("visibilitychange", onVisible);
    fallbackTimer.current = setTimeout(finalize, 4000);
  }

  // === Worker name per-title ==========================================
  const [activeTitle, setActiveTitle] = useState<string>(TITLES[0].id);
  const storageKey = workerKey(activeTitle);
  const [workerName, setWorkerName] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const k = workerKey(TITLES[0].id);
    return k ? window.localStorage.getItem(k) ?? "" : "";
  });
  const loadedKeyRef = useRef<string | null>(workerKey(TITLES[0].id));

  // LOAD effect — hidrasi dari localStorage saat key berubah.
  useEffect(() => {
    if (!storageKey) return;
    const saved = window.localStorage.getItem(storageKey) ?? "";
    setWorkerName(saved);
    loadedKeyRef.current = storageKey;
  }, [storageKey]);

  // SAVE effect — tulis draft, tetapi TOLAK bila key belum dihidrasi.
  useEffect(() => {
    if (!storageKey) return;
    if (loadedKeyRef.current !== storageKey) return;
    try {
      if (workerName) window.localStorage.setItem(storageKey, workerName);
      else window.localStorage.removeItem(storageKey);
    } catch { /* noop */ }
  }, [workerName, storageKey]);

  const active = preps.filter((p) => !p.sold_at);
  const sent = preps.filter((p) => !!p.sold_at);

  return (
    <main className="space-y-3 p-3 text-sm">
      <h1 className="text-lg font-semibold">Ecer return-from-WA harness</h1>

      <section className="rounded border p-2">
        <div className="mb-1 font-medium">
          Aktif · <span data-testid="preps-count">{active.length}</span>
        </div>
        {active.length === 0 ? (
          <div data-testid="preps-empty" className="text-muted-foreground">
            Belum ada penyiapan aktif.
          </div>
        ) : (
          <ul className="space-y-1">
            {active.map((p) => (
              <li
                key={p.id}
                data-testid={`active-prep-${p.id}`}
                className="flex items-center justify-between gap-2 rounded border px-2 py-1"
              >
                <span className="font-mono text-xs">
                  {p.id} · {p.title_id} · {p.customer}
                </span>
                <span className="flex items-center gap-1">
                  {pending === p.id && (
                    <span
                      data-testid={`pending-${p.id}`}
                      className="rounded bg-warning/10 px-1 text-xs"
                    >
                      menunggu balik…
                    </span>
                  )}
                  <button
                    type="button"
                    data-testid={`send-wa-${p.id}`}
                    onClick={() => beginSend(p.id)}
                    disabled={pending !== null}
                    className="rounded border px-2 py-0.5 text-xs"
                  >
                    Kirim WA & catat lunas
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border p-2">
        <div className="mb-1 font-medium">
          Riwayat Terkirim · <span data-testid="sent-count">{sent.length}</span>
        </div>
        <ul className="space-y-1">
          {sent.map((p) => (
            <li
              key={p.id}
              data-testid={`riwayat-prep-${p.id}`}
              className="flex items-center justify-between rounded border px-2 py-1 font-mono text-xs"
            >
              <span>
                {p.id} · {p.title_id} · {p.customer}
              </span>
              <span className="text-success">Terkirim</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded border p-2">
        <div className="mb-1 font-medium">Nama pegawai per-title</div>
        <div className="flex gap-1">
          {TITLES.map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`title-select-${t.id}`}
              onClick={() => setActiveTitle(t.id)}
              className={`rounded border px-2 py-0.5 text-xs ${
                activeTitle === t.id ? "border-primary bg-primary/10 font-semibold" : ""
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
        <input
          data-testid="worker-name-input"
          value={workerName}
          onChange={(e) => setWorkerName(e.target.value)}
          placeholder="Nama pegawai"
          className="mt-1 w-full rounded border px-2 py-1 text-xs"
        />
        <div className="mt-1 text-xs">
          Aktif: <span className="font-mono">{activeTitle}</span> · nama:
          <span data-testid="worker-name-echo" className="ml-1 font-mono">
            {workerName}
          </span>
        </div>
      </section>
    </main>
  );
}