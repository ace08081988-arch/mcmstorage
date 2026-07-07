import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * Enkripsi AES-256-GCM untuk secret Turnstile. Format ciphertext:
 *   `enc:v1:<nonce-base64>:<ciphertext+authTag-base64>`
 *
 * Kunci diambil dari env `TURNSTILE_ENCRYPTION_KEY` (dibuat via
 * `generate_secret`, hanya tersedia di server). Kunci di-hash SHA-256
 * agar panjangnya pasti 32 byte tak peduli panjang string aslinya.
 *
 * Format yang tidak diawali `enc:v1:` diperlakukan sebagai plaintext lama
 * dan dikembalikan apa adanya oleh `decryptTurnstileSecret` — ini kunci untuk
 * migrasi bertahap: nilai lama tetap bekerja hingga admin menyimpan ulang
 * (atau `secureSignUpImpl` mengupgrade otomatis).
 */
const ENC_PREFIX = "enc:v1:";

function getKey(): Buffer {
  const raw = (process.env.TURNSTILE_ENCRYPTION_KEY ?? "").trim();
  if (!raw) {
    throw new Error(
      "TURNSTILE_ENCRYPTION_KEY belum diatur — set via generate_secret",
    );
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isEncryptedTurnstileSecret(value: string): boolean {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

export function encryptTurnstileSecret(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([ct, tag]);
  return ENC_PREFIX + nonce.toString("base64") + ":" + packed.toString("base64");
}

/**
 * Kembalikan plaintext. Nilai lama tanpa prefix `enc:v1:` diperlakukan
 * sebagai plaintext untuk backward-compat (akan diupgrade otomatis oleh
 * pemanggil setelah dekripsi berhasil).
 */
export function decryptTurnstileSecret(stored: string): string {
  if (!stored) return "";
  if (!isEncryptedTurnstileSecret(stored)) return stored;
  const rest = stored.slice(ENC_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) throw new Error("Format ciphertext Turnstile tidak dikenali");
  const nonce = Buffer.from(rest.slice(0, sep), "base64");
  const packed = Buffer.from(rest.slice(sep + 1), "base64");
  if (packed.length < 17) throw new Error("Ciphertext terlalu pendek");
  const tag = packed.subarray(packed.length - 16);
  const ct = packed.subarray(0, packed.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), nonce);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * Mask untuk tampilan UI. Menerima plaintext (setelah didekripsi).
 */
export function maskTurnstileSecret(plaintext: string): string {
  if (!plaintext) return "";
  return plaintext.length > 8
    ? plaintext.slice(0, 4) + "…" + plaintext.slice(-4)
    : "••••••";
}