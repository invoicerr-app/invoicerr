import { Temporal } from './schema';

/**
 * Pick the rule in force at `date`. Windows are [validFrom, validTo) — validTo exclusive.
 * When several windows overlap, the one with the latest `validFrom` wins (most specific).
 * Returns null if nothing matches.
 */
export function pickByDate<T>(rules: Temporal<T>[], date: Date): T | null {
  const t = date.getTime();
  let best: Temporal<T> | null = null;
  let bestFrom = -Infinity;
  for (const r of rules) {
    const from = new Date(r.validFrom).getTime();
    const to = r.validTo ? new Date(r.validTo).getTime() : Infinity;
    if (t >= from && t < to && from >= bestFrom) {
      best = r;
      bestFrom = from;
    }
  }
  return best ? best.value : null;
}

/** Like pickByDate but returns every matching rule (for selector-based differentiation). */
export function allByDate<T>(rules: Temporal<T>[], date: Date): T[] {
  const t = date.getTime();
  return rules
    .filter((r) => {
      const from = new Date(r.validFrom).getTime();
      const to = r.validTo ? new Date(r.validTo).getTime() : Infinity;
      return t >= from && t < to;
    })
    .map((r) => r.value);
}
