// Event bus kecil untuk memberitahu UI bahwa transaksi Tunai / Harga Jual /
// Harga Beli baru tercatat lewat DebtQuickActions. Panel Siap/Diminta/Sisa
// dan daftar paket cukup memasang listener untuk refetch datanya sendiri —
// tidak ada perubahan status pengiriman yang dilakukan di sini, jadi aman
// untuk di-rollback via tombol Urungkan tanpa efek samping.

import { useEffect } from "react";

export type DebtTxDetail = {
  kind: "piutang" | "hutang";
  wasCash: boolean;
  amount: number;
  partyId: string | null;
  at: number;
};

export const DEBT_TX_EVENT = "mcm:debt-tx";

export function emitDebtTx(detail: DebtTxDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DebtTxDetail>(DEBT_TX_EVENT, { detail }));
}

/**
 * Jalankan `onEvent` setiap kali transaksi debt baru tercatat.
 * Handler dibungkus stable ref oleh caller (mis. useCallback) atau pastikan
 * dependency array useEffect di caller memuat fungsi itu.
 */
export function useOnDebtTx(onEvent: (detail: DebtTxDetail) => void) {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<DebtTxDetail>).detail;
      if (detail) onEvent(detail);
    };
    window.addEventListener(DEBT_TX_EVENT, handler);
    return () => window.removeEventListener(DEBT_TX_EVENT, handler);
  }, [onEvent]);
}