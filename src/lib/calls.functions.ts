/**
 * Server function untuk mengambil daftar ICE server (STUN + TURN).
 *
 * TURN dibutuhkan agar panggilan bisa menembus NAT simetris (umum di
 * jaringan seluler & Wi-Fi kantor). Kredensial diambil dari secret
 * `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`; ketiganya harus ada
 * agar TURN dianggap aktif. Bila kosong, fallback ke STUN saja.
 */
import { createServerFn } from "@tanstack/react-start";

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

export const getIceServers = createServerFn({ method: "GET" }).handler(
  async (): Promise<IceServersResult> => {
    const url = process.env.TURN_URL?.trim();
    const username = process.env.TURN_USERNAME?.trim();
    const credential = process.env.TURN_CREDENTIAL?.trim();
    if (url && username && credential) {
      // Dukung beberapa URL dipisah koma untuk failover regional.
      const urls = url.includes(",")
        ? url.split(",").map((s) => s.trim()).filter(Boolean)
        : url;
      return {
        iceServers: [
          ...DEFAULT_STUN,
          { urls, username, credential },
        ],
        turnConfigured: true,
      };
    }
    return { iceServers: DEFAULT_STUN, turnConfigured: false };
  },
);