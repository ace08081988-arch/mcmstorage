export type VariantValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validates a weight-per-unit value for a variant preset.
 * Rejects non-finite, zero, and negative values.
 */
export function validateVariantWeight(input: unknown): VariantValidationResult {
  const w = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(w)) {
    return { ok: false, error: "Berat per unit harus berupa angka" };
  }
  if (w <= 0) {
    return {
      ok: false,
      error: "Berat per unit harus lebih dari 0 (tidak boleh nol atau negatif)",
    };
  }
  return { ok: true };
}

/**
 * Validates that a variant label is non-empty after trimming.
 */
export function validateVariantLabel(input: unknown): VariantValidationResult {
  if (typeof input !== "string" || !input.trim()) {
    return { ok: false, error: "Label tidak boleh kosong" };
  }
  return { ok: true };
}