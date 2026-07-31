import { BOTOL_PER_KARTON } from "@/lib/stock-format";
import { humanBaseUnit } from "@/lib/unit-label";

/**
 * Badge live yang merangkum konversi kemasan berdasar payload item
 * (package_type, package_size, base_unit) & mode qty aktif.
 *
 * Selalu memakai nilai dari payload — ketika `package_size` atau
 * `base_unit` berubah, angka & satuan pada badge otomatis ikut berubah.
 * Ukuran karton dibaca dari konstanta {@link BOTOL_PER_KARTON}. Label
 * base memakai {@link humanBaseUnit} sehingga botol-per-pcs (GS-like)
 * tampil sebagai "botol".
 */
export function KemasanKonversiBadge({
  packageType,
  packageSize,
  baseUnit,
  qty,
  mode,
  testId,
}: {
  packageType: string;
  packageSize: number | null | undefined;
  baseUnit: string;
  qty: number;
  mode: "base" | "package" | "karton";
  testId?: string;
}) {
  const pt = (packageType ?? "").toLowerCase();
  const ps = Number(packageSize) || 0;
  const n = Number(qty) || 0;
  const humanBase = humanBaseUnit(packageType, baseUnit);

  const fmt = (v: number) =>
    v.toLocaleString("id-ID", { maximumFractionDigits: 2 });

  let content: string | null = null;
  if (mode === "karton" && pt === "botol" && n > 0) {
    const botol = n * BOTOL_PER_KARTON;
    // Bila 1 botol = >1 base, sertakan link ke base.
    content =
      ps > 1
        ? `${fmt(n)} karton = ${fmt(botol)} botol = ${fmt(botol * ps)} ${humanBase}`
        : `${fmt(n)} karton = ${fmt(botol)} botol`;
  } else if (mode === "package" && pt !== "pcs" && ps > 1 && n > 0) {
    // Untuk botol-package non-trivial (package_size > 1), sertakan padanan
    // karton bila kelipatan cukup besar.
    const base = n * ps;
    if (pt === "botol") {
      const kInt = Math.floor(n / BOTOL_PER_KARTON);
      const sisa = n - kInt * BOTOL_PER_KARTON;
      const kartonHint =
        kInt >= 1
          ? ` · ${fmt(kInt)} karton${sisa > 0 ? ` + ${fmt(sisa)} botol` : ""}`
          : "";
      content = `${fmt(n)} ${packageType} = ${fmt(base)} ${humanBase}${kartonHint}`;
    } else {
      content = `${fmt(n)} ${packageType} = ${fmt(base)} ${humanBase}`;
    }
  } else if (mode === "base" && pt === "botol" && baseUnit === "pcs" && n >= BOTOL_PER_KARTON) {
    const kInt = Math.floor(n / BOTOL_PER_KARTON);
    const sisa = n - kInt * BOTOL_PER_KARTON;
    content = `${fmt(n)} botol = ${fmt(kInt)} karton${sisa > 0 ? ` + ${fmt(sisa)} botol` : ""}`;
  } else if (mode === "base" && pt !== "pcs" && pt !== "botol" && ps > 1 && n >= ps) {
    content = `${fmt(n)} ${humanBase} = ${fmt(n / ps)} ${packageType}`;
  }

  if (!content) return null;
  return (
    <span
      className="ml-1 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground"
      data-testid={testId ?? "kemasan-konversi-badge"}
    >
      {content}
    </span>
  );
}