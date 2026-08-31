/**
 * REPRISE VERBATIM de `compliance/profiles/temporal.ts` (git tag `avant-refonte-documents`), adaptée
 * au `Temporal<T>` de ce module (`schema.ts`) plutôt qu'à celui, alors plus large, de l'ancien moteur
 * de conformité. La logique de sélection elle-même — fenêtres `[validFrom, validTo)`, la plus
 * spécifique (le `validFrom` le plus tardif) l'emporte en cas de recouvrement — n'a pas changé d'une
 * ligne.
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
