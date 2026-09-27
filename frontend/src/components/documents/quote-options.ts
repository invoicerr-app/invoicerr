/**
 * Issue #373 ("quotes with options") - the frontend mirror of the backend's
 * `options/quote-options.ts#deriveQuoteOptions`. Same rule, same reasons this codebase's own
 * "mirrors the backend EXACTLY" convention already holds for totals-calculator.ts: a quote's own
 * OPTIONS are never stored anywhere of their own, only derived from the distinct, non-empty `option`
 * tags its lines carry, in first-appearance order. Zero or one distinct value means "no options" -
 * today's single-total behavior, unchanged.
 */
export function deriveQuoteOptions(lines: Array<Record<string, unknown>>): string[] {
  const seen = new Set<string>()
  const options: string[] = []
  for (const line of lines) {
    const raw = line.option
    const trimmed = typeof raw === "string" ? raw.trim() : ""
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    options.push(trimmed)
  }
  return options
}

function optionOf(line: Record<string, unknown>): string {
  const raw = line.option
  return typeof raw === "string" ? raw.trim() : ""
}

/** Mirrors the backend's `options/quote-options.ts#isCommonLine` exactly - a line left untagged, on
 *  a quote that genuinely has 2+ options, is COMMON to every one of them, never orphaned. */
export function isCommonLine(line: Record<string, unknown>): boolean {
  return !optionOf(line)
}

/** Mirrors the backend's own `commonLinesOf`. */
export function commonLinesOf(lines: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return lines.filter(isCommonLine)
}

/** Mirrors the backend's own `linesForOption` - every line tagged with exactly this option PLUS every
 *  common (untagged) line, in ORIGINAL relative order. */
export function linesForOption(
  lines: Array<Record<string, unknown>>,
  option: string,
): Array<Record<string, unknown>> {
  return lines.filter((line) => optionOf(line) === option || isCommonLine(line))
}
