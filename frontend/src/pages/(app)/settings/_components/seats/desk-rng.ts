/**
 * Deterministic, per-desk furniture generation — the office plan draws differently-furnished desks
 * without ever calling `Math.random()` at render time. Same `seed` (`companyId:seatIndex`) always
 * produces the same combination, so the plan is stable across renders, across viewers, and across a
 * screenshot taken twice — the same desk always looks the same desk, never reshuffling on every
 * reload the way a render-time `Math.random()` would.
 *
 * `hashSeed` (FNV-1a, a small non-cryptographic string hash) turns the seed string into a 32-bit
 * integer; `mulberry32` turns that integer into a fast, deterministic PRNG. Both are tiny, well-known
 * public-domain algorithms — no dependency pulled in for what is, in the end, a handful of coin flips
 * per desk.
 */

function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type DeskDisplay = "single-monitor" | "dual-monitor" | "laptop" | "laptop-and-monitor"
export type MouseSide = "left" | "right"

export interface DeskFurniture {
  display: DeskDisplay
  mouseSide: MouseSide
  hasCup: boolean
  hasNotepad: boolean
}

const DISPLAYS: DeskDisplay[] = ["single-monitor", "dual-monitor", "laptop", "laptop-and-monitor"]
const MOUSE_SIDES: MouseSide[] = ["left", "right"]

/** Every trait pulled from the SAME rng instance, in a FIXED order — this is what makes two desks with
 *  different seeds diverge predictably rather than by coincidence, and is why the order below must
 *  never be reshuffled without accepting that every existing desk's own look changes with it.
 *
 *  There used to be a third shape, an L-shaped "corner" desk — dropped after repeated visual passes
 *  never landed on a corner-desk drawing that read cleanly at this size ("c'est pire, t'as aggrandi la
 *  barre du L" was the last of several rounds); every desk is the same plain rectangle now. A desk also
 *  used to be able to carry a floor lamp, a plant, or a tower — dropped for the same reason a desk never
 *  gets a keyboard alongside a laptop: nothing on the surface but what's actually worked at
 *  (`desk-pieces.tsx#DeskFurnitureGroup`'s own header). */
export function pickDeskFurniture(seed: string): DeskFurniture {
  const rng = mulberry32(hashSeed(seed))
  const pick = <T>(options: T[]): T => options[Math.floor(rng() * options.length)]
  const chance = (p: number) => rng() < p

  return {
    display: pick(DISPLAYS),
    mouseSide: pick(MOUSE_SIDES),
    hasCup: chance(0.5),
    hasNotepad: chance(0.4),
  }
}

/** `companyId:seatIndex` — a desk's own identity is its NUMBER within ITS company, never the
 *  occupant: the desk looks the same whoever is (or isn't) sitting there, and moving a member to a
 *  different desk changes what they're sitting at, not a "personal" furniture set that would follow
 *  them around. */
export function deskSeed(companyId: string, seatIndex: number): string {
  return `${companyId}:${seatIndex}`
}
