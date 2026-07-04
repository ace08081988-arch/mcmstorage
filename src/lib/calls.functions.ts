/**
 * Server function untuk mengambil daftar ICE server (STUN + TURN) —
 * kredensial TURN diminta secara dinamis ke **Twilio Network Traversal
 * Service** (Tokens API) supaya bersifat sementara (TTL ~1 jam) dan
 * tidak perlu disimpan sebagai secret statis.
 *
 * Secret yang dibutuhkan:
 *   - TWILIO_ACCOUNT_SID  (mulai dengan "AC…")
 *   - TWILIO_AUTH_TOKEN
 *
 * Bila kedua secret belum diisi atau Twilio gagal, fallback ke STUN
 * publik saja (panggilan tetap jalan di jaringan tanpa NAT simetris,
 * dan UI menampilkan banner "TURN belum diatur").
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type IceServersResult = {
  iceServers: IceServerConfig[];
  turnConfigured: boolean;
};

const DEFAULT_STUN: IceServerConfig[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

type TwilioIceServer = {
  url?: string;
  urls?: string | string[];
  username?: string;
  credential?: string;
};

type TwilioTokenResponse = {
  ice_servers?: TwilioIceServer[];
  username?: string;
  password?: string;
  ttl?: string;
};

export const getIceServers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<IceServersResult> => {
    const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!sid || !token) {
      return { iceServers: DEFAULT_STUN, turnConfigured: false };
    }
    try {
      const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Tokens.json`;
      // Basic Auth: base64("SID:AUTH_TOKEN"). Pakai Buffer supaya kompatibel
      // dengan Worker runtime (nodejs_compat) — btoa juga tersedia namun
      // Buffer lebih eksplisit di server.
      const basic = Buffer.from(`${sid}:${token}`, "utf8").toString("base64");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        // Twilio menerima body kosong; TTL default 86400 detik.
        body: "",
      });
      if (!res.ok) {
        // Log detail server-side saja; jangan bocor ke client.
        console.error("Twilio Tokens API gagal", res.status, await res.text().catch(() => ""));
        return { iceServers: DEFAULT_STUN, turnConfigured: false };
      }
      const data = (await res.json()) as TwilioTokenResponse;
      const twilioServers: IceServerConfig[] = [];
      for (const s of data.ice_servers ?? []) {
        // Twilio kadang mengirim `url` (singular, legacy) atau `urls`
        // (plural, sesuai spec WebRTC modern). Normalisasi ke `urls`.
        const urls = s.urls ?? s.url;
        if (!urls) continue;
        const entry: IceServerConfig = { urls };
        if (s.username) entry.username = s.username;
        if (s.credential) entry.credential = s.credential;
        twilioServers.push(entry);
      }
      const hasTurn = twilioServers.some((s) => {
        const u = Array.isArray(s.urls) ? s.urls : [s.urls];
        return u.some((x) => typeof x === "string" && x.startsWith("turn"));
      });
      if (twilioServers.length === 0) {
        return { iceServers: DEFAULT_STUN, turnConfigured: false };
      }
      return {
        // STUN publik tetap disertakan sebagai backup jika endpoint
        // Twilio bermasalah di tengah sesi.
        iceServers: [...DEFAULT_STUN, ...twilioServers],
        turnConfigured: hasTurn,
      };
    } catch (e) {
      console.error("Twilio Tokens API error", e);
      return { iceServers: DEFAULT_STUN, turnConfigured: false };
    }
  });