// Riwayat aksi Debt Quick Actions — dipakai panel audit di dalam
// DebtQuickActions agar Ace bisa memeriksa kapan tombol Harga Jual/Beli,
// Tunai, Bayar, atau Lunas ditekan, apakah dikonfirmasi atau dibatalkan.
// Disimpan di localStorage per-device (bukan sumber kebenaran keuangan —
// itu tetap di tabel debts/debt_payments), maksimum 50 entri terbaru.

import { useEffect, useState } from "react";

export type DebtActionKind = "add" | "cash" | "pay" | "lunas" | "edit" | "undo";
export type DebtActionStatus = "confirmed" | "cancelled" | "failed";

export type DebtActionEntry = {
  id: string;
  at: number;
  kind: DebtActionKind;
  status: DebtActionStatus;
  amount: number;
  /** Nominal sebelumnya (khusus edit). */
  prevAmount?: number;
  balanceKind: "piutang" | "hutang";
  party: string;
  /** Ringkasan tambahan bebas — mis. pesan error saat failed. */
  note?: string;
};

const STORAGE_KEY = "mcm.debtActionLog.v1";
const MAX_ENTRIES = 50;
const EVENT = "mcm:debt-action-log";

function read(): DebtActionEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DebtActionEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: DebtActionEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* ignore quota */
  }
}

export function appendDebtAction(entry: Omit<DebtActionEntry, "id" | "at"> & { at?: number }) {
  const full: DebtActionEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: entry.at ?? Date.now(),
    ...entry,
  };
  const next = [full, ...read()].slice(0, MAX_ENTRIES);
  write(next);
  return full;
}

export function clearDebtActionLog() {
  write([]);
}

export function useDebtActionLog(): DebtActionEntry[] {
  const [entries, setEntries] = useState<DebtActionEntry[]>(() => read());
  useEffect(() => {
    const sync = () => setEntries(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY) sync();
    });
    return () => {
      window.removeEventListener(EVENT, sync);
    };
  }, []);
  return entries;
}

export function actionLabel(kind: DebtActionKind, balanceKind: "piutang" | "hutang"): string {
  switch (kind) {
    case "add":
      return balanceKind === "piutang" ? "Harga Jual" : "Harga Beli";
    case "cash":
      return balanceKind === "piutang" ? "Kas (jual)" : "Kas (beli)";
    case "pay":
      return "Bayar";
    case "lunas":
      return "Lunas";
    case "edit":
      return "Edit nominal";
    case "undo":
      return "Urungkan";
  }
}