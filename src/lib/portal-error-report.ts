/**
 * Kirim event error internal halaman portal publik ke server untuk dilog.
 * Fire-and-forget; kegagalan pengiriman tidak boleh memengaruhi UX.
 * Server yang meredaksi PII dan membuat alert saat error berulang.
 *
 * Return: kode referensi pendek yang aman ditampilkan ke user, atau null.
 */
export async function reportPortalError(input: {
  kind: string;
  code?: string | null;
  status?: string | null;
  /**
   * Wajib: share_token dari URL portal (mis. `/t/:token`). Server
   * memverifikasi token cocok dengan `prep_tasks` aktif; tanpa itu
   * endpoint menolak dengan 401 dan event tidak dicatat.
   */
  token: string;
  route?: string | null;
}): Promise<string | null> {
  if (!input.token) return null;
  try {
    const res = await fetch("/api/public/hooks/log-portal-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: input.kind,
        code: input.code ?? null,
        status: input.status ?? null,
        token: input.token,
        route:
          input.route ??
          (typeof window !== "undefined" ? window.location.pathname : null),
      }),
      keepalive: true,
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { ref?: string } | null;
    return json?.ref ?? null;
  } catch {
    return null;
  }
}