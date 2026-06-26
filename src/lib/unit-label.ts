/** Display the human unit label for an ecer/request line.
 *  Special case: products named "GS" are always counted as "botol",
 *  regardless of the stored unit label (which may be "gram").
 */
export function displayUnit(productName: string | null | undefined, unitLabel: string | null | undefined): string {
  const name = (productName ?? "").trim().toLowerCase();
  if (name === "gs") return "botol";
  return unitLabel ?? "";
}