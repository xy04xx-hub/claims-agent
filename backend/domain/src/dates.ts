const MS_PER_DAY = 86_400_000;

/** Whole days from a to b (b minus a), both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / MS_PER_DAY);
}
