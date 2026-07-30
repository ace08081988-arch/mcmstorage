/**
 * Pending-invite persistence — supaya deep link `/i/<code>` selalu bisa
 * dilanjutkan setelah user refresh, tutup tab, atau harus login/verifikasi
 * dulu. Simpan di localStorage dengan TTL pendek supaya tidak nyangkut
 * selamanya bila user memilih tidak menerima undangan.
 */

const KEY = "mcm.pendingInvite";
const TTL_MS = 60 * 60 * 1000; // 1 jam

type Stored = { code: string; at: number };

function safeParse(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Stored>;
    if (typeof p.code !== "string" || typeof p.at !== "number") return null;
    if (!/^[A-Z0-9]{4,12}$/.test(p.code)) return null;
    if (Date.now() - p.at > TTL_MS) return null;
    return { code: p.code, at: p.at };
  } catch {
    return null;
  }
}

export function savePendingInvite(code: string): void {
  if (typeof window === "undefined") return;
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{4,12}$/.test(normalized)) return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ code: normalized, at: Date.now() } satisfies Stored),
    );
  } catch {
    /* storage penuh / diblokir — abaikan */
  }
}

export function readPendingInvite(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = safeParse(window.localStorage.getItem(KEY));
    return stored?.code ?? null;
  } catch {
    return null;
  }
}

export function readPendingInvitePath(): string | null {
  const code = readPendingInvite();
  return code ? `/i/${code}` : null;
}

export function clearPendingInvite(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}