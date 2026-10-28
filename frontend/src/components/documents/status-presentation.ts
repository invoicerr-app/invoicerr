/**
 * How a document status reads on screen: a tone and a glyph, so status never relies on colour
 * alone. Statuses are open data (a plugin may declare its own), so this matches a small generic
 * vocabulary by pattern and falls back to neutral rather than hiding anything.
 */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "destructive"
export type StatusGlyph = "open" | "half" | "check" | "disc" | "triangle" | "circled-cross" | "cross"

export interface StatusPresentation {
  tone: StatusTone
  glyph: StatusGlyph
  struck: boolean
}

// First match wins: "unpaid" must be read before "paid", "partially_paid" before "paid".
const RULES: [RegExp, StatusTone, StatusGlyph][] = [
  [/cancel|void|withdraw/i, "neutral", "cross"],
  [/reject|refus|fail|error/i, "destructive", "circled-cross"],
  [/overdue|late/i, "destructive", "triangle"],
  [/unpaid|outstanding/i, "neutral", "open"],
  [/partial/i, "success", "half"],
  [/paid|settl|collect/i, "success", "disc"],
  [/pending|await|review|sending/i, "warning", "half"],
  [/sign|accept|clear|complete|approved/i, "success", "check"],
  [/sent|issued|submit|transmit|progress|imported|deposit/i, "info", "half"],
]

export function statusPresentation(status: string): StatusPresentation {
  for (const [pattern, tone, glyph] of RULES) {
    if (pattern.test(status)) return { tone, glyph, struck: glyph === "cross" }
  }
  return { tone: "neutral", glyph: "open", struck: false }
}
