/** Orders strings by UTF-16 code unit, the order `Array#sort()` uses without a comparator, independent of locale. */
export function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
