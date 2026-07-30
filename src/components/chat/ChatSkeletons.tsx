import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton daftar percakapan — meniru bentuk `ConvRow` (avatar + 2 baris teks
 * + timestamp) supaya transisi ke data asli tidak "melompat" dan pengguna
 * langsung tahu konten sedang dimuat, bukan aplikasi terasa berat/nge-hang.
 */
export function ChatListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul
      className="-mx-3 divide-y divide-[var(--wa-border)]/60"
      role="status"
      aria-busy="true"
      aria-label="Memuat daftar chat"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-ms-3 px-ms-3 py-ms-2.5">
          <Skeleton className="h-11 w-11 shrink-0 rounded-full bg-[var(--wa-surface-2)]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-ms-2">
              <Skeleton
                className="h-3 rounded bg-[var(--wa-surface-2)]"
                style={{ width: `${45 + ((i * 13) % 35)}%` }}
              />
              <Skeleton className="h-2.5 w-10 rounded bg-[var(--wa-surface-2)]" />
            </div>
            <Skeleton
              className="h-2.5 rounded bg-[var(--wa-surface-2)]"
              style={{ width: `${55 + ((i * 17) % 30)}%` }}
            />
          </div>
        </li>
      ))}
      <span className="sr-only">Memuat daftar chat…</span>
    </ul>
  );
}

/**
 * Skeleton pesan chat — pola gelembung kiri/kanan bergantian meniru layout
 * `ChatBubble` sehingga area pesan terasa "hidup" saat riwayat percakapan
 * masih diambil.
 */
export function ChatMessagesSkeleton({ bubbles = 5 }: { bubbles?: number }) {
  const widths = [72, 55, 40, 65, 48, 58];
  return (
    <div
      className="space-ms-3"
      role="status"
      aria-busy="true"
      aria-label="Memuat pesan"
    >
      {Array.from({ length: bubbles }).map((_, i) => {
        const mine = i % 2 === 1;
        return (
          <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] space-y-1.5 rounded-2xl px-ms-3 py-ms-2 ${
                mine ? "bg-[var(--wa-out-bubble)]" : "bg-[var(--wa-in-bubble)]"
              } shadow-sm`}
              style={{ width: `${widths[i % widths.length]}%` }}
            >
              <Skeleton className="h-2.5 w-full rounded bg-black/10 dark:bg-white/10" />
              <Skeleton
                className="h-2.5 rounded bg-black/10 dark:bg-white/10"
                style={{ width: `${60 + ((i * 11) % 30)}%` }}
              />
              <div className="flex justify-end pt-0.5">
                <Skeleton className="h-2 w-8 rounded bg-black/10 dark:bg-white/10" />
              </div>
            </div>
          </div>
        );
      })}
      <span className="sr-only">Memuat pesan…</span>
    </div>
  );
}

/**
 * Skeleton kompak untuk daftar opsi/menu (mis. dropdown kategori chat,
 * daftar quick reply, hasil pencarian) — beberapa baris teks pendek dengan
 * lebar acak stabil.
 */
export function ChatOptionsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="space-y-2 px-ms-3 py-ms-2"
      role="status"
      aria-busy="true"
      aria-label="Memuat opsi"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-ms-2">
          <Skeleton className="h-4 w-4 shrink-0 rounded bg-[var(--wa-surface-2)]" />
          <Skeleton
            className="h-3 rounded bg-[var(--wa-surface-2)]"
            style={{ width: `${50 + ((i * 19) % 35)}%` }}
          />
        </div>
      ))}
      <span className="sr-only">Memuat opsi…</span>
    </div>
  );
}