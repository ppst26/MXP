export type SortDir = "asc" | "desc";

export function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const mult = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1 * mult;
  if (b == null) return -1 * mult;
  if (typeof a === "number" && typeof b === "number") return (a - b) * mult;
  if (a instanceof Date && b instanceof Date) return (a.getTime() - b.getTime()) * mult;
  return String(a).localeCompare(String(b), "th") * mult;
}
