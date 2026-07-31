import { resolvePaddlePrice } from "@/utils/payments.functions";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

declare global {
  interface Window {
    Paddle: any;
  }
}

/** Sumber tunggal penentu mode pembayaran (uji vs live) di sisi klien. */
export function getPaddleEnvironment(): "sandbox" | "live" {
  return clientToken?.startsWith("test_") ? "sandbox" : "live";
}

let paddleInitialized = false;

export async function initializePaddle() {
  if (paddleInitialized) return;
  if (!clientToken) throw new Error("VITE_PAYMENTS_CLIENT_TOKEN belum diset");

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.onload = () => {
      const jsEnv = getPaddleEnvironment() === "sandbox" ? "sandbox" : "production";
      window.Paddle.Environment.set(jsEnv);
      window.Paddle.Initialize({ token: clientToken });
      paddleInitialized = true;
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export async function getPaddlePriceId(priceId: string): Promise<string> {
  const environment = getPaddleEnvironment();
  return resolvePaddlePrice({ data: { priceId, environment } });
}

export type PlanPriceId = "mcm_pro_monthly" | "mcm_pro_yearly";

/** Lama uji coba gratis (hari) — disetel juga pada harga di penyedia. */
export const TRIAL_DAYS = 14;

/**
 * Penyedia pembayaran kartu TIDAK mendukung Rupiah, jadi tagihan kartu
 * memakai USD. Angka rupiah di bawah hanya estimasi tampilan agar pemilik
 * toko Indonesia paham kisaran biayanya. Jalur rupiah sesungguhnya adalah
 * transfer bank manual (lihat MANUAL_PRICE_IDR).
 */
export const IDR_PER_USD = 16500;

export function formatIdr(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Harga transfer bank manual (ditagih benar-benar dalam Rupiah). */
export const MANUAL_PRICE_IDR: Record<"monthly" | "yearly", number> = {
  monthly: 99_000,
  yearly: 990_000,
};

export const PLANS: Array<{
  priceId: PlanPriceId;
  cycle: "monthly" | "yearly";
  name: string;
  cycleLabel: string;
  amountLabel: string;
  amountUsd: number;
  note?: string;
}> = [
  {
    priceId: "mcm_pro_monthly",
    cycle: "monthly",
    name: "Pro Bulanan",
    cycleLabel: "per bulan",
    amountLabel: "$6",
    amountUsd: 6,
  },
  {
    priceId: "mcm_pro_yearly",
    cycle: "yearly",
    name: "Pro Tahunan",
    cycleLabel: "per tahun",
    amountLabel: "$60",
    amountUsd: 60,
    note: "Hemat 2 bulan",
  },
];
