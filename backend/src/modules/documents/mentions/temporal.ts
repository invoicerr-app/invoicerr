/**
 * CARRIED OVER VERBATIM from `compliance/profiles/temporal.ts` (git tag `avant-refonte-documents`),
 * adapted to this module's own `Temporal<T>` (`schema.ts`) rather than the old compliance engine's
 * own, then wider, one. The selection logic itself — `[validFrom, validTo)` windows, the most
 * specific one (the latest `validFrom`) wins on overlap — has not changed by a single line.
 */
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
