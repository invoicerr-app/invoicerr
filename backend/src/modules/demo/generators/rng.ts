/**
 * A tiny, deterministic, seedable PRNG (mulberry32): the demo seed's own randomness source. NOT
 * cryptographic, deliberately: the point is reproducibility, never unpredictability. `scripts/
 * demo-reset.ts` draws a fresh seed (the current time) on every real reset, so company/client/article
 * names, amounts, quantities and dates vary between resets; every spec that exercises the generator
 * passes a FIXED numeric seed, so the exact same run is reproducible in CI and in a debugger.
 */
export type Rng = () => number;

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a reproducible `Rng` from any string or number seed. A string is hashed to a 32-bit
 *  integer first (`xmur3`) so a caller never has to pick a "good" numeric seed by hand. */
export function createRng(seed: string | number): Rng {
  const numericSeed = typeof seed === 'number' ? seed >>> 0 : xmur3(seed)();
  return mulberry32(numericSeed);
}

/** Integer in `[min, max]`, inclusive both ends. */
export function intBetween(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Float in `[min, max]`, rounded to `decimals` places (money/percentages). */
export function floatBetween(rng: Rng, min: number, max: number, decimals = 2): number {
  const value = rng() * (max - min) + min;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function pickOne<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pickOne: empty list');
  return items[intBetween(rng, 0, items.length - 1)];
}

/** `count` DISTINCT items drawn from `items` (never repeats one), order preserved from the source
 *  array. Throws if `count` exceeds `items.length`: a demo generator asking for more distinct
 *  values than a pool offers is a bug in the pool, not a case to silently under-deliver on. */
export function pickDistinct<T>(rng: Rng, items: readonly T[], count: number): T[] {
  if (count > items.length) {
    throw new Error(`pickDistinct: asked for ${count} distinct items from a pool of ${items.length}`);
  }
  const pool = [...items];
  const result: T[] = [];
  for (let i = 0; i < count; i++) {
    const index = intBetween(rng, 0, pool.length - 1);
    result.push(pool[index]);
    pool.splice(index, 1);
  }
  return result;
}

/** A date `daysOffset` days away from `from` (negative = past, positive = future), at midnight UTC,
 *  every generated document's dates are relative to the RESET moment (issue #533's own requirement:
 *  "dates are relative to the reset time so the dashboard never looks stale"), never a fixed literal
 *  date that would drift stale between resets. */
export function daysFrom(from: Date, daysOffset: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
