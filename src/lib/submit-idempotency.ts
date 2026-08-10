/**
 * Kunci idempotensi untuk RPC submit portal pegawai.
 *
 * Server (`prep_submit`, `request_submit_via_task`, `ecer_submit_via_task`)
 * memakai `_client_key` unik per tugas: percobaan kedua dengan kunci yang sama
 * mengembalikan hasil percobaan pertama alih-alih membuat submission baru
 * (stok tidak terpotong dua kali).
 *
 * Kunci disimpan di sessionStorage supaya retry setelah WebView restart atau
 * jaringan putus tetap memakai kunci yang sama. Dibuang setelah sukses.
 */
const PREFIX = "ace.submit-key.";

function readStore(k: string): string | null {
  try {
    return sessionStorage.getItem(PREFIX + k);
  } catch {
    return null;
  }
}

function writeStore(k: string, v: string) {
  try {
    sessionStorage.setItem(PREFIX + k, v);
  } catch {
    /* mode privat / storage penuh — kunci in-memory saja */
  }
}

const memory = new Map<string, string>();

function randomKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Ambil (atau buat) kunci idempotensi stabil untuk satu scope pengiriman. */
export function getSubmitKey(scope: string): string {
  const existing = readStore(scope) ?? memory.get(scope);
  if (existing) {
    memory.set(scope, existing);
    return existing;
  }
  const key = randomKey();
  memory.set(scope, key);
  writeStore(scope, key);
  return key;
}

/** Buang kunci setelah pengiriman sukses supaya kiriman berikutnya baru. */
export function clearSubmitKey(scope: string): void {
  memory.delete(scope);
  try {
    sessionStorage.removeItem(PREFIX + scope);
  } catch {
    /* ignore */
  }
}
