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

export const PLANS: Array<{
  priceId: PlanPriceId;
  name: string;
  cycleLabel: string;
  amountLabel: string;
  note?: string;
}> = [
  {
    priceId: "mcm_pro_monthly",
    name: "Pro Bulanan",
    cycleLabel: "per bulan",
    amountLabel: "$6",
  },
  {
    priceId: "mcm_pro_yearly",
    name: "Pro Tahunan",
    cycleLabel: "per tahun",
    amountLabel: "$60",
    note: "Hemat 2 bulan",
  },
];
