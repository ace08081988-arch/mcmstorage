import webpush from "web-push";

let configured = false;

export const VAPID_PUBLIC_KEY =
  "BPu9dnY_SQKEYY_G9tz1YjsBWMuoYZbHPa0lDz0oSsH35dtczBKPIPCxXEF4UuMnDHH_ln-agOhpJwQLmcgNEHw";

function ensureConfigured() {
  if (configured) return;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!priv) throw new Error("VAPID_PRIVATE_KEY tidak diset");
  webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, priv);
  configured = true;
}

export type PushSubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  conversationId?: string;
};

export async function sendWebPush(sub: PushSubRow, payload: PushPayload) {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 },
    );
    return { ok: true as const };
  } catch (e: unknown) {
    const status = (e as { statusCode?: number })?.statusCode;
    return { ok: false as const, status, error: (e as Error)?.message ?? "push_failed" };
  }
}